// 真ask控制器+真账务服务，唯一桩是模型调用边界；禁止调用付费模型。
process.env.TZ = 'Asia/Shanghai';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedProduct } = require('./helpers/db');
const file = useIsolatedDb(`ai-snapshot-${process.pid}`);
const prisma = require('../src/config/prisma');
const { transaction } = require('../src/utils/transaction');
const { createSale } = require('../src/services/sales');
const { reverseTrade } = require('../src/services/reversals');
const { localDayKey } = require('../src/utils/biz');
const deepseek = require('../src/utils/deepseek');
let captured, sequence = 0;
const originalCall = deepseek.callDeepSeek;
deepseek.callDeepSeek = async (system, content) => {
  captured = { system, snapshot: JSON.parse(content.slice('经营快照：\n'.length, content.indexOf('\n\n店主的问题：'))) };
  return { answer: '请查看报表中的经营数据。' };
};
const ai = require('../src/controllers/ai');
const reports = require('../src/controllers/reports');
after(async () => { deepseek.callDeepSeek = originalCall; await prisma.$disconnect(); dropIsolatedDb(file); });
async function fixture(fn) {
  const store = await prisma.basePrisma.store.create({ data: { name: `AI快照${++sequence}` } });
  await prisma.runWithTenant(store.id, async () => {
    const user = await prisma.user.create({ data: { username: `ai${sequence}`, realName: '老板', role: 'admin', passwordHash: 'unused' } });
    const type = await prisma.productType.create({ data: { name: '测试' } });
    const customer = await prisma.customer.create({ data: { name: '老王' } });
    const product = opts => seedProduct(prisma, { typeId: type.id, code: `P${sequence}`, name: '快照货', price: 50, costPrice: 30, quantity: 20, ...opts });
    const ask = async () => { await ai.ask({ body: { question: '本月赚了多少，老王欠多少？' }, user: { userId: user.id, role: 'admin' } }, { json() {} }); return captured.snapshot; };
    const report = async () => {
      const now = new Date(); let data;
      await reports.profit({ query: { startDate: localDayKey(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: localDayKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)) } }, { json(p) { data = p.data; } });
      return data;
    };
    await fn({ user, customer, product, ask, report });
  });
}

test('ask真实模型输入使用成交成本与退货净额，改当前进价不改利润，冲账不重复扣客户欠款', () => fixture(async ({ user, customer, product, ask, report }) => {
  const { sku } = await product();
  const { order } = await transaction(tx => createSale(tx, { customerId: customer.id, paidAmount: 40, discountAmount: 10, items: [{ skuId: sku.id, quantity: 2, unitPrice: 50 }] }, user.id));
  await transaction(tx => reverseTrade(tx, 'sale', order.id, { items: [{ itemId: order.items[0].id, quantity: 1 }] }, user.id));
  await prisma.sku.update({ where: { id: sku.id }, data: { costPrice: 999 } });
  const snap = await ask(); const rep = await report();
  assert.equal(snap.本月.销货成本, rep.cogs); assert.equal(snap.本月.销货成本, 30);
  assert.equal(snap.本月.销售额, rep.sales); assert.equal(snap.本月.毛利, rep.profit);
  assert.deepEqual(snap.客户欠款排行, [{ name: '老王', owed: 5 }]);
  assert.equal(snap.本月热销Top5[0].qty, 1); assert.equal(snap.本月热销Top5[0].amount, 45);
  assert.equal(snap.今日.毛利, 15); assert.equal(snap.今日.销货成本, 30);
}));

test('ask跨月旧单今天退货记入本月与今日负销售/负成本/热销净量', () => fixture(async ({ user, customer, product, ask, report }) => {
  const { sku } = await product();
  const { order } = await transaction(tx => createSale(tx, { customerId: customer.id, paidAmount: 0, discountAmount: 10, items: [{ skuId: sku.id, quantity: 2, unitPrice: 50 }] }, user.id));
  const now = new Date(); const previousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 12);
  await prisma.order.update({ where: { id: order.id }, data: { createdAt: previousMonth } });
  await prisma.tradeEvent.updateMany({ where: { documentId: order.id, kind: 'sale' }, data: { occurredAt: previousMonth } });
  await transaction(tx => reverseTrade(tx, 'sale', order.id, { items: [{ itemId: order.items[0].id, quantity: 1 }] }, user.id));
  const snap = await ask(); const rep = await report();
  assert.equal(snap.本月.销售额, -45); assert.equal(snap.本月.销货成本, -30); assert.equal(snap.本月.毛利, rep.profit);
  assert.equal(snap.本月.订单数, 0); assert.equal(snap.今日.销售额, -45); assert.equal(snap.今日.销货成本, -30);
  assert.equal(snap.本月热销Top5[0].qty, -1); assert.equal(snap.本月热销Top5[0].amount, -45);
  assert.deepEqual(snap.客户欠款排行, [{ name: '老王', owed: 45 }]);
}));

test('ask未知成本保持未知，不能给模型确定毛利；无库存收入在日/月使用同口径', () => fixture(async ({ user, product, ask, report }) => {
  const { sku, product: p } = await product({ costPrice: null });
  await transaction(tx => createSale(tx, { items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }] }, user.id));
  await prisma.sku.update({ where: { id: sku.id }, data: { costPrice: 99 } });
  await prisma.product.update({ where: { id: p.id }, data: { costPrice: 88 } });
  await prisma.income.create({ data: { source: '其他收入', amount: 7, operatorId: user.id } });
  const snap = await ask(); const rep = await report();
  assert.equal(snap.本月.销售额, rep.sales); assert.equal(snap.本月.销售额, 57); assert.equal(snap.今日.销售额, 57);
  assert.equal(snap.本月.毛利, null); assert.equal(snap.今日.毛利, null);
  assert.equal(snap.本月.销货成本, null); assert.equal(snap.本月.成本数据不完整, true); assert.equal(snap.本月.无成本销售额, 50);
}));

test('ask全额退款不残留客户欠款，补货销速按退货净量计算', () => fixture(async ({ user, customer, product, ask }) => {
  const { sku } = await product({ quantity: 0 });
  const { order } = await transaction(tx => createSale(tx, { customerId: customer.id, items: [{ skuId: sku.id, quantity: 14, unitPrice: 50 }] }, user.id));
  await transaction(tx => reverseTrade(tx, 'sale', order.id, { items: [{ itemId: order.items[0].id, quantity: 14 }] }, user.id));
  const snap = await ask();
  assert.deepEqual(snap.客户欠款排行, []); assert.deepEqual(snap.补货建议_按销速计算, []);
  assert.equal(snap.本月.销售额, 0); assert.equal(snap.本月.销货成本, 0); assert.equal(snap.本月.毛利, 0);
  assert.equal(snap.本月热销Top5[0].qty, 0); assert.equal(snap.本月热销Top5[0].amount, 0);
}));
