const {test,after}=require('node:test');const assert=require('node:assert/strict');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');const file=useIsolatedDb(`apple-notifications-${process.pid}`);
const prisma=require('../src/config/prisma');const {bindApple}=require('../src/services/appleEntitlement');
after(async()=>{await prisma.$disconnect();dropIsolatedDb(file);});
const product='com.carey.stockmate.pro.monthly';let id=0;
function event(type,tx='notify-1',patch={}){const now=Date.now();return {notificationUUID:`event-${++id}`,notificationType:type,signedDate:now,data:{environment:'Production',bundleId:'com.carey.stockmate'},transaction:{bundleId:'com.carey.stockmate',environment:'Production',transactionId:tx,originalTransactionId:'notify',productId:product,purchaseDate:now-10000,expiresDate:now+86400000,...patch}};}
const active={originalTransactionId:'notify',transactionId:'notify-1',latestTransactionId:'notify-1',productId:product,latestProductId:product,environment:'production',status:'active',purchasedAt:new Date(Date.now()-10000),expiresAt:new Date(Date.now()+86400000),verifiedAt:new Date(Date.now()-1000),revokedAt:null};
test('Apple退款/重复通知/旧收据不可复活；续期恢复；关闭自动续订不提前失效',async()=>{
 const {processAppleNotification}=require('../src/services/appleNotifications');await bindApple(1,active);
 const refund=event('REFUND','notify-1',{revocationDate:Date.now()});
 assert.equal((await processAppleNotification(refund)).processed,true);assert.equal((await processAppleNotification(refund)).replayed,true);
 assert.equal((await require('../src/utils/entitlement').currentPlan(1)).plan,'free');
 await bindApple(1,{...active,verifiedAt:new Date(Date.now()+1000)});assert.equal((await require('../src/utils/entitlement').currentPlan(1)).plan,'free');
 const renewal=event('DID_RENEW','notify-2',{purchaseDate:Date.now()+1000,expiresDate:Date.now()+86400000*2});renewal.signedDate=Date.now()+2000;await processAppleNotification(renewal);assert.equal((await require('../src/utils/entitlement').currentPlan(1)).plan,'pro');
 const off=event('DID_CHANGE_RENEWAL_STATUS','notify-2',{purchaseDate:renewal.transaction.purchaseDate});off.subtype='AUTO_RENEW_DISABLED';off.signedDate=renewal.signedDate+1000;await processAppleNotification(off);assert.equal((await require('../src/utils/entitlement').currentPlan(1)).plan,'pro');
 await processAppleNotification({...refund,notificationUUID:'old-refund-again'});assert.equal((await require('../src/utils/entitlement').currentPlan(1)).plan,'pro');
});
test('未绑定交易通知不能猜店发pro，但先收到的退款不能被旧收据首次绑定复活',async()=>{
 const {processAppleNotification}=require('../src/services/appleNotifications');const r=event('REFUND','unbound-1',{originalTransactionId:'unbound',revocationDate:Date.now()});await processAppleNotification(r);
 assert.equal(await prisma.basePrisma.entitlement.count({where:{externalId:'unbound'}}),0);
 await bindApple(2,{...active,originalTransactionId:'unbound',transactionId:'unbound-1',latestTransactionId:'unbound-1'});assert.equal((await require('../src/utils/entitlement').currentPlan(2)).plan,'free');
});
test('通知边界拒绝假签名，未验签的数据不能进数据库',async()=>{
 const {verifyAppleNotification}=require('../src/utils/appleNotifications');await assert.rejects(()=>verifyAppleNotification('not.a.valid.apple.signature'),e=>[400,503].includes(e.status));
});

