const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok } = require('../utils/response');
const { httpError, localDayKey } = require('../utils/biz');
const { projectTrades, originalAmount, costSummary, orderCount } = require('../services/tradeProjection');

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
  const [projection, incomes, expenses, lossRecords] = await Promise.all([
    projectTrades('sale', start, end),
    prisma.income.findMany({ where: { incomeDate: { gte: start, lte: end } } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } } }),
    prisma.inventoryRecord.findMany({
      where: { type: 'outbound', createdAt: { gte: start, lte: end }, OR: [{ reason: { startsWith: '报损' } }, { reason: { startsWith: '过期' } }, { reason: { startsWith: '损坏' } }] },
      select: { quantity: true, sku: { select: { costPrice: true } }, product: { select: { costPrice: true } } },
    }),
  ]);
  const byDay = {};
  const day = at => {
    const date = localDayKey(at);
    return byDay[date] ??= { date, sales: 0, cogs: 0, expenses: 0, profit: 0 };
  };
  for (const row of projection.rows) {
    const d = day(row.occurredAt); d.sales += row.netAmount; d.cogs += row.costAmount ?? 0;
  }
  for (const income of incomes) day(income.incomeDate).sales += income.amount;
  for (const expense of expenses) day(expense.expenseDate).expenses += expense.amount;
  const daily = Object.values(byDay).map(d => ({ ...d, sales: r2(d.sales), cogs: r2(d.cogs), expenses: r2(d.expenses), profit: r2(d.sales - d.cogs - d.expenses) }));
  const sales = r2(projection.rows.reduce((s, row) => s + row.netAmount, 0) + incomes.reduce((s, i) => s + i.amount, 0));
  const costs = costSummary(projection.rows);
  const expenseTotal = r2(expenses.reduce((s, e) => s + e.amount, 0));
  // 损耗仍单列为按当前价的估值，不并入成交成本。
  const lossAmount = r2(lossRecords.reduce((s, l) => s + l.quantity * (l.sku?.costPrice ?? l.product?.costPrice ?? 0), 0));
  return ok(res, { sales, ...costs, expenses: expenseTotal, profit: r2(sales - costs.cogs - expenseTotal),
    lossAmount, orderCount: orderCount(projection.rows, 'sale'), historyIncomplete: projection.historyIncomplete,
    byDay: daily.sort((a, b) => a.date.localeCompare(b.date)) });
};

