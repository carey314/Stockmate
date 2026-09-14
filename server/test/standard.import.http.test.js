process.env.JWT_SECRET = 'standard-import-test-only';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');
const file = useIsolatedDb(`standard-import-${process.pid}`);
const prisma = require('../src/config/prisma');
const { basePrisma, runWithTenant } = prisma;
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express(); app.use(express.json({ limit: '3mb' }));
// Mount the feature independently, including real auth; a missing implementation is an observable 501.
const fs = require('node:fs');
const controller = fs.existsSync(require('node:path').join(__dirname, '../src/controllers/standardImport.js'))
  ? require('../src/controllers/standardImport') : { validate: (_q,r) => r.status(501).json({}), commit: (_q,r) => r.status(501).json({}) };
const { auth } = require('../src/middlewares/auth');
for (const action of ['validate', 'commit']) app.post(`/${action}`, auth, (req,res,next) => Promise.resolve(controller[action](req,res)).catch(next));
app.post('/sale', auth, (req,res,next) => Promise.resolve(require('../src/controllers/orders').create(req,res)).catch(next));
app.use(require('../src/middlewares/errorHandler'));
let server, seq = 0;
before(async () => { server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); });
after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); dropIsolatedDb(file); });
async function fixture(fn) {
  const store = await basePrisma.store.create({data:{name:`导入测试${++seq}`}});
  return runWithTenant(store.id, async () => {
    const user = await prisma.user.create({data:{username:`import-${seq}`,passwordHash:'unused',realName:'店主',role:'admin'}});
    const type = await prisma.productType.create({data:{name:'测试类'}});
    const api = async (action, body, actor = user) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${action}`, {method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:actor.id,role:actor.role}, process.env.JWT_SECRET)}`},body:JSON.stringify(body)});
      return {status:response.status,...await response.json()};
    };
    const row = (patch={}) => ({rowId:'2',code:'P1',name:'苹果',unit:'斤',skuCode:'P1-A',specText:'红色',price:'12.50',costPrice:'',initQuantity:'1.5',barcode:'001234',customFields:{},specValues:{},...patch});
    const body = (rows=[row()]) => ({batchId:'batch-test-0001',productTypeId:type.id,rows});
    await fn({api,user,type,store,row,body});
  });
}
test('标准导入校验/并发/丢响应重试只产生一个商品和初始库存；空成本保留null', () => fixture(async ({api,body}) => {
  const data=body(); const validation=await api('validate',data); assert.equal(validation.status,200); assert.equal(validation.data.rows[0].errors.length,0);
  const payload={...data,selectedRowIds:['2']};
  const responses=await Promise.all([api('commit',payload),api('commit',payload)]);
  for(const r of responses){assert.equal(r.status,200);assert.equal(r.data.results[0].status,'success');}
  assert.equal(responses[0].data.results[0].productId,responses[1].data.results[0].productId);
  assert.deepEqual((await api('commit',payload)).data,responses[0].data);
  assert.equal(await prisma.product.count(),1);assert.equal(await prisma.sku.count(),1);assert.equal(await prisma.inventoryRecord.count(),1);
  const sku=await prisma.sku.findFirst();assert.equal(sku.costPrice,null);assert.equal((await prisma.inventory.findFirst()).quantity,1.5);
  assert.equal((await api('commit',{...payload,rows:[{...data.rows[0],price:'14'}]})).status,409);
}));
test('错误行分字段，重复编码/条码/数值/必填字段不得入库，有效行可明确选择', () => fixture(async ({api,body,row,type}) => {
  await prisma.fieldDefinition.create({data:{productTypeId:type.id,key:'brand',label:'品牌',scope:'product',required:1}});
  const data=body([row({price:'12元',customFields:{brand:''}}),row({rowId:'3',code:'P2',skuCode:'P2',barcode:'002',customFields:{brand:'甲'}})]);
  const result=await api('validate',data);assert.equal(result.status,200);assert.ok(result.data.rows[0].errors.some(e=>e.field==='price'));assert.ok(result.data.rows[0].errors.some(e=>e.field==='product.brand'));
  const commit=await api('commit',{...data,selectedRowIds:['3']});assert.equal(commit.status,200);assert.equal(commit.data.results[0].status,'success');assert.equal(await prisma.product.count(),1);
  const conflict=await api('validate',{...data,batchId:'batch-new-0002',rows:[row({customFields:{brand:'甲'},skuCode:'P2',barcode:'002'})]});
  assert.ok(conflict.data.rows[0].errors.some(e=>e.field==='skuCode'));assert.ok(conflict.data.rows[0].errors.some(e=>e.field==='barcode'));
}));
test('商品多规格原子提交，重复规格/同商品基础字段不一致拒绝整组', () => fixture(async ({api,body,row}) => {
  const data=body([row(),row({rowId:'3',skuCode:'P1-B',barcode:'002',name:'梨'})]);
  const result=await api('commit',{...data,selectedRowIds:['2','3']});assert.equal(result.status,200);assert.ok(result.data.results.every(r=>r.status==='failed'));assert.equal(await prisma.product.count(),0);
}));
test('类型和动态字段严格校验，不忽略未知字段；行数和文本体积有上限', () => fixture(async ({api,body,row,type}) => {
  await prisma.fieldDefinition.create({data:{productTypeId:type.id,key:'organic',label:'有机',type:'boolean',scope:'product'}});
  await prisma.fieldDefinition.create({data:{productTypeId:type.id,key:'size',label:'大小',type:'select',scope:'sku',required:1,options:'["大","小"]'}});
  const result=await api('validate',body([row({price:'Infinity',initQuantity:'-1',customFields:{organic:'yes',extra:'丢失'},specValues:{size:'中'}})]));
  const fields=result.data.rows[0].errors.map(e=>e.field);for(const field of ['price','initQuantity','product.organic','product.extra','sku.size'])assert.ok(fields.includes(field),field);
  assert.equal((await api('validate',body(Array.from({length:1001},(_,i)=>row({rowId:String(i)}))))).status,400);
  assert.equal((await api('validate',body([row({name:'a'.repeat(2*1024*1024)})]))).status,413);
}));
test('员工403、跨店品类404，同店不同操作者不能恢复他人批次', () => fixture(async ({api,body,user}) => {
  const data=body(); const otherStore=await basePrisma.store.create({data:{name:'其他店'}});
  const foreignType=await runWithTenant(otherStore.id,async()=>await prisma.productType.create({data:{name:'外店'}}));
  assert.equal((await api('validate',{...data,productTypeId:foreignType.id})).status,404);
  const staff=await prisma.user.create({data:{username:`staff-${user.id}`,passwordHash:'unused',realName:'员工',role:'staff'}});
  assert.equal((await api('validate',data,staff)).status,403);assert.equal((await api('commit',{...data,selectedRowIds:['2']},staff)).status,403);
  const admin=await prisma.user.create({data:{username:`admin-${user.id}`,passwordHash:'unused',realName:'第二店主',role:'admin'}});
  await api('commit',{...data,selectedRowIds:['2']});
  assert.equal((await api('commit',{...data,selectedRowIds:['2']},admin)).status,409);
}));
test('事务中第二规格故障整商品回滚，其他商品继续；修复后重试仅补失败行', () => fixture(async ({api,body,row}) => {
  await basePrisma.$executeRawUnsafe(`CREATE TRIGGER standard_import_failure BEFORE INSERT ON Sku WHEN NEW.code = 'FORCE-FAIL' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
  const data={...body([row({skuCode:'P1-A',specText:'红'}),row({rowId:'3',skuCode:'FORCE-FAIL',specText:'绿',barcode:'002'}),row({rowId:'4',code:'P2',skuCode:'P2',barcode:'003'})]),selectedRowIds:['2','3','4']};
  try {
    const response=await api('commit',data);assert.equal(response.status,200);
    assert.deepEqual(response.data.results.map(r=>r.status),['failed','failed','success']);
    assert.equal(await prisma.product.count(),1);assert.equal(await prisma.sku.count(),1);assert.equal(await prisma.inventoryRecord.count(),1);
    assert.equal(await prisma.entryConfirmation.count(),3);
  }finally{await basePrisma.$executeRawUnsafe('DROP TRIGGER standard_import_failure');}
  const retry=await api('commit',data);assert.equal(retry.status,200);assert.ok(retry.data.results.every(r=>r.status==='success'));
  assert.equal(await prisma.product.count(),2);assert.equal(await prisma.sku.count(),3);assert.equal(await prisma.inventoryRecord.count(),3);
}));
test('1000行边界完整校验，同商品1000规格完整提交不截断', () => fixture(async ({api,body,row}) => {
  const rows=Array.from({length:1000},(_,i)=>row({rowId:String(i+2),skuCode:`SKU-${i}`,specText:`规格${i}`,barcode:`BAR-${i}`}));
  const data=body(rows);assert.equal((await api('validate',data)).data.rows.length,1000);
  const response=await api('commit',{...data,selectedRowIds:rows.map(r=>r.rowId)});assert.equal(response.status,200);assert.equal(response.data.results.length,1000);assert.ok(response.data.results.every(r=>r.status==='success'));
  assert.equal(await prisma.product.count(),1);assert.equal(await prisma.sku.count(),1000);assert.equal(await prisma.inventoryRecord.count(),1000);
}));

test('同商品不同规格的空成本不会继承首规格，真实销售仍标记成本未知', () => fixture(async ({api,body,row}) => {
  const data={...body([row({costPrice:'6'}),row({rowId:'3',skuCode:'P1-B',specText:'绿色',barcode:'002',costPrice:''})]),selectedRowIds:['2','3']};
  const imported=await api('commit',data);assert.equal(imported.status,200);
  const unknown=imported.data.results.find(r=>r.rowId==='3');
  const sale=await api('sale',{items:[{skuId:unknown.skuId,quantity:1,unitPrice:12.5}]});
  assert.equal(sale.status,201);
  const sold=await prisma.orderItem.findFirst({where:{skuId:unknown.skuId}});
  assert.equal(sold.costSnapshot,null);assert.equal(sold.costAmountCents,null);
  const known=await prisma.sku.findFirst({where:{code:'P1-A'}});assert.equal(known.costPrice,6);
  assert.equal((await prisma.product.findFirst()).costPrice,null);
}));
