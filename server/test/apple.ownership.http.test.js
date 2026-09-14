process.env.TZ='Asia/Shanghai';process.env.JWT_SECRET='apple-batch2-only';process.env.APPLE_SHARED_SECRET='synthetic-apple-secret';
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');const file=useIsolatedDb(`apple-ownership-${process.pid}`);
const prisma=require('../src/config/prisma'),{basePrisma,runWithTenant}=prisma;
const jwt=require('jsonwebtoken'),express=require('express');
const networkFetch=global.fetch;let appleResponse;
global.fetch=async(url,opts)=>String(url).includes('itunes.apple.com/verifyReceipt')?{ok:true,json:async()=>appleResponse}:networkFetch(url,opts);
const app=express();app.use(express.json());app.use('/api/v1',require('../src/routes'));app.use(require('../src/middlewares/errorHandler'));
let server,sequence=0;
before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});});
after(async()=>{global.fetch=networkFetch;await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();dropIsolatedDb(file);});
const product='com.carey.stockmate.pro.monthly';
function receipt(chain,tx=chain+'-1',patch={}){ const now=Date.now();return {status:0,environment:'Production',receipt:{bundle_id:'com.carey.stockmate',request_date_ms:String(now)},latest_receipt_info:[{product_id:product,original_transaction_id:chain,transaction_id:tx,purchase_date_ms:String(now-10000),expires_date_ms:String(now+86400000),...patch}]}; }
async function store(){const s=await basePrisma.store.create({data:{name:`支付店${++sequence}`}});const u=await runWithTenant(s.id,async()=>await prisma.user.create({data:{username:`apple-${sequence}`,passwordHash:'unused',realName:'测试',role:'admin'}}));return {store:s,user:u};}
async function request(who,body,path='/me/entitlement/apple'){const r=await networkFetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:who.user.id,role:'admin'},process.env.JWT_SECRET)}`},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};}
const redeem=(who,tx,productId=product)=>request(who,{receipt:'synthetic-receipt-long-enough',transactionId:tx,productId});
test('A08首次绑定返回本次已验证归属；同店恢复/续期幂等；B已有pro也不能兑换A收据',async()=>{
 const a=await store(),b=await store();appleResponse=receipt('chain-one');
 const first=await redeem(a,'chain-one-1');assert.equal(first.status,200,first.message);assert.deepEqual(first.data.transaction,{verified:true,storeId:a.store.id,originalTransactionId:'chain-one',transactionId:'chain-one-1',latestTransactionId:'chain-one-1',productId:product,environment:'production',status:'active',expiresAt:new Date(Number(appleResponse.latest_receipt_info[0].expires_date_ms)).toISOString(),ownership:'bound'});
 assert.equal((await redeem(a,'chain-one-1')).data.transaction.ownership,'restored');
 await require('../src/utils/entitlement').grantEntitlement({storeId:b.store.id,plan:'pro',source:'manual'});
 const cross=await redeem(b,'chain-one-1');assert.equal(cross.status,409);assert.equal((await request(b,null,'/me/entitlement')).data.plan,'pro');
 appleResponse=receipt('chain-one','chain-one-2',{expires_date_ms:String(Date.now()+86400000*2)});
 assert.equal((await redeem(a,'chain-one-2')).data.transaction.latestTransactionId,'chain-one-2');assert.equal(await basePrisma.entitlement.count({where:{externalId:'chain-one'}}),1);
});
test('A08并发首次绑定只能一家成功且另一家409，不转移原始交易',async()=>{
 const a=await store(),b=await store();appleResponse=receipt('concurrent');const replies=await Promise.all([redeem(a,'concurrent-1'),redeem(b,'concurrent-1')]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);assert.equal(await basePrisma.entitlement.count({where:{externalId:'concurrent'}}),1);
});
test('A08不接受其他应用/商品/环境/不存在的交易；撤销不能仍发pro',async()=>{
 const a=await store();
 for(const [kind,change] of [['bundle',r=>r.receipt.bundle_id='other.app'],['product',r=>r.latest_receipt_info[0].product_id='other.product'],['environment',r=>r.environment='Sandbox'],['missing-id',r=>r.latest_receipt_info[0].transaction_id='different']]){
  appleResponse=receipt('invalid-'+kind);change(appleResponse);assert.equal((await redeem(a,'invalid-'+kind+'-1')).status,400,kind);
 }
 appleResponse=receipt('refunded','refunded-1',{cancellation_date_ms:String(Date.now()-1000)});const r=await redeem(a,'refunded-1');assert.equal(r.status,200);assert.equal(r.data.transaction.status,'refunded');assert.equal(r.data.plan,'free');assert.equal((await request(a,null,'/me/entitlement')).data.plan,'free');
});
test('A08退款/到期由本店验证同步，B的过期收据不能撤销A；关闭自动续订仍有效',async()=>{
 const a=await store(),b=await store();appleResponse=receipt('lifecycle');await redeem(a,'lifecycle-1');
 appleResponse=receipt('lifecycle','lifecycle-1',{expires_date_ms:String(Date.now()-1000)});assert.equal((await redeem(b,'lifecycle-1')).status,409);assert.equal((await request(a,null,'/me/entitlement')).data.plan,'pro');
 const expired=await redeem(a,'lifecycle-1');assert.equal(expired.status,200);assert.equal(expired.data.transaction.status,'expired');assert.equal(expired.data.plan,'free');
 appleResponse=receipt('renewal');appleResponse.pending_renewal_info=[{original_transaction_id:'renewal',auto_renew_status:'0'}];assert.equal((await redeem(a,'renewal-1')).data.transaction.status,'active');
});