// ---- 2. 销售统计：成交、退货及作废的净额使用同一事件口径 ----
exports.salesByProduct = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const projection = await projectTrades('sale', start, end);
  const groups = new Map();
  for (const row of projection.rows) {
    const key = row.skuId == null ? `${row.productId}|${row.specText ?? ''}` : `sku:${row.skuId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const list = [...groups.values()].map(rows => {
    const amount = r2(rows.reduce((s, row) => s + row.netAmount, 0));
    const costs = costSummary(rows);
    return { productName: rows[0].productName, specText: rows[0].specText,
      qty: Math.round(rows.reduce((s, row) => s + row.quantity, 0) * 1000) / 1000, amount,
      profit: r2(amount - costs.cogs), profitUnreliable: costs.profitUnreliable, noCostSales: costs.noCostSales };
  }).sort((a, b) => b.amount - a.amount);
  return ok(res, { list, totalAmount: r2(list.reduce((s, x) => s + x.amount, 0)), historyIncomplete: projection.historyIncomplete });
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
  const projection = await projectTrades('sale', start, end);
  const groups = new Map();
  for (const row of projection.rows) {
    if (!groups.has(row.operatorId)) groups.set(row.operatorId, []);
    groups.get(row.operatorId).push(row);
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...groups.keys()] } }, select: { id: true, realName: true } });
  const names = new Map(users.map(u => [u.id, u.realName]));
  const list = [...groups.entries()].map(([id, rows]) => {
    const sales = r2(rows.reduce((s, row) => s + row.netAmount, 0));
    const costs = costSummary(rows);
    return { name: names.get(id) ?? '原开单员工', orders: orderCount(rows, 'sale'), sales,
      profit: r2(sales - costs.cogs), profitUnreliable: costs.profitUnreliable, noCostSales: costs.noCostSales };
  }).sort((a, b) => b.sales - a.sales);
  return ok(res, { list, historyIncomplete: projection.historyIncomplete });
};

// ---- 7. 进货统计：商品分摊净额之和等于供应商和单据净额 ----
exports.purchaseStats = async (req, res) => {
  const { start, end } = parseRange(req.query);
  const projection = await projectTrades('purchase', start, end);
  const supplierIds = [...new Set(projection.rows.map(r => r.partnerId).filter(id => id != null))];
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } });
  const names = new Map(suppliers.map(s => [s.id, s.name]));
  const byProduct = new Map(), bySupplier = new Map();
  for (const row of projection.rows) {
    const key = row.skuId ?? `${row.productName}|${row.specText ?? ''}`;
    if (!byProduct.has(key)) byProduct.set(key, { name: row.productName + (row.specText ? ` ${row.specText}` : ''), qty: 0, amount: 0 });
    const product = byProduct.get(key); product.qty += row.quantity; product.amount += row.netAmount;
    if (!bySupplier.has(row.partnerId)) bySupplier.set(row.partnerId, []);
    bySupplier.get(row.partnerId).push(row);
  }
  return ok(res, {
    total: r2(projection.rows.reduce((s, row) => s + row.netAmount, 0)), orderCount: orderCount(projection.rows, 'purchase'),
    historyIncomplete: projection.historyIncomplete,
    byProduct: [...byProduct.values()].map(x => ({ ...x, qty: Math.round(x.qty * 1000) / 1000, amount: r2(x.amount) })).sort((a, b) => b.amount - a.amount),
    bySupplier: [...bySupplier.entries()].map(([id, rows]) => ({ name: id == null ? '无供应商' : names.get(id) ?? '原供应商',
      amount: r2(rows.reduce((s, row) => s + row.netAmount, 0)), orders: orderCount(rows, 'purchase') })).sort((a, b) => b.amount - a.amount),
  });
};

// ---- 8. 供应商对账单（应付版：期初欠 + 进货/付款往来 + 期末欠）----
// 对账单保留成交事实和所有往来；作废在发生日通过冲账/退款核销。
async function statement(req, res, purchase) {
  const { start, end } = parseRange(req.query);
  const partnerKey = purchase ? 'supplierId' : 'customerId';
  const partnerId = Number(req.query[partnerKey]);
  if (!partnerId) throw httpError(400, `缺少 ${partnerKey}`);
  const partner = await (purchase ? prisma.supplier : prisma.customer).findFirst({ where: { id: partnerId, isDeleted: 0 } });
  if (!partner) throw httpError(404, purchase ? '供应商不存在' : '客户不存在');
  const model = purchase ? prisma.purchaseOrder : prisma.order;
  const [documents, payments] = await Promise.all([
    model.findMany({ where: { [partnerKey]: partnerId, status: { in: ['completed', 'cancelled'] }, createdAt: { lte: end } }, include: { items: true } }),
    prisma.paymentRecord.findMany({ where: { [partnerKey]: partnerId, paidAt: { lte: end } } }),
  ]);
  // 旧版本作废只退现金，没有应收/应付冲账。不能因此在新对账中复活欠款。
  // 缺少可靠撤销证据时拒绝输出可打印金额，保留原数据供人工核对。
  const linkKey = purchase ? 'purchaseOrderId' : 'orderId';
  const allAdjustments = await prisma.paymentRecord.findMany({ where: { [linkKey]: { in: documents.map(d => d.id) }, account: '冲账' } });
  for (const doc of documents) {
    const expected = r2(originalAmount(doc) - (doc.status === 'cancelled' ? 0 : doc.actualAmount));
    const recorded = r2(allAdjustments.filter(p => p[linkKey] === doc.id).reduce((n,p) => n + (p.direction === (purchase ? 'out' : 'in') ? p.amount : -p.amount), 0));
    if (expected !== recorded) throw httpError(409, `历史单据 ${doc.orderNo} 缺少一致的冲账记录，请核对原始单据后再生成对账单`);
  }
  const creditOf = payment => (payment.direction === (purchase ? 'out' : 'in') ? payment.amount : -payment.amount);
  const opening = r2(documents.filter(d => d.createdAt < start).reduce((s, d) => s + originalAmount(d), 0)
    - payments.filter(p => p.paidAt < start).reduce((s, p) => s + creditOf(p), 0));
  const rows = [
    ...documents.filter(d => d.createdAt >= start).map(d => ({ at: d.createdAt, type: purchase ? '进货单' : '销售单',
      ref: d.orderNo, debit: originalAmount(d), credit: 0, note: `${d.items.length}种商品` })),
    ...payments.filter(p => p.paidAt >= start).map(p => ({ at: p.paidAt,
      type: p.account === '冲账' ? (p.note?.includes('取消') || p.note?.includes('作废') ? '作废冲减' : '退货冲减')
        : purchase ? (p.direction === 'out' ? '付款' : '退回款') : (p.direction === 'in' ? '收款' : '退款'),
      ref: p.account === '冲账' ? '' : p.account ?? '', debit: 0, credit: r2(creditOf(p)), note: p.note })),
  ].sort((a, b) => a.at - b.at);
  const periodDebit = r2(rows.reduce((s, x) => s + x.debit, 0));
  const periodCredit = r2(rows.reduce((s, x) => s + x.credit, 0));
  return ok(res, { [purchase ? 'supplier' : 'customer']: { id: partner.id, name: partner.name, phone: partner.phone,
    ...(!purchase ? { address: partner.address } : {}) }, opening, periodDebit, periodCredit,
    closing: r2(opening + periodDebit - periodCredit), rows });
}
exports.supplierStatement = (req, res) => statement(req, res, true);
exports.customerStatement = (req, res) => statement(req, res, false);
