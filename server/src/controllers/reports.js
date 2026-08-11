const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok } = require('../utils/response');
const { httpError, localDayKey } = require('../utils/biz');

// 报表中心：经营利润 / 销售统计(按商品) / 库存统计 / 资金流水 / 客户对账单
// 日期参数统一 startDate/endDate = "YYYY-MM-DD"（含当天）

const rangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const parseRange = (query) => {
  const { startDate, endDate } = rangeSchema.parse(query);
  return { start: new Date(`${startDate}T00:00:00`), end: new Date(`${endDate}T23:59:59.999`) };
};

const r2 = (n) => Math.round(n * 100) / 100;

// ---- 1. 经营利润（区间汇总 + 按日走势）----
exports.profit = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const [orders, soldItems, incomes, expenses, lossRecords] = await Promise.all([
    prisma.order.findMany({ where: { status: 'completed', createdAt: { gte: start, lte: end } }, select: { actualAmount: true, createdAt: true } }),
    prisma.orderItem.findMany({
      where: { order: { status: 'completed', createdAt: { gte: start, lte: end } } },
      select: { quantity: true, costSnapshot: true, sku: { select: { costPrice: true } }, product: { select: { costPrice: true } }, order: { select: { createdAt: true } } },
    }),
    prisma.income.findMany({ where: { incomeDate: { gte: start, lte: end } }, select: { amount: true, incomeDate: true } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } }, select: { amount: true, expenseDate: true } }),
    // 损耗（刘哥的灵魂问题"这个月烂掉多少钱"）：报损/过期/损坏 出库，金额按当前进价估算
    prisma.inventoryRecord.findMany({
      where: { type: 'outbound', createdAt: { gte: start, lte: end }, OR: [{ reason: { startsWith: '报损' } }, { reason: { startsWith: '过期' } }, { reason: { startsWith: '损坏' } }] },
      select: { quantity: true, sku: { select: { costPrice: true } }, product: { select: { costPrice: true } } },
    }),
  ]);

  const dayKey = localDayKey; // 本地时区（早市 6 点的单必须算今天）
  const byDay = {};
  const bump = (d, field, v) => {
    const k = dayKey(d);
    byDay[k] ??= { date: k, sales: 0, cogs: 0, expenses: 0, profit: 0 };
    byDay[k][field] += v;
  };
  orders.forEach((o) => bump(o.createdAt, 'sales', o.actualAmount));
  incomes.forEach((i) => bump(i.incomeDate, 'sales', i.amount));
  soldItems.forEach((it) => bump(it.order.createdAt, 'cogs', it.quantity * (it.costSnapshot ?? it.sku?.costPrice ?? it.product.costPrice ?? 0)));
  expenses.forEach((e) => bump(e.expenseDate, 'expenses', e.amount));
  Object.values(byDay).forEach((d) => {
    d.sales = r2(d.sales); d.cogs = r2(d.cogs); d.expenses = r2(d.expenses);
    d.profit = r2(d.sales - d.cogs - d.expenses);
  });

  const sales = r2(orders.reduce((s, o) => s + o.actualAmount, 0) + incomes.reduce((s, i) => s + i.amount, 0));
  const cogs = r2(soldItems.reduce((s, it) => s + it.quantity * (it.costSnapshot ?? it.sku?.costPrice ?? it.product.costPrice ?? 0), 0));
  const expenseTotal = r2(expenses.reduce((s, e) => s + e.amount, 0));
  // 损耗单列不并入 profit（保持口径稳定）；按当前进价估算，供老板看见"烂掉多少钱"
  const lossAmount = r2(lossRecords.reduce((s, l) => s + l.quantity * (l.sku?.costPrice ?? l.product?.costPrice ?? 0), 0));
  return ok(res, {
    sales, cogs, expenses: expenseTotal, profit: r2(sales - cogs - expenseTotal),
    lossAmount,
    orderCount: orders.length,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
  });
};

