// S08: isolated real HTTP export, no AI/payment/network services.
process.env.JWT_SECRET = 'export-test-only';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');
const file = useIsolatedDb(`export-complete-${process.pid}`);
const prisma = require('../src/config/prisma');
const { basePrisma: db } = prisma;
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
app.use('/api/v1', require('../src/routes'));
app.use(require('../src/middlewares/errorHandler'));
let server, own, other, capture = false;
const queries = [];
db.$use(async (params, next) => {
  if (capture) queries.push({ model: params.model, action: params.action, inTransaction: params.runInTransaction });
  return next(params);
});
async function seed(name) {
  const store = await db.store.create({ data: { name } });
  const storeId = store.id;
  const user = await db.user.create({ data: { storeId, username: name, realName: `${name}老板`, passwordHash: `${name}-PASSWORD-HASH`, role: 'admin' } });
  const staff = await db.user.create({ data: { storeId, username: `${name}-staff`, realName: `${name}店员`, passwordHash: 'STAFF-PASSWORD-HASH', role: 'staff' } });
  const type = await db.productType.create({ data: { storeId, name, isDeleted: 1 } });
  await db.fieldDefinition.create({ data: { storeId, productTypeId: type.id, key: 'size', label: '大小', affectsStock: 0 } });
  const product = await db.product.create({ data: { storeId, code: name, name, productTypeId: type.id, isDeleted: 1, imageUrl: '/uploads/test.jpg' } });
  const sku = await db.sku.create({ data: { storeId, productId: product.id, code: name, price: 31.66, costPrice: 6 } });
  await db.inventory.create({ data: { storeId, productId: product.id, skuId: sku.id, quantity: -2 } });
  const customer = await db.customer.create({ data: { storeId, name, isDeleted: 1 } });
  const supplier = await db.supplier.create({ data: { storeId, name } });
  await db.pricingRule.create({ data: { storeId, productId: product.id, skuId: sku.id, customerId: customer.id, price: 10.55 } });
  await db.recipe.create({ data: { storeId, ownerSkuId: sku.id, componentSkuId: sku.id, qty: 0.5 } });
  const order = await db.order.create({ data: { storeId, orderNo: name, customerId: customer.id, operatorId: staff.id, status: 'cancelled', totalAmount: 33, discountAmount: 1.34, actualAmount: 0, originalAmount: 31.66, paidAmount: 0 } });
  const item = await db.orderItem.create({ data: { storeId, orderId: order.id, productId: product.id, skuId: sku.id, productName: name, quantity: 3, returnedQty: 3, unitPrice: 11, subtotal: 33, netAmountCents: 3166, costSnapshot: null, costAmountCents: null, stockSnapshot: '[{"qty":3}]' } });
  const purchase = await db.purchaseOrder.create({ data: { storeId, orderNo: name, supplierId: supplier.id, operatorId: staff.id, actualAmount: 9, originalAmount: null, paidAmount: 4 } });
  await db.purchaseOrderItem.create({ data: { storeId, purchaseOrderId: purchase.id, skuId: sku.id, productName: name, quantity: 2, unitPrice: 5, subtotal: 10, netAmountCents: 900 } });
  await db.inventoryRecord.create({ data: { storeId, productId: product.id, skuId: sku.id, operatorId: staff.id, type: 'outbound', quantity: 3, beforeQuantity: 1, afterQuantity: -2, relatedOrderId: order.id } });
  await db.income.create({ data: { storeId, source: name, amount: 12.34, operatorId: staff.id } });
  await db.expense.create({ data: { storeId, category: name, amount: 5.67, operatorId: staff.id } });
  await db.paymentRecord.create({ data: { storeId, direction: 'out', amount: 4, purchaseOrderId: purchase.id, supplierId: supplier.id, operatorId: staff.id } });
  const stocktake = await db.stocktake.create({ data: { storeId, orderNo: name, totalItems: 1, diffItems: 1, lossQty: 2, operatorId: staff.id } });
  await db.stocktakeItem.create({ data: { storeId, stocktakeId: stocktake.id, skuId: sku.id, productName: name, systemQty: 0, actualQty: -2, diff: -2 } });
  for (const [key, value] of Object.entries({ shopName: name, mainTypeId: String(type.id), allowNegativeStock: 'true', applePrivateKey: 'SECRET-APPLE-KEY', futureSetting: 'SECRET-UNKNOWN' })) {
    await db.setting.create({ data: { storeId, key, value } });
  }
  const event = await db.tradeEvent.create({ data: { storeId, documentType: 'sale', documentId: order.id, itemId: item.id, kind: 'return', occurredAt: new Date('2026-08-01T12:00:00Z'), productId: product.id, skuId: sku.id, productName: name, partnerId: customer.id, operatorId: staff.id, actorId: user.id, quantity: -1, netAmount: -10.55, costAmount: null } });
  const confirmation = await db.entryConfirmation.create({ data: { storeId, requestKey: 'business-idempotency-key', actorId: user.id, contentHash: 'business-content-digest', response: JSON.stringify({ orders: [{ id: order.id }], message: 'success' }) } });
  await db.authIdentity.create({ data: { userId: user.id, provider: 'apple', openId: `${name}-SECRET-OPENID` } });
  await db.entitlement.create({ data: { storeId, plan: 'pro', source: 'apple', status: 'expired', externalId: `${name}-SECRET-EXTERNAL-ID`, appleTransactionId: 'SECRET-APPLE-TXN', note: 'SECRET-PAYMENT-NOTE', expiresAt: new Date('2020-01-01') } });
  await db.aiUsage.create({ data: { storeId, day: '2026-09-08', calls: 9, endpoint: 'parse-entry' } });
  await db.webLoginChallenge.create({ data: { storeId, userId: user.id, nonceHash: 'SECRET-NONCE', expiresAt: new Date('2030-01-01') } });
  await db.webLoginCode.create({ data: { storeId, userId: user.id, appleSub: `${name}-SECRET-APPLE-SUB`, codeHash: `${name}-SECRET-CODE`, expiresAt: new Date('2030-01-01') } });
  return { store, user, staff, type, product, sku, order, purchase, stocktake, event, confirmation };
}
before(async () => {
  own = await seed('OWN'); other = await seed('OTHER');
  // Bad historical relation ownership must not bypass scoped nested reads.
  await db.fieldDefinition.create({ data: { storeId: other.store.id, productTypeId: own.type.id, key: 'foreign', label: 'FOREIGN-NESTED' } });
  await db.orderItem.create({ data: { storeId: other.store.id, orderId: own.order.id, productId: other.product.id, productName: 'FOREIGN-NESTED', quantity: 1, unitPrice: 1, subtotal: 1 } });
  await db.purchaseOrderItem.create({ data: { storeId: other.store.id, purchaseOrderId: own.purchase.id, skuId: other.sku.id, productName: 'FOREIGN-NESTED', quantity: 1, unitPrice: 1, subtotal: 1 } });
  await db.stocktakeItem.create({ data: { storeId: other.store.id, stocktakeId: own.stocktake.id, skuId: other.sku.id, productName: 'FOREIGN-NESTED', systemQty: 0, actualQty: 0, diff: 0 } });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); dropIsolatedDb(file); });
