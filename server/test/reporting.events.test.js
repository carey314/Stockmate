process.env.TZ = 'Asia/Shanghai';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct } = require('./helpers/db');
const file = useIsolatedDb(`reporting-events-${process.pid}`);
const prisma = require('../src/config/prisma');
const { runWithTenant } = prisma;
const reports = require('../src/controllers/reports');
const stats = require('../src/controllers/stats');
let ctx, seq = 0;
before(async () => { ctx = await runWithTenant(1, () => seedBase(prisma)); });
after(async () => { await prisma.$disconnect(); dropIsolatedDb(file); });
const call = async (fn, query = {}) => {
  let result;
  await fn({ query, user: { userId: ctx.user.id, role: 'admin' } }, { json(p) { result = p.data; return this; } });
  return result;
};
const period = month => ({ startDate: `2025-${month}-01`, endDate: `2025-${month}-28` });
async function sale({ month = '08', cost = 60, cancelled = false, events = true } = {}) {
  const n = ++seq;
  const { product, sku } = await seedProduct(prisma, { typeId: ctx.type.id, name: `商品${n}`, code: `R${n}`, price: 50, costPrice: 999, quantity: 100 });
  const customer = await prisma.customer.create({ data: { name: `客户${n}` } });
  const order = await prisma.order.create({ data: {
    orderNo: `R${n}`, customerId: customer.id, operatorId: ctx.user.id, status: cancelled ? 'cancelled' : 'completed',
    totalAmount: 100, discountAmount: 10, actualAmount: cancelled ? 0 : 45, originalAmount: events ? 90 : null,
    createdAt: new Date(`2025-${month}-10T10:00:00+08:00`),
    items: { create: [{ storeId: 1, productId: product.id, skuId: sku.id, productName: product.name, quantity: 2, returnedQty: 1,
      unitPrice: 50, subtotal: 100, costSnapshot: cost == null ? null : cost / 2, netAmountCents: events ? 9000 : null, costAmountCents: cost == null ? null : cost * 100 }] },
  }, include: { items: true } });
  if (events) {
    const base = { storeId: 1, documentType: 'sale', documentId: order.id, itemId: order.items[0].id, productId: product.id,
      skuId: sku.id, productName: product.name, partnerId: customer.id, operatorId: ctx.user.id, actorId: ctx.user.id };
    await prisma.tradeEvent.createMany({ data: [
      { ...base, kind: 'sale', occurredAt: order.createdAt, quantity: 2, netAmount: 90, costAmount: cost },
      { ...base, kind: 'return', occurredAt: new Date('2025-09-12T10:00:00+08:00'), quantity: -1, netAmount: -45, costAmount: cost == null ? null : -cost / 2 },
      ...(cancelled ? [{ ...base, kind: 'cancel', occurredAt: new Date('2025-09-20T10:00:00+08:00'), quantity: -1, netAmount: -45, costAmount: cost == null ? null : -cost / 2 }] : []),
    ] });
  }
  return { order, customer, sku };
}

test('跨月退货按发生月记销售和成本，成交月不追改，各商品与员工汇总一致', () => runWithTenant(1, async () => {
  const { order } = await sale();
  const august = await call(reports.profit, period('08'));
  assert.equal(august.sales, 90); assert.equal(august.cogs, 60); assert.equal(august.profit, 30);
  const september = await call(reports.profit, period('09'));
  assert.equal(september.sales, -45); assert.equal(september.cogs, -30); assert.equal(september.profit, -15);
  assert.equal(september.orderCount, 0);
  assert.deepEqual(september.byDay.map(d => [d.sales, d.cogs, d.profit]), [[-45, -30, -15]]);
  const product = (await call(reports.salesByProduct, period('09'))).list[0];
  assert.equal(product.qty, -1); assert.equal(product.amount, -45); assert.equal(product.profit, -15);
  const staff = (await call(reports.staffPerformance, period('09'))).list[0];
  assert.equal(staff.sales, -45); assert.equal(staff.profit, -15); assert.equal(staff.orders, 0);
  await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled', actualAmount: 0 } });
  assert.equal((await call(reports.profit, period('08'))).sales, 90);
}));

test('历史单未知成本不回退当前999元成本，原始折后金额不受actual和returnedQty影响', () => runWithTenant(1, async () => {
  await sale({ month: '07', cost: null, events: false });
  const report = await call(reports.profit, period('07'));
  assert.equal(report.sales, 90); assert.equal(report.cogs, 0); assert.equal(report.profitUnreliable, true); assert.equal(report.noCostSales, 90);
  const product = (await call(reports.salesByProduct, period('07'))).list[0];
  assert.equal(product.amount, 90); assert.equal(product.profitUnreliable, true);
}));

