process.env.TZ='Asia/Shanghai';process.env.JWT_SECRET='batch2-only';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {useIsolatedDb,dropIsolatedDb,seedProduct}=require('./helpers/db');const file=useIsolatedDb(`quality-batch2-${process.pid}`);
const prisma=require('../src/config/prisma'),{runWithTenant,basePrisma}=prisma;const express=require('express'),jwt=require('jsonwebtoken');
const app=express();app.use(express.json());app.use('/api/v1',require('../src/routes'));app.use(require('../src/middlewares/errorHandler'));let server,seq=0;
before(async()=>server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}));after(async()=>{await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();dropIsolatedDb(file);});
async function fixture(fn){const store=await basePrisma.store.create({data:{name:`第二批店${++seq}`}});await runWithTenant(store.id,async()=>{const user=await prisma.user.create({data:{username:`b2-${seq}`,passwordHash:'unused',realName:'老板',role:'admin'}});const type=await prisma.productType.create({data:{name:'品类'}});const p=await seedProduct(prisma,{typeId:type.id,name:'货',code:'SKU',price:10,costPrice:6,quantity:10});const api=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:user.id,role:'admin'},process.env.JWT_SECRET)}`},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};await fn({api,store,user,p});});}
test('W07采购同ID并发和重新请求仅一单/一次入库付款，修改内容409，400后可更正',()=>fixture(async({api,p})=>{
 const body={requestId:'purchase-idempotent',items:[{skuId:p.sku.id,quantity:2,unitPrice:6}]};const r=await Promise.all([api('/purchase-orders',body),api('/purchase-orders',body)]);for(const x of r)assert.equal(x.status,201);assert.equal(r[0].data.id,r[1].data.id);assert.equal((await api('/purchase-orders',body)).data.id,r[0].data.id);assert.equal(await prisma.purchaseOrder.count(),1);assert.equal(await prisma.paymentRecord.count(),1);assert.equal((await prisma.inventory.findUnique({where:{skuId:p.sku.id}})).quantity,12);
 assert.equal((await api('/purchase-orders',{...body,items:[{...body.items[0],quantity:3}]})).status,409);
 const invalid={...body,requestId:'bad-then-correct',settlementAccount:'挂账'};assert.equal((await api('/purchase-orders',invalid)).status,400);assert.equal((await api('/purchase-orders',{...invalid,settlementAccount:'现金'})).status,201);
}));
test('X03实际额度同源：免费额度关掉仍限制Pro；0明确关闭防滥用，永久权益优先',()=>fixture(async({api,store})=>{
 const entitlement=require('../src/utils/entitlement');await entitlement.grantEntitlement({storeId:store.id,source:'apple',externalId:'limited',plan:'pro',expiresAt:new Date(Date.now()+86400000)});await entitlement.grantEntitlement({storeId:store.id,source:'manual',plan:'pro'});
 assert.equal((await entitlement.currentPlan(store.id)).expiresAt,null);
 process.env.FREE_AI_DAILY_CORE='0';process.env.PRO_AI_DAILY_CORE='2';process.env.PRO_AI_DAILY_OTHER='3';
 try{
  const e=(await api('/me/entitlement')).data;assert.equal(e.today.coreAntiAbuseLimit,2);assert.equal(e.today.otherAntiAbuseLimit,3);assert.equal(e.today.timeZone,'Asia/Shanghai');assert.ok(Date.parse(e.today.resetAt)>Date.now());
  await basePrisma.aiUsage.create({data:{storeId:store.id,day:require('../src/utils/biz').localDayKey(new Date()),endpoint:'parse-entry',calls:2}});
  assert.equal((await api('/ai/parse-entry',{text:'进货一件'})).status,429);
  process.env.PRO_AI_DAILY_CORE='0';assert.equal((await api('/me/entitlement')).data.today.coreAntiAbuseLimit,null);
 }finally{delete process.env.FREE_AI_DAILY_CORE;delete process.env.PRO_AI_DAILY_CORE;delete process.env.PRO_AI_DAILY_OTHER;}
}));
