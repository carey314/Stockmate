// 正确行为回归：隔离库+真实HTTP，不调用AI、不连接现有服务。
process.env.TZ = 'Asia/Shanghai';
process.env.JWT_SECRET = 'batch1-test-only';
process.env.FREE_AI_DAILY_CORE = '0';
process.env.FREE_AI_DAILY_OTHER = '0';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedProduct } = require('./helpers/db');
const file = useIsolatedDb(`quality-batch1-${process.pid}`);
const prisma = require('../src/config/prisma');
const { runWithTenant, basePrisma } = prisma;
const jwt = require('jsonwebtoken');
const express = require('express');
let modelDraft = {};
require('../src/utils/deepseek').callDeepSeek = async () => modelDraft;
const app = express(); app.use(express.json());
app.use('/api/v1', require('../src/routes'));
app.use(require('../src/middlewares/errorHandler'));
let server, seq = 0;
before(async () => { server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); });
after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); dropIsolatedDb(file); });
async function fixture(fn) {
  const store = await basePrisma.store.create({ data: { name: `回归店${++seq}` } });
  return runWithTenant(store.id, async () => {
    const user = await prisma.user.create({ data: { username: `q${seq}`, realName: '老板', passwordHash: 'unused', role: 'admin' } });
    const type = await prisma.productType.create({ data: { name: '测试品类' } });
    const customer = await prisma.customer.create({ data: { name: '记名客户' } });
    const supplier = await prisma.supplier.create({ data: { name: '供应商' } });
    let pseq = 0;
    const product = opts => seedProduct(prisma, { typeId: type.id, name: `货${++pseq}`, code: `Q${pseq}`, price: 10, costPrice: 6, quantity: 100, ...opts });
    const api = async (url, body, method = body === undefined ? 'GET' : 'POST', who = user) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${url}`, { method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ userId: who.id, role: who.role }, process.env.JWT_SECRET)}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, ...(await r.json()) };
    };
    await fn({ api, user, store, type, customer, supplier, product });
  });
}
const range = 'startDate=2000-01-01&endDate=2099-12-31';

test('S01 指定整箱入正确SKU，生成挂账采购，付款40后欠60且仅真实支出40', () => fixture(async ({ api, product, supplier }) => {
  const p = await product();
  const sku = await prisma.sku.create({ data: { productId: p.product.id, code: 'BOX', specText: '整箱', price: 100, isDefault: 0, costPrice: 50 } });
  await prisma.inventory.create({ data: { productId: p.product.id, skuId: sku.id, quantity: 0 } });
  const r = await api('/ai/confirm-entry', { requestId: 'purchase-credit', purchases: [{ skuId: sku.id, productId: p.product.id, name: '货整箱', quantity: 2, unitCost: 50, totalCost: 100, supplierId: supplier.id, settlementAccount: '挂账' }] });
  assert.equal(r.status, 200, r.message);
  assert.equal((await prisma.inventory.findUnique({ where: { skuId: p.sku.id } })).quantity, 100);
  assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 2);
  assert.equal(r.data.purchaseOrders.length, 1);
  const po = r.data.purchaseOrders[0]; assert.equal(po.paidAmount, 0); assert.equal(po.unpaidAmount, 100);
  assert.equal(await prisma.paymentRecord.count(), 0); assert.equal(await prisma.expense.count(), 0);
  const pay = await api(`/purchase-orders/${po.id}/pay`, { amount: 40, settlementAccount: '微信' });
  assert.equal(pay.status, 200); assert.equal(pay.data.unpaidAmount, 60);
  assert.equal((await prisma.paymentRecord.findMany())[0].amount, 40);
}));

test('S01 多规格旧productId不能默选默认；无档案仅支出明确成功', () => fixture(async ({ api, product }) => {
  const p = await product(); await prisma.sku.create({ data: { productId: p.product.id, code: 'SECOND', specText: '整箱', price: 60 } });
  const r = await api('/ai/confirm-entry', { purchases: [{ productId: p.product.id, name: '货', quantity: 1, unitCost: 6 }] });
  assert.equal(r.status, 400); assert.match(r.message, /规格/);
  const exp = await api('/ai/confirm-entry', { requestId: 'expense-only', purchases: [{ expenseOnly: true, name: '临时材料', quantity: 2, unitCost: 5, totalCost: 10 }] });
  assert.equal(exp.status, 200, exp.message); assert.equal(exp.data.expenses[0].amount, 10);
  assert.equal(await prisma.purchaseOrder.count(), 0);
}));

test('S02 无档案赊销不伪造Income；金额不一致不能静默吞改价', () => fixture(async ({ api, customer }) => {
  const credit = await api('/ai/confirm-entry', { sales: [{ customerId: customer.id, name: '无档案货', quantity: 2, unitPrice: 15, totalAmount: 30, paid: false }] });
  assert.equal(credit.status, 400); assert.equal(await prisma.income.count(), 0);
  const mismatch = await api('/ai/confirm-entry', { sales: [{ name: '无档案货', quantity: 2, unitPrice: 15, totalAmount: 20, paid: true }] });
  assert.equal(mismatch.status, 400);
  const paid = await api('/ai/confirm-entry', { sales: [{ name: '无档案货', quantity: 2, unitPrice: 15, totalAmount: 30, paid: true }] });
  assert.equal(paid.status, 200); assert.equal(paid.data.incomes[0].amount, 30);
}));

test('S03 AI销售锁成本与账户，后续改价不改历史利润', () => fixture(async ({ api, product }) => {
  const p = await product();
  const r = await api('/ai/confirm-entry', { requestId: 'sale-snapshot', sales: [{ skuId: p.sku.id, name: '货', quantity: 2, unitPrice: 10, paid: true, settlementAccount: '微信' }] });
  assert.equal(r.status, 200);
  const item = await prisma.orderItem.findFirst(); assert.equal(item.costSnapshot, 6);
  assert.equal((await prisma.paymentRecord.findFirst()).account, '微信');
  const before = await api(`/reports/profit?${range}`);
  await api(`/skus/${p.sku.id}`, { costPrice: 9 }, 'PUT');
  const after = await api(`/reports/profit?${range}`); assert.equal(after.data.profit, before.data.profit); assert.equal(after.data.profit, 8);
}));

test('S04 手动采购挂账默认0，矛盾/超付/无供应商欠款均拒绝且不留半单', () => fixture(async ({ api, product, supplier }) => {
  const p = await product(); const body = { supplierId: supplier.id, settlementAccount: '挂账', items: [{ skuId: p.sku.id, quantity: 1, unitPrice: 100 }] };
  const r = await api('/purchase-orders', body); assert.equal(r.status, 201); assert.equal(r.data.paidAmount, 0); assert.equal(r.data.unpaidAmount, 100);
  assert.equal(await prisma.paymentRecord.count(), 0);
  for (const bad of [{ ...body, paidAmount: 1 }, { ...body, settlementAccount: '现金', paidAmount: 150 }, { ...body, supplierId: null }]) {
    assert.equal((await api('/purchase-orders', bad)).status, 400);
  }
  assert.equal(await prisma.purchaseOrder.count(), 1);
}));

test('S05 额度满仍可确认；同ID并发和重试只落一次，不同内容409，失败全批回滚', () => fixture(async ({ api, store, product }) => {
  const p = await product();
  await basePrisma.aiUsage.create({ data: { storeId: store.id, day: require('../src/utils/biz').localDayKey(new Date()), endpoint: 'parse-entry', calls: 8 } });
  process.env.FREE_AI_DAILY_CORE = '8';
  try {
    const body = { requestId: 'one-confirmation', sales: [{ skuId: p.sku.id, name: '货', quantity: 2, unitPrice: 10, paid: true }] };
    const replies = await Promise.all(Array.from({ length: 4 }, () => api('/ai/confirm-entry', body)));
    for (const r of replies) assert.equal(r.status, 200, r.message);
    assert.equal(await prisma.order.count(), 1); assert.equal(await prisma.paymentRecord.count(), 1);
    assert.equal((await prisma.inventory.findUnique({ where: { skuId: p.sku.id } })).quantity, 98);
    assert.equal((await api('/ai/confirm-entry', body)).status, 200);
    assert.equal((await api('/ai/confirm-entry', { ...body, sales: [{ ...body.sales[0], quantity: 3 }] })).status, 409);
    assert.equal(await require('../src/utils/entitlement').dailyAiCalls('core', store.id), 8);
    const invalid = { requestId: 'atomic-failure', expenses: [{ category: '费用', amount: 5 }], sales: [{ skuId: 999999, name: '不存在', quantity: 1, unitPrice: 10 }] };
    assert.equal((await api('/ai/confirm-entry', invalid)).status, 404); assert.equal(await prisma.expense.count(), 0);
  } finally { process.env.FREE_AI_DAILY_CORE = '0'; }
}));

test('S06 卖2退1净销售10净成本6利润4，全退为0，重复明细不允许超退', () => fixture(async ({ api, product }) => {
  const p = await product();
  const order = await api('/orders', { items: [{ skuId: p.sku.id, quantity: 2, unitPrice: 10 }] });
  const id = order.data.id, itemId = order.data.items[0].id;
  assert.equal((await api(`/orders/${id}/return`, { items: [{ itemId, quantity: 1 }], account: '现金' })).status, 200);
  const rep = (await api(`/reports/profit?${range}`)).data;
  assert.equal(rep.sales, 10); assert.equal(rep.cogs, 6); assert.equal(rep.profit, 4);
  const sales = (await api(`/reports/sales-by-product?${range}`)).data.list[0]; assert.equal(sales.qty, 1); assert.equal(sales.amount, 10);
  assert.equal((await api(`/orders/${id}/return`, { items: [{ itemId, quantity: 1 }, { itemId, quantity: 1 }] })).status, 400);
  assert.equal((await api(`/orders/${id}/return`, { items: [{ itemId, quantity: 1 }] })).status, 200);
  assert.equal((await api(`/reports/profit?${range}`)).data.profit, 0);
}));

test('S06 折扣分摊退款不超过原应收，配方修改后退货仍恢复原料快照', () => fixture(async ({ api, product }) => {
  const milk = await product({ costPrice: 5, quantity: 100 });
  const tea = await product({ costPrice: 999, quantity: 0 });
  await prisma.recipe.create({ data: { ownerSkuId: tea.sku.id, componentSkuId: milk.sku.id, qty: 2 } });
  const order = await api('/orders', { discountRate: 90, items: [{ skuId: tea.sku.id, quantity: 3, unitPrice: 20 }] });
  assert.equal(order.status, 201); assert.equal(order.data.items[0].costSnapshot, 10);
  await prisma.recipe.updateMany({ where: { ownerSkuId: tea.sku.id }, data: { qty: 4 } });
  const first = await api(`/orders/${order.data.id}/return`, { items: [{ itemId: order.data.items[0].id, quantity: 1 }] });
  assert.equal(first.data.returnValue, 18);
  assert.equal((await prisma.inventory.findUnique({ where: { skuId: milk.sku.id } })).quantity, 96);
  const cancel = await api(`/orders/${order.data.id}/cancel`, {}, 'PUT'); assert.equal(cancel.status, 200);
  assert.equal((await prisma.inventory.findUnique({ where: { skuId: milk.sku.id } })).quantity, 100);
  assert.equal((await prisma.inventory.findUnique({ where: { skuId: tea.sku.id } })).quantity, 0);
  const rep = (await api(`/reports/profit?${range}`)).data; assert.equal(rep.sales, 0); assert.equal(rep.cogs, 0);
}));

test('S07 员工接口不返回利润和成本快照，数据库降权立即生效', () => fixture(async ({ api, product, user }) => {
  const p = await product(); const o = await api('/orders', { items: [{ skuId: p.sku.id, quantity: 1, unitPrice: 10 }] });
  await prisma.user.update({ where: { id: user.id }, data: { role: 'staff' } });
  const r = await api(`/reports/sales-by-product?${range}`); assert.equal(r.status, 200); assert.equal('profit' in r.data.list[0], false);
  assert.equal((await api(`/reports/profit?${range}`)).status, 403);
  const detail = await api(`/orders/${o.data.id}`); for (const key of ['costSnapshot','stockSnapshot','costAmountCents']) assert.equal(key in detail.data.items[0], false);
  const inv = (await api('/reports/inventory')).data; assert.equal('totalValue' in inv, false); assert.equal('value' in inv.byType[0], false);
  const overview = (await api('/stats/overview')).data; for (const key of ['todayProfit','todayCogs']) assert.equal(key in overview, false);
}));

test('W04 品类整体更新保留完整属性，非法字段全部回滚', () => fixture(async ({ api, type }) => {
  const fields = [{ key: 'maker', label: '厂家', type: 'text', scope: 'product', unit: '单位', showInList: true, isCore: true }];
  const first = await api(`/product-types/${type.id}`, { name: '已改', fields }, 'PUT'); assert.equal(first.status, 200);
  const read = await api(`/product-types/${type.id}`); assert.equal(read.data.fields.length, 1); assert.equal(Boolean(read.data.fields[0].showInList), true); assert.equal(read.data.fields[0].unit, '单位');
  assert.equal((await api(`/product-types/${type.id}`, { name: '不该改', fields: [...fields, { key: 'bad key', label: '坏' }] }, 'PUT')).status, 400);
  const after = await api(`/product-types/${type.id}`); assert.equal(after.data.name, '已改'); assert.equal(after.data.fields.length, 1);
}));


test('S06 分币分摊连续三次退完31.66，采购折扣退货后付款取消均原子对平', () => fixture(async ({ api, product, supplier }) => {
  const p = await product();
  const order = await api('/orders', { discountAmount: 1.34, items: [{ skuId: p.sku.id, quantity: 3, unitPrice: 11 }] });
  const values = [];
  for (let i = 0; i < 3; i++) { const r = await api(`/orders/${order.data.id}/return`, { items: [{ itemId: order.data.items[0].id, quantity: 1 }] }); assert.equal(r.status, 200, r.message); values.push(r.data.returnValue); }
  assert.deepEqual(values, [10.55,10.56,10.55]);
  const po = await api('/purchase-orders', { supplierId: supplier.id, discountRate: 90, settlementAccount: '挂账', items: [{ skuId: p.sku.id, quantity: 2, unitPrice: 50 }] });
  const returned = await api(`/purchase-orders/${po.data.id}/return`, { items: [{ itemId: po.data.items[0].id, quantity: 1 }] }); assert.equal(returned.data.returnValue, 45);
  const results = await Promise.all([1,2].map(() => api(`/purchase-orders/${po.data.id}/pay`, { amount: 40, settlementAccount: '微信' })));
  assert.deepEqual(results.map(r=>r.status).sort(), [200,400]);
  assert.equal((await api(`/purchase-orders/${po.data.id}/cancel`, {}, 'PUT')).status, 200);
  assert.equal((await api(`/purchase-orders/${po.data.id}/pay`, { amount:1 })).status, 400);
  const payments = await prisma.paymentRecord.findMany({where:{purchaseOrderId:po.data.id,NOT:{account:'冲账'}}});
  assert.equal(payments.reduce((n,p)=>n+(p.direction==='out'?p.amount:-p.amount),0),0);
  assert.equal((await prisma.inventory.findUnique({where:{skuId:p.sku.id}})).quantity,100);
}));

test('S01 解析响应提供全部采购SKU，无法唯一识别时不默选；最后一次模型额度仍可确认', () => fixture(async ({ api, product, store }) => {
  const p = await product({name:'白酒'}); const box = await prisma.sku.create({data:{productId:p.product.id,code:'BOX',specText:'整箱',price:60}});
  modelDraft = {purchases:[{name:'白酒',matchedProductId:p.product.id,quantity:2,unit:'箱',unitCost:30,totalCost:60}],sales:[],expenses:[],aggregates:[],warnings:[]};
  process.env.FREE_AI_DAILY_CORE='8';
  await basePrisma.aiUsage.create({data:{storeId:store.id,day:require('../src/utils/biz').localDayKey(new Date()),endpoint:'parse-entry',calls:7}});
  try {
    const parsed = await api('/ai/parse-entry',{text:'进了两箱白酒60元'}); assert.equal(parsed.status,200,parsed.message);
    assert.equal(parsed.data.purchases[0].matchedProduct.skus.length,2); assert.equal(parsed.data.purchases[0].suggestedSkuId,null);
    const done = await api('/ai/confirm-entry',{requestId:'last-model-call',purchases:[{skuId:box.id,name:'白酒',quantity:2,unitCost:30}]});assert.equal(done.status,200,done.message);
    assert.equal(await require('../src/utils/entitlement').dailyAiCalls('core',store.id),8);
    assert.equal((await api('/ai/parse-entry',{text:'再来一单'})).status,402);
  } finally {process.env.FREE_AI_DAILY_CORE='0';}
}));

test('S06 允许负库存销售后，退货即使库存仍负也必须成功', () => fixture(async ({api,product}) => {
 const p=await product({quantity:0});const o=await api('/orders',{items:[{skuId:p.sku.id,quantity:10,unitPrice:10}]});assert.equal(o.status,201);
 const r=await api(`/orders/${o.data.id}/return`,{items:[{itemId:o.data.items[0].id,quantity:1}]});assert.equal(r.status,200,r.message);
 assert.equal((await prisma.inventory.findUnique({where:{skuId:p.sku.id}})).quantity,-9);
}));

test('S06 数量超过三位小数拒绝，不能收钱却扣0库存且无法退货', () => fixture(async ({api,product}) => {
 const p=await product();
 for (const quantity of [0.0004,1.0004]) {
  assert.equal((await api('/orders',{items:[{skuId:p.sku.id,quantity,unitPrice:10000}]})).status,400);
  assert.equal((await api('/purchase-orders',{items:[{skuId:p.sku.id,quantity,unitPrice:10000}]})).status,400);
  assert.equal((await api('/ai/confirm-entry',{sales:[{skuId:p.sku.id,name:'货',quantity,unitPrice:10000}]})).status,400);
 }
 assert.equal(await prisma.paymentRecord.count(),0); assert.equal((await prisma.inventory.findUnique({where:{skuId:p.sku.id}})).quantity,100);
}));

test('S06 旧作废单缺冲账时对账明确要求核账，不能复活客户或供应商欠款', () => fixture(async ({api,product,customer,supplier}) => {
 const p=await product();
 for (const purchase of [false,true]) {
  const route=purchase?'purchase-orders':'orders';
  const o=await api(`/${route}`,{[purchase?'supplierId':'customerId']:purchase?supplier.id:customer.id,items:[{skuId:p.sku.id,quantity:1,unitPrice:100}]});
  await api(`/${route}/${o.data.id}/cancel`,{},'PUT');
  await prisma.paymentRecord.deleteMany({where:{[purchase?'purchaseOrderId':'orderId']:o.data.id,account:'冲账'}});
  const report=await api(`/reports/${purchase?'supplier':'customer'}-statement?${range}&${purchase?'supplierId':'customerId'}=${purchase?supplier.id:customer.id}`);
  assert.equal(report.status,409,report.message);assert.match(report.message,/历史|核对/);
 }
}));

test('S02 单价与总额即使相差一分钱也不静默忽略',()=>fixture(async({api,product})=>{
 const p=await product();
 for(const body of [{sales:[{skuId:p.sku.id,name:'货',quantity:1,unitPrice:10,totalAmount:10.01}]},{purchases:[{skuId:p.sku.id,name:'货',quantity:1,unitCost:10,totalCost:10.01}]}]) assert.equal((await api('/ai/confirm-entry',body)).status,400);
 assert.equal(await prisma.order.count(),0);assert.equal(await prisma.purchaseOrder.count(),0);
}));

test('S07 路由大小写及尾斜杠不能绕过员工估值过滤',()=>fixture(async({api,product,user})=>{
 await product();await prisma.user.update({where:{id:user.id},data:{role:'staff'}});
 for(const path of ['/reports/inventory/','/reports/INVENTORY']){ const r=await api(path);assert.equal(r.status,200);assert.equal('value' in r.data.byType[0],false); }
}));

test('验收 curl真实HTTP采购挂账100付款40，数据库应付60仅一笔真实支出40',()=>fixture(async({api,product,supplier,user})=>{
 const {execFile}=require('node:child_process'); const p=await product();
 const token=jwt.sign({userId:user.id,role:user.role},process.env.JWT_SECRET);
 const curl=async(path,body)=>JSON.parse(await new Promise((resolve,reject)=>execFile('curl',['--silent','--show-error','--fail-with-body','-H',`Authorization: Bearer ${token}`,'-H','Content-Type: application/json','--data',JSON.stringify(body),`http://127.0.0.1:${server.address().port}/api/v1${path}`],(err,out)=>err?reject(err):resolve(out))));
 const created=await curl('/purchase-orders',{supplierId:supplier.id,settlementAccount:'挂账',items:[{skuId:p.sku.id,quantity:1,unitPrice:100}]});assert.equal(created.data.paidAmount,0);
 const paid=await curl(`/purchase-orders/${created.data.id}/pay`,{amount:40,settlementAccount:'微信'});assert.equal(paid.data.unpaidAmount,60);
 const po=await prisma.purchaseOrder.findUnique({where:{id:created.data.id}});assert.equal(po.actualAmount-po.paidAmount,60);
 const pays=await prisma.paymentRecord.findMany({where:{purchaseOrderId:po.id}});assert.equal(pays.length,1);assert.equal(pays[0].amount,40);assert.equal(pays[0].direction,'out');
 assert.equal((await prisma.inventory.findUnique({where:{skuId:p.sku.id}})).quantity,101);
 console.log('CURL_EVIDENCE',JSON.stringify({purchase:100,paid:40,unpaid:60,paymentRows:1,stockBefore:100,stockAfter:101}));
}));