// ---- 2. 销售统计（按商品/规格聚合，销量额降序）----
exports.salesByProduct = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const items = await prisma.orderItem.findMany({
    where: { order: { status: 'completed', createdAt: { gte: start, lte: end } } },
    select: { productId: true, productName: true, specText: true, quantity: true, subtotal: true, costSnapshot: true, sku: { select: { costPrice: true } } },
  });
  const agg = {};
  for (const it of items) {
    const key = `${it.productId}|${it.specText ?? ''}`;
    agg[key] ??= { productName: it.productName, specText: it.specText, qty: 0, amount: 0, cost: 0 };
    agg[key].qty += it.quantity;
    agg[key].amount += it.subtotal;
    agg[key].cost += it.quantity * (it.costSnapshot ?? it.sku?.costPrice ?? 0);
  }
  const list = Object.values(agg)
    .map((x) => ({ ...x, amount: r2(x.amount), profit: r2(x.amount - x.cost), cost: undefined }))
    .sort((a, b) => b.amount - a.amount);
  return ok(res, { list, totalAmount: r2(list.reduce((s, x) => s + x.amount, 0)) });
};

// ---- 3. 库存统计（总值按成本价 + 分品类 + 预警清单）----
exports.inventory = async (_req, res) => {
  const invs = await prisma.inventory.findMany({
    where: { sku: { status: 1, product: { isDeleted: 0 } } },
    include: { sku: { include: { product: { include: { productType: true } } } } },
  });
  let totalStock = 0, totalValue = 0;
  const byType = {};
  const lowStock = [];
  for (const inv of invs) {
    const sku = inv.sku;
    const value = inv.quantity * (sku.costPrice ?? 0);
    totalStock += inv.quantity;
    totalValue += value;
    const tn = sku.product.productType?.name ?? '未分类';
    byType[tn] ??= { name: tn, stock: 0, value: 0 };
    byType[tn].stock += inv.quantity;
    byType[tn].value += value;
    if (inv.minQuantity > 0 && inv.quantity <= inv.minQuantity) {
      lowStock.push({ productName: sku.product.name, specText: sku.specText, stock: inv.quantity, minQuantity: inv.minQuantity });
    }
  }
  return ok(res, {
    totalStock,
    totalValue: r2(totalValue),
    skuCount: invs.length,
    byType: Object.values(byType).map((t) => ({ ...t, value: r2(t.value) })).sort((a, b) => b.value - a.value),
    lowStock,
  });
};

// ---- 4. 资金流水（收付款 + 收入 + 支出合并时间线）----
exports.cashflow = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const [payments, incomes, expenses] = await Promise.all([
    // account='冲账' 是退货冲减的记账行，不是真实资金进出，资金流水必须排除
    // 注意 SQL 三值逻辑：NOT(account='冲账') 会连带排除 account=NULL 的行（开单未选结算账户时就是 NULL），
    // 必须显式放行 NULL，否则开单随收的钱在资金流水里消失
    prisma.paymentRecord.findMany({ where: { paidAt: { gte: start, lte: end }, OR: [{ account: null }, { NOT: { account: '冲账' } }] }, orderBy: { paidAt: 'desc' } }),
    prisma.income.findMany({ where: { incomeDate: { gte: start, lte: end } } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } } }),
  ]);
  const rows = [
    ...payments.map((p) => ({
      at: p.paidAt, type: p.direction === 'in' ? '收款' : '付款',
      amount: p.direction === 'in' ? p.amount : -p.amount,
      note: p.note, account: p.account,
    })),
    ...incomes.map((i) => ({ at: i.incomeDate, type: '收入', amount: i.amount, note: i.source + (i.note ? `(${i.note})` : ''), account: null })),
    ...expenses.map((e) => ({ at: e.expenseDate, type: '支出', amount: -e.amount, note: e.category + (e.note ? `(${e.note})` : ''), account: null })),
  ].sort((a, b) => b.at - a.at);
  const inflow = r2(rows.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0));
  const outflow = r2(rows.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0));
  return ok(res, { inflow, outflow, net: r2(inflow - outflow), rows: rows.map((x) => ({ ...x, amount: r2(x.amount) })) });
};

// ---- 6. 员工业绩（按开单人统计：单数/销售额/毛利）----
exports.staffPerformance = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const orders = await prisma.order.findMany({
    where: { status: 'completed', createdAt: { gte: start, lte: end } },
    select: {
      operatorId: true,
      actualAmount: true,
      operator: { select: { realName: true } },
      items: { select: { quantity: true, costSnapshot: true, sku: { select: { costPrice: true } }, product: { select: { costPrice: true } } } },
    },
  });
  const agg = {};
  for (const o of orders) {
    agg[o.operatorId] ??= { name: o.operator.realName, orders: 0, sales: 0, cogs: 0 };
    agg[o.operatorId].orders += 1;
    agg[o.operatorId].sales += o.actualAmount;
    agg[o.operatorId].cogs += o.items.reduce((s, it) => s + it.quantity * (it.costSnapshot ?? it.sku?.costPrice ?? it.product.costPrice ?? 0), 0);
  }
  const list = Object.values(agg)
    .map((x) => ({ name: x.name, orders: x.orders, sales: r2(x.sales), profit: r2(x.sales - x.cogs) }))
    .sort((a, b) => b.sales - a.sales);
  return ok(res, { list });
};