async function exportAs(user = own.user, suffix = '') {
  const token = user && jwt.sign({ userId: user.id, role: 'admin', storeId: other.store.id }, process.env.JWT_SECRET);
  const result = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/export/all${suffix}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: result.status, ...(await result.json()) };
}
const serialized = value => JSON.parse(JSON.stringify(value));

test('S08 免费管理员导出经营数据、配置和历史，并保留旧中文键及快照金额', async () => {
  const r = await exportAs(); assert.equal(r.status, 200, r.message);
  assert.equal(r.data.version, 'stockmate-export-v2');
  const data = r.data.数据;
  for (const key of ['品类','商品','规格','库存','客户','供应商','销售单','进货单','收入','支出','收付款流水','出入库流水','专属价','配方','盘点单','店铺设置','交易事件','录入确认','员工','店铺','权益状态','AI用量']) {
    assert.ok(data[key]?.length, `Missing export data: ${key}`);
  }
  assert.equal(data.商品[0].isDeleted, 1);
  assert.equal(data.品类[0].fields.length, 1); assert.equal(data.销售单[0].items.length, 1);
  assert.equal(data.进货单[0].items.length, 1); assert.equal(data.盘点单[0].items.length, 1);
  assert.equal(data.销售单[0].originalAmount, 31.66); assert.equal(data.销售单[0].actualAmount, 0);
  assert.equal(data.销售单[0].items[0].netAmountCents, 3166); assert.equal(data.销售单[0].items[0].costSnapshot, null);
  assert.equal(data.进货单[0].originalAmount, null);
  assert.deepEqual(data.交易事件, [serialized(own.event)]);
  assert.deepEqual(data.录入确认, [serialized(own.confirmation)]);
  assert.deepEqual(data.店铺设置.map(s => s.key).sort(), ['allowNegativeStock','mainTypeId','shopName']);
  assert.equal(data.员工.find(u => u.id === own.staff.id).realName, 'OWN店员');
  assert.equal(r.data.manifest.restorable, false);
  assert.equal(r.data.manifest.scopedStore.id, own.store.id);
  assert.ok(r.data.manifest.omissions.length);
  const omitted = r.data.manifest.omissions.find(entry => entry.model === 'Setting');
  assert.deepEqual(omitted.keys, ['applePrivateKey', 'futureSetting']);
  for (const [model, key] of [
    ['fieldDefinition','字段定义'], ['product','商品'], ['sku','规格'], ['inventory','库存'],
    ['customer','客户'], ['supplier','供应商'], ['orderItem','销售明细'], ['purchaseOrderItem','进货明细'],
    ['income','收入'], ['expense','支出'], ['paymentRecord','收付款流水'], ['inventoryRecord','出入库流水'],
    ['pricingRule','专属价'], ['recipe','配方'], ['stocktakeItem','盘点明细'], ['aiUsage','AI用量'],
  ]) {
    assert.deepEqual(data[key], serialized(await db[model].findMany({ where: { storeId: own.store.id }, orderBy: { id: 'asc' } })), key);
  }
});

