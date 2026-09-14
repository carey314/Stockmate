process.env.JWT_SECRET = 'manual-sale-isolated-only';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedProduct } = require('./helpers/db');
const file = useIsolatedDb(`manual-sale-${process.pid}`);
const prisma = require('../src/config/prisma');
const express = require('express'), jwt = require('jsonwebtoken');
const app = express(); app.use(express.json()); app.use('/api/v1', require('../src/routes')); app.use(require('../src/middlewares/errorHandler'));
let server, seq = 0;
before(async () => { server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); });
after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); dropIsolatedDb(file); });
async function fixture(fn) {
  const store = await prisma.basePrisma.store.create({ data: { name: `手工店${++seq}` } });
  return prisma.runWithTenant(store.id, async () => {
    const user = await prisma.user.create({ data: { username: `manual${seq}`, passwordHash: 'unused', realName: '老板', role: 'admin' } });
    const type = await prisma.productType.create({ data: { name: '货' } });
    const { sku } = await seedProduct(prisma, { typeId: type.id, code: 'SALE', name: '散称货', price: 10, costPrice: null, quantity: 10 });
    const customer = await prisma.customer.create({ data: { name: '老王' } });
    const api = async (body, actor = user) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: actor.id, role: actor.role }, process.env.JWT_SECRET)}` }, body: JSON.stringify(body) });
      return { status: r.status, ...await r.json() };
    };
    await fn({ api, sku, customer, user });
  });
}
test('同ID并发、丢响应重试：一单一次小数出库一笔部分收款，改内容409，不扣AI额度', () => fixture(async ({ api, sku, customer }) => {
  const body = { requestId: 'manual-stable-request', customerId: customer.id, items: [{ skuId: sku.id, quantity: 1.25, unitPrice: 10 }], discountAmount: 2.5, paidAmount: 6, settlementAccount: '微信', notes: '测试' };
  const results = await Promise.all([api(body), api(body)]);
  assert.equal(results[0].status, 201); assert.equal(results[1].status, 201);
  assert.equal(results[0].data.id, results[1].data.id);
  const replay = await api({ ...body, items: [{ unitPrice: 10, quantity: 1.25, skuId: sku.id }] });
  assert.equal(replay.data.id, results[0].data.id); assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.actualAmount, 10); assert.equal(replay.data.unpaidAmount, 4); assert.equal(replay.data.items[0].costSnapshot, null);
  assert.equal((await api({ ...body, notes: '改了' })).status, 409);
  assert.equal(await prisma.order.count(), 1); assert.equal(await prisma.paymentRecord.count(), 1); assert.equal(await prisma.inventoryRecord.count(), 1); assert.equal(await prisma.tradeEvent.count(), 1);
  assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 8.75);
  assert.equal(await prisma.basePrisma.aiUsage.count({ where: { storeId: prisma.getTenantId() } }), 0);
}));
test('明确校验失败回滚确认；散客不可挂账，禁负库存仍生效，旧客户端无ID仍逐单建单', () => fixture(async ({ api, sku }) => {
  const body = { requestId: 'manual-invalid-then-correct', items: [{ skuId: sku.id, quantity: 1, unitPrice: 10 }], paidAmount: 0 };
  assert.equal((await api(body)).status, 400); assert.equal(await prisma.entryConfirmation.count(), 0);
  assert.equal((await api({ ...body, paidAmount: 10 })).status, 201);
  await prisma.setting.create({ data: { key: 'allowNegativeStock', value: '0' } });
  assert.equal((await api({ ...body, requestId: 'no-negative-stock', paidAmount: 100, items: [{ skuId: sku.id, quantity: 100, unitPrice: 1 }] })).status, 400);
  const legacy = { items: body.items };
  assert.notEqual((await api(legacy)).data.id, (await api(legacy)).data.id);
  assert.equal(await prisma.order.count(), 3);
}));
test('确认编号按经办人隔离，员工权限仍通过原路由认证裁决', () => fixture(async ({ api, sku }) => {
  const staff = await prisma.user.create({ data: { username: `staff${seq}`, passwordHash: 'unused', realName: '员工', role: 'staff' } });
  const body = { requestId: 'same-id-distinct-actor', items: [{ skuId: sku.id, quantity: 1, unitPrice: 10 }] };
  const a = await api(body), b = await api(body, staff);
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.notEqual(a.data.id, b.data.id);
  assert.equal(await prisma.entryConfirmation.count(), 2);
}));
test('同ID跨店彼此独立，跨店客户或规格不可落单', () => fixture(async ({ api, sku, customer }) => {
  const body = { requestId: 'same-id-other-store', customerId: customer.id, items: [{ skuId: sku.id, quantity: 1, unitPrice: 10 }] };
  const own = await api(body); assert.equal(own.status, 201);
  await fixture(async ({ api: other, sku: otherSku, customer: otherCustomer }) => {
    assert.equal((await other(body)).status, 404); assert.equal(await prisma.order.count(), 0); assert.equal(await prisma.entryConfirmation.count(), 0);
    assert.equal((await other({ ...body, customerId: otherCustomer.id })).status, 404);
    const valid = await other({ ...body, customerId: otherCustomer.id, items: [{ skuId: otherSku.id, quantity: 1, unitPrice: 10 }] });
    assert.equal(valid.status, 201); assert.notEqual(valid.data.id, own.data.id); assert.equal(valid.data.replayed, false);
  });
  assert.equal(await prisma.order.count(), 1);
}));
test('无效明细返回校验错误而非500，不留下确认占位', () => fixture(async ({ api }) => {
  assert.equal((await api({ requestId: 'invalid-null-item', items: [null] })).status, 400);
  assert.equal(await prisma.entryConfirmation.count(), 0);
}));