test('退款撤销后刷新较新的有效收据不能重新退款；宽限期不能被旧付费到期时间覆盖',async()=>{
 const {processAppleNotification}=require('../src/services/appleNotifications');
 const now=Date.now(), purchased=now-86400000;
 const receipt={...active,originalTransactionId:'reversed',transactionId:'rev-1',latestTransactionId:'rev-1',purchasedAt:new Date(purchased),verifiedAt:new Date(now-5000)};
 await bindApple(31,receipt);
 const refund=event('REFUND','rev-1',{originalTransactionId:'reversed',purchaseDate:purchased,revocationDate:now-3000});refund.signedDate=now-3000;
 await processAppleNotification(refund);
 const reversal=event('REFUND_REVERSED','rev-1',{originalTransactionId:'reversed',purchaseDate:purchased});reversal.signedDate=now-2000;
 await processAppleNotification(reversal);
 assert.equal((await bindApple(31,{...receipt,verifiedAt:new Date(now)})).row.status,'active');
 const laterRefund=await bindApple(31,{...receipt,verifiedAt:new Date(now+1000),revokedAt:new Date(now+500),status:'refunded'});
 assert.equal(laterRefund.row.status,'refunded','较早的退款撤销不能消掉新退款');
 const expired={...receipt,originalTransactionId:'grace',transactionId:'grace-1',latestTransactionId:'grace-1',expiresAt:new Date(now-1000),status:'expired'};
 const grace=event('DID_FAIL_TO_RENEW','grace-1',{originalTransactionId:'grace',purchaseDate:purchased,expiresDate:now-1000});grace.signedDate=now-500;grace.subtype='GRACE_PERIOD';grace.renewal={gracePeriodExpiresDate:now+86400000};
 await processAppleNotification(grace);
 const result=await bindApple(32,{...expired,verifiedAt:new Date(now)});
 assert.equal(result.row.status,'active');assert.equal(result.row.expiresAt.getTime(),grace.renewal.gracePeriodExpiresDate);
});

test('较新收据请求时间不遮蔽延迟退款通知，通知乱序仍以最近事件为准',async()=>{
 const {processAppleNotification}=require('../src/services/appleNotifications');
 const now=Date.now(),purchase=now-10000,chain='delayed';
 await bindApple(33,{...active,originalTransactionId:chain,transactionId:chain,latestTransactionId:chain,purchasedAt:new Date(purchase),verifiedAt:new Date(now)});
 const refund=event('REFUND',chain,{originalTransactionId:chain,purchaseDate:purchase,revocationDate:now-2000});refund.signedDate=now-2000;
 await processAppleNotification(refund);assert.equal((await require('../src/utils/entitlement').currentPlan(33)).plan,'free');
 const reversed=event('REFUND_REVERSED',chain,{originalTransactionId:chain,purchaseDate:purchase});reversed.signedDate=now-1000;
 await processAppleNotification(reversed);assert.equal((await require('../src/utils/entitlement').currentPlan(33)).plan,'pro');
 await processAppleNotification({...refund,notificationUUID:'late-duplicate-refund'});assert.equal((await require('../src/utils/entitlement').currentPlan(33)).plan,'pro');
 const chain2='receipt-refund';
 await bindApple(34,{...active,originalTransactionId:chain2,transactionId:chain2,latestTransactionId:chain2,purchasedAt:new Date(purchase),verifiedAt:new Date(now),revokedAt:new Date(now-500),status:'refunded'});
 const lateReversal=event('REFUND_REVERSED',chain2,{originalTransactionId:chain2,purchaseDate:purchase});lateReversal.signedDate=now-1000;
 await processAppleNotification(lateReversal);assert.equal((await require('../src/utils/entitlement').currentPlan(34)).plan,'free','旧退款撤销通知不能覆盖较新收据中的退款');
});

test('收据无效撤销日期/越界日期必须拒绝，不发放权益',()=>{
 const {validatedReceipt}=require('../src/utils/appleReceipt');
 const row={product_id:product,transaction_id:'date-1',original_transaction_id:'dates',purchase_date_ms:String(Date.now()-1000),expires_date_ms:String(Date.now()+86400000)};
 const data=r=>({status:0,environment:'Production',receipt:{bundle_id:'com.carey.stockmate'},latest_receipt_info:[r]});
 for(const patch of [{cancellation_date_ms:'invalid'},{expires_date_ms:'1e100'},{revocation_date_ms:'invalid'}])assert.throws(()=>validatedReceipt(data({...row,...patch}),'production'),e=>e.status===400);
});