// ---- 7. 进货统计（按商品 + 按供应商）----
exports.purchaseStats = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const pos = await prisma.purchaseOrder.findMany({
    where: { status: 'completed', createdAt: { gte: start, lte: end } },
    select: { actualAmount: true, supplier: { select: { name: true } }, items: { select: { productName: true, specText: true, quantity: true, subtotal: true } } },
  });
  const byProduct = {};
  const bySupplier = {};
  let total = 0;
  for (const po of pos) {
    total += po.actualAmount;
    const sn = po.supplier?.name ?? '无供应商';
    bySupplier[sn] ??= { name: sn, amount: 0, orders: 0 };
    bySupplier[sn].amount += po.actualAmount;
    bySupplier[sn].orders += 1;
    for (const it of po.items) {
      const k = it.productName + (it.specText ? ` ${it.specText}` : '');
      byProduct[k] ??= { name: k, qty: 0, amount: 0 };
      byProduct[k].qty += it.quantity;
      byProduct[k].amount += it.subtotal;
    }
  }
  return ok(res, {
    total: r2(total),
    orderCount: pos.length,
    byProduct: Object.values(byProduct).map((x) => ({ ...x, amount: r2(x.amount) })).sort((a, b) => b.amount - a.amount),
    bySupplier: Object.values(bySupplier).map((x) => ({ ...x, amount: r2(x.amount) })).sort((a, b) => b.amount - a.amount),
  });
};

// ---- 8. 供应商对账单（应付版：期初欠 + 进货/付款往来 + 期末欠）----
exports.supplierStatement = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const supplierId = Number(req.query.supplierId);
  if (!supplierId) throw httpError(400, '缺少 supplierId');
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, isDeleted: 0 } });
  if (!supplier) throw httpError(404, '供应商不存在');

  const cancelledIds = (
    await prisma.purchaseOrder.findMany({ where: { supplierId, status: 'cancelled' }, select: { id: true } })
  ).map((o) => o.id);
  const payWhere = { supplierId, ...(cancelledIds.length ? { NOT: { purchaseOrderId: { in: cancelledIds } } } : {}) };
  // 净付款 = 付款(out) − 退回款(in)
  const netPaid = (list) => list.reduce((s, p) => s + (p.direction === 'out' ? p.amount : -p.amount), 0);

  const [prevPos, prevPays] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { supplierId, status: 'completed', createdAt: { lt: start } },
      select: { actualAmount: true, items: { select: { returnedQty: true, unitPrice: true } } },
    }),
    prisma.paymentRecord.findMany({ where: { ...payWhere, paidAt: { lt: start } }, select: { direction: true, amount: true } }),
  ]);
  const poOriginal = (o) => r2(o.actualAmount + o.items.reduce((s2, it) => s2 + it.returnedQty * it.unitPrice, 0));
  // 期初应付用「原始金额」：退货以带时间戳的冲减行核销，历史单据金额不追溯改写
  const opening = r2(prevPos.reduce((s, o) => s + poOriginal(o), 0) - netPaid(prevPays));
  const [pos, pays] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { supplierId, status: 'completed', createdAt: { gte: start, lte: end } },
      select: {
        orderNo: true, actualAmount: true, createdAt: true,
        _count: { select: { items: true } },
        items: { select: { returnedQty: true, unitPrice: true } },
      },
    }),
    prisma.paymentRecord.findMany({ where: { ...payWhere, paidAt: { gte: start, lte: end } } }),
  ]);
  const rows = [
    ...pos.map((o) => ({ at: o.createdAt, type: '进货单', ref: o.orderNo, debit: poOriginal(o), credit: 0, note: `${o._count.items}种商品` })),
    ...pays.map((p) => ({
      at: p.paidAt,
      type: p.account === '冲账' ? '退货冲减' : p.direction === 'out' ? '付款' : '退回款',
      ref: p.account === '冲账' ? '' : p.account ?? '',
      debit: 0,
      credit: r2(p.direction === 'out' ? p.amount : -p.amount),
      note: p.note,
    })),
  ].sort((a, b) => a.at - b.at);

  const periodDebit = r2(rows.reduce((s, x) => s + x.debit, 0));
  const periodCredit = r2(rows.reduce((s, x) => s + x.credit, 0));
  return ok(res, {
    supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
    opening, periodDebit, periodCredit,
    closing: r2(opening + periodDebit - periodCredit),
    rows,
  });
};