test('SMS导出只包含请求者自己的可信手机号元数据，不泄露员工/其他店身份或验证码票据',async()=>{
 await db.phoneIdentity.create({data:{userId:own.user.id,phone:'+8613800000101'}});
 await db.phoneIdentity.create({data:{userId:own.staff.id,phone:'+8613800000102'}});
 await db.phoneIdentity.create({data:{userId:other.user.id,phone:'+8613800000103'}});
 const result=await exportAs();assert.equal(result.status,200);
 assert.equal(result.data.数据.本人手机号绑定.length,1);
 assert.equal(result.data.数据.本人手机号绑定[0].phone,'+8613800000101');
 assert.equal(result.data.数据.本人手机号绑定[0].userId,own.user.id);
 const raw=JSON.stringify(result.data);assert.ok(!raw.includes('+8613800000102'));assert.ok(!raw.includes('+8613800000103'));
 for(const model of ['SmsChallenge','SmsReauth','SmsRateBucket'])assert.ok(result.data.manifest.omissions.some(item=>item.model===model));
});

test('S08 顶层与嵌套均隔离店铺，不导出密码身份登录码或支付凭证', async () => {
  const r = await exportAs(own.user, `?storeId=${other.store.id}`); assert.equal(r.status, 200);
  const json = JSON.stringify(r.data.数据);
  for (const text of ['OTHER','FOREIGN-NESTED','PASSWORD-HASH','SECRET-','passwordHash','openId','nonceHash','codeHash','appleSub','externalId','appleTransactionId']) assert.equal(json.includes(text), false, `Leaked ${text}`);
  const ownOrders = await db.order.findMany({ where: { storeId: own.store.id } });
  assert.deepEqual(r.data.数据.销售单.map(({ items, ...row }) => row), serialized(ownOrders));
  assert.deepEqual(await db.tradeEvent.findUnique({ where: { id: own.event.id } }), own.event);
});

test('S08 登录权限由数据库角色判定；伪造token管理员、未登录、禁用账号不可导出', async () => {
  assert.equal((await exportAs(null)).status, 401);
  assert.equal((await exportAs(own.staff)).status, 403);
  await db.user.update({ where: { id: own.staff.id }, data: { status: 0 } });
  assert.equal((await exportAs(own.staff)).status, 401);
});

test('S08 所有经营表读取位于同一个导出事务中', async () => {
  queries.length = 0; capture = true;
  let result;
  try { result = await exportAs(); } finally { capture = false; }
  assert.equal(result.status, 200);
  const reads = queries.filter(q => q.action === 'findMany');
  assert.ok(reads.length >= 20, `Expected full export queries, got ${reads.length}`);
  assert.ok(reads.every(q => q.inTransaction), JSON.stringify(reads.filter(q => !q.inTransaction)));
  assert.equal(queries.some(q => /create|update|delete|upsert|executeRaw/i.test(q.action)), false);
});