test('跨月作废保留客户历史单和付款，冲账及退款发生期核销，期初期末衔接', () => runWithTenant(1, async () => {
  const { order, customer } = await sale({ month: '06', cancelled: true });
  const base = { orderId: order.id, customerId: customer.id, operatorId: ctx.user.id };
  await prisma.paymentRecord.createMany({ data: [
    { ...base, storeId: 1, direction: 'in', account: '现金', amount: 90, paidAt: order.createdAt },
    { ...base, storeId: 1, direction: 'in', account: '冲账', amount: 90, paidAt: new Date('2025-09-20T10:00:00+08:00') },
    { ...base, storeId: 1, direction: 'out', account: '现金', amount: 90, paidAt: new Date('2025-09-20T10:00:00+08:00') },
  ] });
  const june = await call(reports.customerStatement, { ...period('06'), customerId: customer.id });
  assert.equal(june.periodDebit, 90); assert.equal(june.periodCredit, 90); assert.equal(june.closing, 0);
  const sept = await call(reports.customerStatement, { ...period('09'), customerId: customer.id });
  assert.equal(sept.opening, 0); assert.equal(sept.rows.length, 2); assert.equal(sept.closing, 0);
}));

test('今日看板及趋势读发生期事件，旧单今天退货同样入今日净销售', () => runWithTenant(1, async () => {
  const { order } = await sale({ month: '05' });
  const today = new Date();
  await prisma.tradeEvent.updateMany({ where: { documentId: order.id, kind: 'return' }, data: { occurredAt: today } });
  const overview = await call(stats.overview);
  assert.equal(overview.todaySales, -45); assert.equal(overview.todayCogs, -30); assert.equal(overview.todayProfit, -15);
  assert.equal(overview.todayOrderCount, 0);
  const daily = await call(stats.sales, { days: '1' });
  assert.equal(daily[0].sales, -45); assert.equal(daily[0].orders, 0);
}));

test('采购统计跨月折后净额按商品和供应商一致，供应商对账保留已作废原单', () => runWithTenant(1, async () => {
  const { sku, product } = await seedProduct(prisma, { typeId: ctx.type.id, name: '采购货', code: 'PURCHASE', price: 50, quantity: 0 });
  const supplier = await prisma.supplier.create({ data: { name: '采购供应商' } });
  const po = await prisma.purchaseOrder.create({ data: { orderNo: 'PURCHASE', supplierId: supplier.id, operatorId: ctx.user.id,
    status: 'cancelled', createdAt: new Date('2025-04-10T10:00:00+08:00'), totalAmount: 100, discountAmount: 10, originalAmount: 90,
    items: { create: [{ storeId: 1, skuId: sku.id, productName: product.name, quantity: 2, unitPrice: 50, subtotal: 100, netAmountCents: 9000 }] },
  }, include: { items: true } });
  const base = { storeId: 1, documentType: 'purchase', documentId: po.id, itemId: po.items[0].id, productId: product.id,
    skuId: sku.id, productName: product.name, partnerId: supplier.id, operatorId: ctx.user.id, actorId: ctx.user.id };
  await prisma.tradeEvent.createMany({ data: [
    { ...base, kind: 'purchase', occurredAt: po.createdAt, quantity: 2, netAmount: 90 },
    { ...base, kind: 'return', occurredAt: new Date('2025-09-12T10:00:00+08:00'), quantity: -1, netAmount: -45 },
  ] });
  const april = await call(reports.purchaseStats, period('04')); assert.equal(april.total, 90); assert.equal(april.byProduct[0].amount, 90);
  const sept = await call(reports.purchaseStats, period('09')); assert.equal(sept.total, -45); assert.equal(sept.byProduct[0].qty, -1);
  assert.equal(sept.bySupplier[0].amount, -45); assert.equal(sept.orderCount, 0);
  await prisma.paymentRecord.createMany({ data: [
    { storeId: 1, purchaseOrderId: po.id, supplierId: supplier.id, operatorId: ctx.user.id, direction: 'out', account: '现金', amount: 90, paidAt: po.createdAt },
    { storeId: 1, purchaseOrderId: po.id, supplierId: supplier.id, operatorId: ctx.user.id, direction: 'out', account: '冲账', amount: 90, paidAt: new Date('2025-09-20T10:00:00+08:00') },
    { storeId: 1, purchaseOrderId: po.id, supplierId: supplier.id, operatorId: ctx.user.id, direction: 'in', account: '现金', amount: 90, paidAt: new Date('2025-09-20T10:00:00+08:00') },
  ] });
  const statement = await call(reports.supplierStatement, { ...period('04'), supplierId: supplier.id });
  assert.equal(statement.periodDebit, 90); assert.equal(statement.periodCredit, 90); assert.equal(statement.closing, 0);
  assert.equal((await call(reports.supplierStatement, { ...period('09'), supplierId: supplier.id })).closing, 0);
}));