test('S05 两店同ID各自入账；旧无ID十分钟内仅重放；确认保留认证与限流',async()=>{
 for(let i=0;i<2;i++) await fixture(async({api})=>{
  const body={requestId:'same-id-two-stores',expenses:[{category:'其他',amount:3}]};const r=await api('/ai/confirm-entry',body);assert.equal(r.status,200);assert.equal(r.data.replayed,false);assert.equal(await prisma.expense.count(),1);
  const legacy={expenses:[{category:'其他',amount:5}]};await api('/ai/confirm-entry',legacy);assert.equal((await api('/ai/confirm-entry',legacy)).data.replayed,true);assert.equal(await prisma.expense.count(),2);
 });
 await fixture(async({api})=>{
  const body={requestId:'rate-limit-replay',expenses:[{category:'其他',amount:1}]};
  for(let i=0;i<120;i++)assert.equal((await api('/ai/confirm-entry',body)).status,200);
  assert.equal((await api('/ai/confirm-entry',body)).status,429);assert.equal(await prisma.expense.count(),1);
 });
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/ai/confirm-entry`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expenses:[{category:'其他',amount:1}]})});assert.equal(r.status,401);
});

test('S01/S02 已停用规格不能采购；无档案建档销售缺价不能默认免费',()=>fixture(async({api,product,type})=>{
 const p=await product();await prisma.sku.update({where:{id:p.sku.id},data:{status:0}});
 assert.equal((await api('/purchase-orders',{items:[{skuId:p.sku.id,quantity:1,unitPrice:10}]})).status,404);
 assert.equal((await api('/ai/confirm-entry',{sales:[{createProduct:true,productTypeId:type.id,name:'未说价格的货',quantity:1}]})).status,400);
 assert.equal(await prisma.order.count(),0);assert.equal(await prisma.purchaseOrder.count(),0);
}));

test('W03 采购状态过滤在数据库分页前执行，页总数一致',()=>fixture(async({api,product})=>{
 const p=await product();const body={items:[{skuId:p.sku.id,quantity:1,unitPrice:1}]};const a=await api('/purchase-orders',body);await api('/purchase-orders',body);await api(`/purchase-orders/${a.data.id}/cancel`,{},'PUT');
 for(const status of ['completed','cancelled']){ const r=await api(`/purchase-orders?status=${status}&page=1&pageSize=1`);assert.equal(r.data.pagination.total,1);assert.equal(r.data.list[0].status,status); }
}));
