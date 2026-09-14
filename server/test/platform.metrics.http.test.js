process.env.PLATFORM_JWT_SECRET='isolated-platform-metrics-key-test-only-12345';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');const file=useIsolatedDb(`platform-metrics-http-${process.pid}`);
const prisma=require('../src/config/prisma'),{basePrisma:db,runWithTenant}=prisma;const express=require('express');
const ctl=require('../src/controllers/platformMetrics');const jwt=require('jsonwebtoken');
const {platformAuth,ISSUER,AUDIENCE}=require('../src/middlewares/platformAuth');
const app=express();app.use(platformAuth);
for(const [url,name]of [['/overview','overview'],['/users','users'],['/users/:id','userDetail'],['/ai-requests','aiRequests']])app.get(url,(q,r,n)=>Promise.resolve(ctl[name](q,r)).catch(n));app.use(require('../src/middlewares/errorHandler'));
let server,user,other,store,platformToken;
before(async()=>{
 const platform=await db.platformAdmin.create({data:{username:'metrics-admin',passwordHash:'synthetic-only',displayName:'平台测试'}});
 platformToken=jwt.sign({sessionVersion:platform.sessionVersion},process.env.PLATFORM_JWT_SECRET,{subject:String(platform.id),issuer:ISSUER,audience:AUDIENCE,expiresIn:3600});
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 store=await db.store.create({data:{name:'运营测试店'}});const second=await db.store.create({data:{name:'第二店'}});
 user=await runWithTenant(store.id,async()=>await prisma.user.create({data:{username:'owner',realName:'店主',passwordHash:'SECRET_PASSWORD',phone:'SECRET_CONTACT',role:'admin',createdAt:new Date('2026-01-01')}}));
 other=await runWithTenant(second.id,async()=>await prisma.user.create({data:{username:'staff',realName:'员工',passwordHash:'SECRET_OTHER',role:'staff',status:0}}));
 await db.authIdentity.create({data:{userId:user.id,provider:'apple',openId:'SECRET_APPLE_SUBJECT',email:'SECRET_EMAIL'}});await db.phoneIdentity.create({data:{userId:user.id,phone:'SECRET_VERIFIED_PHONE'}});
 const future=new Date(Date.now()+86400000);
 await db.entitlement.createMany({data:[{storeId:store.id,source:'apple',externalId:'SECRET_TX_CHAIN',plan:'pro',appleEnvironment:'production',appleTransactionId:'SECRET_TX',appleVerifiedAt:new Date(),applePurchaseAt:new Date('2026-02-01'),expiresAt:future},{storeId:store.id,source:'manual',plan:'pro'},{storeId:second.id,source:'apple',externalId:'sandbox-chain',plan:'pro',appleEnvironment:'sandbox',appleTransactionId:'sandbox-tx',appleVerifiedAt:new Date(),applePurchaseAt:new Date(),expiresAt:future},{storeId:second.id,source:'promotion',externalId:'promo',plan:'pro'}]});
 const customer=await db.customer.create({data:{storeId:store.id,name:'合成客户'}});
 await db.order.create({data:{customerId:customer.id,storeId:store.id,orderNo:'SECRET_ORDER_BODY',operatorId:user.id,createdAt:new Date('2026-01-15')}});
 await db.aiRequestRecord.createMany({data:[{requestId:'logical-1',userId:user.id,storeId:store.id,endpoint:'ask',model:'model',attempt:1,status:'parse_failed',durationMs:1,promptTokens:100,completionTokens:20,totalTokens:120},{requestId:'logical-1',userId:user.id,storeId:store.id,endpoint:'ask',model:'model',attempt:2,status:'success',durationMs:2},{requestId:'logical-2',userId:other.id,storeId:second.id,endpoint:'ask',model:'model',attempt:1,status:'failed',durationMs:1}]});
});
after(async()=>{await new Promise(r=>server.close(r));await prisma.$disconnect();dropIsolatedDb(file);});
const api=async(url,authorized=true)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{headers:{Authorization:`Bearer ${authorized?platformToken:jwt.sign({userId:user.id,role:'admin'},'merchant-only-key')}`}});return {status:r.status,...await r.json()};};
test('平台指标控制器拒绝商家admin，注册/绑定重叠与真实付费口径分开',async()=>{
 assert.equal((await api('/overview',false)).status,401);const r=await api('/overview');assert.equal(r.status,200);
 assert.deepEqual(r.data.registrations,{users:2,stores:2,admins:1,staff:1,disabledUsers:1,firstRegistrationSource:'unknown'});
 assert.equal(r.data.bindings.appleUsers,1);assert.equal(r.data.bindings.phoneUsers,1);assert.equal(r.data.bindings.overlapUsers,1);
 assert.equal(r.data.entitlements.currentProStores,2);assert.equal(r.data.entitlements.verifiedProductionStores,1);assert.equal(r.data.entitlements.verifiedSandboxStores,1);assert.equal(r.data.entitlements.manualStores,1);assert.equal(r.data.entitlements.promotionStores,1);assert.equal(r.data.entitlements.revenue,null);
 assert.equal(r.data.ai.attempts,3);assert.equal(r.data.ai.logicalRequests,2);assert.equal(r.data.ai.success,1);assert.equal(r.data.ai.parseFailed,1);assert.equal(r.data.ai.usageUnknownAttempts,2);assert.equal(r.data.ai.promptTokens,100);
});
test('用户查询分页、隐私白名单与用户详情真实时序',async()=>{
 const r=await api('/users?query=owner&pageSize=1');assert.equal(r.status,200);assert.equal(r.data.pagination.total,1);assert.equal(r.data.list[0].id,user.id);assert.equal(r.data.list[0].bindings.apple,true);assert.ok(!JSON.stringify(r).includes('SECRET_'));
 const detail=await api(`/users/${user.id}`);assert.equal(detail.status,200);assert.equal(detail.data.purchaseStage.earliestKnownPurchaseAt,'2026-02-01T00:00:00.000Z');assert.equal(detail.data.purchaseStage.phase,'after_first_order');assert.equal(detail.data.purchaseStage.entry,'unknown');assert.equal(detail.data.purchaseStage.attribution,'store');assert.ok(!JSON.stringify(detail).includes('SECRET_'));
 assert.equal((await api('/users?pageSize=51')).status,400);assert.equal((await api('/users/not-a-number')).status,400);assert.equal((await api('/users/999999')).status,404);
});
test('AI明细用户/店铺/日期过滤与未知token无伪零；范围不可超过366天',async()=>{
 const r=await api(`/ai-requests?userId=${other.id}&pageSize=1`);assert.equal(r.status,200);assert.equal(r.data.pagination.total,1);assert.equal(r.data.list[0].userId,other.id);assert.equal(r.data.summary.promptTokens,null);assert.equal(r.data.summary.usageUnknownAttempts,1);assert.equal(r.data.list[0].estimatedCost,null);
 assert.equal((await api('/ai-requests?from=2020-01-01&to=2026-01-01')).status,400);assert.equal((await api('/overview?from=invalid')).status,400);assert.equal((await api('/ai-requests?storeId=-1')).status,400);
});
test('已验证购买事件幂等，只存环境/商品/归属口径，不存Apple交易凭据',async()=>{
 const {recordVerifiedPurchase}=require('../src/services/metricsContext');const verified={environment:'production',latestTransactionId:'SECRET_TX',latestProductId:'pro',purchasedAt:new Date('2026-02-01'),status:'active'};
 await recordVerifiedPurchase(user.id,store.id,verified);await recordVerifiedPurchase(user.id,store.id,verified);assert.equal(await db.platformEvent.count(),1);assert.ok(!JSON.stringify(await db.platformEvent.findMany()).includes('SECRET_TX'));
 const r=await api('/overview');assert.equal(r.data.entitlements.verifiedProductionTransactions,1);
});
test('已验证已绑定续费通知独立记录新交易，未知归属不伪造店铺或购买人',async()=>{
 const {processAppleNotification}=require('../src/services/appleNotifications');const {observeVerifiedNotification}=require('../src/services/metricsContext');
 await require('../src/services/metricsContext').recordVerifiedPurchase(user.id,store.id,{environment:'production',latestTransactionId:'SECRET_TX',latestProductId:'pro',purchasedAt:new Date('2026-02-01'),status:'active'});
 const now=Date.now();const event={notificationUUID:'synthetic-renewal',notificationType:'DID_RENEW',signedDate:now,transaction:{bundleId:process.env.APPLE_BUNDLE_ID||'com.carey.stockmate',productId:'com.carey.stockmate.pro.monthly',environment:'Production',originalTransactionId:'SECRET_TX_CHAIN',transactionId:'SECRET_RENEW',purchaseDate:now,expiresDate:now+86400000}};
 await processAppleNotification(event);assert.equal(typeof observeVerifiedNotification,'function');await observeVerifiedNotification(event);await observeVerifiedNotification(event);
 assert.equal(await db.platformEvent.count(),2);const renewal=await db.platformEvent.findFirst({where:{userId:null}});assert.ok(renewal);assert.equal(renewal.storeId,store.id);assert.ok(!JSON.stringify(renewal).includes('SECRET_RENEW'));
 await observeVerifiedNotification({...event,transaction:{...event.transaction,originalTransactionId:'unbound-chain',transactionId:'unbound'}});assert.equal(await db.platformEvent.count(),2);
 await observeVerifiedNotification({...event,notificationType:'REFUND',transaction:{...event.transaction,transactionId:'refund-only'}});assert.equal(await db.platformEvent.count(),2);
 assert.equal((await api('/overview')).data.entitlements.verifiedProductionTransactions,2);
});