test('旧单只有新退货事件仍保留原成交fallback，未知成本来回全部冲销后可靠', () => runWithTenant(1, async () => {
  const { order, customer, sku } = await sale({ month: '03', cost: null, events: false });
  const base = { storeId: 1, documentType: 'sale', documentId: order.id, itemId: order.items[0].id, productId: sku.productId,
    skuId: sku.id, productName: order.items[0].productName, partnerId: customer.id, operatorId: ctx.user.id, actorId: ctx.user.id };
  await prisma.tradeEvent.create({ data: { ...base, kind: 'return', occurredAt: new Date('2025-03-12T10:00:00+08:00'), quantity: -2, netAmount: -90, costAmount: null } });
  const march = await call(reports.profit, period('03'));
  assert.equal(march.sales, 0); assert.equal(march.cogs, 0); assert.equal(march.profitUnreliable, false); assert.equal(march.orderCount, 1);
}));

test('零成本是已知成本；上海午夜边界分月且外店事件不混入', () => runWithTenant(1, async () => {
  const { order } = await sale({ month: '02', cost: 0 });
  await prisma.tradeEvent.updateMany({ where: { documentId: order.id, kind: 'sale' }, data: { occurredAt: new Date('2025-02-28T23:59:59.999+08:00') } });
  await prisma.tradeEvent.updateMany({ where: { documentId: order.id, kind: 'return' }, data: { occurredAt: new Date('2025-03-01T00:00:00+08:00') } });
  await runWithTenant(2, () => prisma.tradeEvent.create({ data: { storeId: 2, documentType: 'sale', documentId: 99999, itemId: 99999,
    kind: 'sale', occurredAt: new Date('2025-02-28T12:00:00+08:00'), productId: 99999, productName: '外店商品', operatorId: 99999, actorId: 99999, quantity: 10, netAmount: 99999, costAmount: 0 } }));
  const feb = await call(reports.profit, period('02'));
  assert.equal(feb.sales, 90); assert.equal(feb.cogs, 0); assert.equal(feb.profitUnreliable, false);
  assert.equal(feb.byDay[0].date, '2025-02-28');
  const first = await call(reports.profit, { startDate: '2025-03-01', endDate: '2025-03-01' });
  assert.equal(first.sales, -45); assert.equal(first.cogs, 0); assert.equal(first.profitUnreliable, false);
}));

test('旧配方扣料证据下整单旧成本快照保守未知，普通旧单快照仍可靠', () => runWithTenant(1, async () => {
  const { order, sku } = await sale({ month: '01', cost: 1998, events: false });
  await prisma.orderItem.update({ where: { id: order.items[0].id }, data: { costAmountCents: null, returnedQty: 0 } });
  await prisma.orderItem.create({ data: { orderId: order.id, productId: sku.productId, skuId: sku.id, productName: '混合普通行',
    quantity: 1, unitPrice: 10, subtotal: 10, costSnapshot: 5 } });
  await prisma.order.update({ where: { id: order.id }, data: { totalAmount: 110, actualAmount: 100 } });
  await prisma.inventoryRecord.create({ data: { productId: sku.productId, skuId: sku.id, type: 'outbound', quantity: 4,
    beforeQuantity: 100, afterQuantity: 96, reason: '配方扣料 销售单 OLD', relatedOrderId: order.id, operatorId: ctx.user.id } });
  const report = await call(reports.profit, period('01'));
  assert.equal(report.sales, 100); assert.equal(report.cogs, 0, '不能把旧成品999元成本当作原料成本，也无法区分混合单中哪行扣料');
  assert.equal(report.profitUnreliable, true); assert.equal(report.noCostSales, 100); assert.equal(report.historyIncomplete, true);
  const normal = await sale({ month: '12', cost: 60, events: false });
  await prisma.orderItem.update({ where: { id: normal.order.items[0].id }, data: { costAmountCents: null, returnedQty: 0 } });
  const plain = await call(reports.profit, period('12'));
  assert.equal(plain.cogs, 60); assert.equal(plain.profitUnreliable, false);
}));