// ---- 5. 客户对账单（期初欠 + 期间往来 + 期末欠，可分享）----
exports.customerStatement = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const customerId = Number(req.query.customerId);
  if (!customerId) throw httpError(400, '缺少 customerId');
  const customer = await prisma.customer.findFirst({ where: { id: customerId, isDeleted: 0 } });
  if (!customer) throw httpError(404, '客户不存在');

  // 取消单的收款流水要排除（取消不冲流水的话账会歪——先取有效订单集合）
  const cancelledIds = (
    await prisma.order.findMany({ where: { customerId, status: 'cancelled' }, select: { id: true } })
  ).map((o) => o.id);
  const paymentWhere = { customerId, ...(cancelledIds.length ? { NOT: { orderId: { in: cancelledIds } } } : {}) };
  // 净收款 = 收款(in) − 退款(out)，退货退款必须冲减，否则账不平
  const netPaid = (list) => list.reduce((s, p) => s + (p.direction === 'in' ? p.amount : -p.amount), 0);

  // 单据行金额必须是「开单当时」的原始值：actualAmount 会被退货改小，
  // 直接用它等于把已经发给客户的历史对账单追溯改写。
  // 原始金额 = 当前 actualAmount + Σ(已退数量×单价)，退货本身以带时间戳的「退货冲减」行呈现。
  const originalAmount = (o) =>
    r2(o.actualAmount + o.items.reduce((s, it) => s + it.returnedQty * it.unitPrice, 0));

  // 期初欠款 = 期初前所有完成单原始应收 − 期初前净收款（冲减记录也是 in，自动参与）
  const [prevOrders, prevPayList] = await Promise.all([
    prisma.order.findMany({
      where: { customerId, status: 'completed', createdAt: { lt: start } },
      select: { actualAmount: true, items: { select: { returnedQty: true, unitPrice: true } } },
    }),
    prisma.paymentRecord.findMany({ where: { ...paymentWhere, paidAt: { lt: start } }, select: { direction: true, amount: true } }),
  ]);
  const opening = r2(prevOrders.reduce((s, o) => s + originalAmount(o), 0) - netPaid(prevPayList));

  // 期间往来：单据(记应收) + 收款(核销) + 退款(红冲)
  const [orders, pays] = await Promise.all([
    prisma.order.findMany({
      where: { customerId, status: 'completed', createdAt: { gte: start, lte: end } },
      select: {
        id: true, orderNo: true, actualAmount: true, createdAt: true,
        _count: { select: { items: true } },
        items: { select: { returnedQty: true, unitPrice: true } },
      },
    }),
    prisma.paymentRecord.findMany({ where: { ...paymentWhere, paidAt: { gte: start, lte: end } } }),
  ]);
  const rows = [
    ...orders.map((o) => ({ at: o.createdAt, type: '销售单', ref: o.orderNo, debit: originalAmount(o), credit: 0, note: `${o._count.items}种商品` })),
    ...pays.map((p) => ({
      at: p.paidAt,
      type: p.account === '冲账' ? '退货冲减' : p.direction === 'in' ? '收款' : '退款',
      ref: p.account === '冲账' ? '' : p.account ?? '',
      debit: 0,
      credit: r2(p.direction === 'in' ? p.amount : -p.amount), // 退款红冲；冲减为正向核销
      note: p.note,
    })),
  ].sort((a, b) => a.at - b.at);

  const periodDebit = r2(rows.reduce((s, x) => s + x.debit, 0));
  const periodCredit = r2(rows.reduce((s, x) => s + x.credit, 0));
  const closing = r2(opening + periodDebit - periodCredit);

  return ok(res, {
    customer: { id: customer.id, name: customer.name, phone: customer.phone, address: customer.address },
    opening, periodDebit, periodCredit, closing, rows,
  });
};
