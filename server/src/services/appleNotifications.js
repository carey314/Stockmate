const {transaction:atomic}=require('../utils/transaction');
const {applyApple}=require('./appleEntitlement');
const {PRODUCTS}=require('../utils/appleReceipt');
const {httpError}=require('../utils/biz');
const validDate=n=>Number.isSafeInteger(n)&&n>0&&n<=8640000000000000;
// 仅由已完成Apple JWS验证的适配器调用；公开路由不可直接调用此函数处理JSON声明。
async function processAppleNotification(event) {
 if(!event.notificationUUID||!validDate(event.signedDate))throw httpError(400,'Apple通知标识或时间缺失');
 const info=event.transaction;
 let state=null;
 if(info){
  if(info.bundleId!==(process.env.APPLE_BUNDLE_ID||'com.carey.stockmate')||!PRODUCTS.has(info.productId)||!['Production','Sandbox'].includes(info.environment)||!info.originalTransactionId||!info.transactionId||!validDate(info.purchaseDate)||!validDate(info.expiresDate))throw httpError(400,'Apple通知交易内容不符合本应用');
  if((info.revocationDate!=null&&!validDate(info.revocationDate))||(event.renewal?.gracePeriodExpiresDate!=null&&!validDate(event.renewal.gracePeriodExpiresDate)))throw httpError(400,'Apple通知撤销或宽限期日期无效');
  const revoked=info.revocationDate||(event.notificationType==='REFUND'||event.notificationType==='REVOKE'?event.signedDate:null);
  const reversed=event.notificationType==='REFUND_REVERSED';
  const graceExpiresAt=event.renewal?.gracePeriodExpiresDate||null;
  const expiry=Math.max(info.expiresDate,graceExpiresAt||0);
  state={originalTransactionId:info.originalTransactionId,transactionId:info.transactionId,latestTransactionId:info.transactionId,productId:info.productId,latestProductId:info.productId,environment:info.environment.toLowerCase(),purchasedAt:new Date(info.purchaseDate),expiresAt:new Date(expiry),verifiedAt:new Date(event.signedDate),revokedAt:reversed?null:revoked?new Date(revoked):null,refundReversed:reversed,status:revoked&&!reversed?'refunded':expiry<=Date.now()?'expired':'active'};
  state.graceExpiresAt=graceExpiresAt?new Date(graceExpiresAt):null;
 }
 return atomic(async tx=>{
  if(await tx.appleNotification.findUnique({where:{id:event.notificationUUID}}))return {processed:true,replayed:true};
  await tx.appleNotification.create({data:{id:event.notificationUUID,type:event.notificationType||'UNKNOWN',originalTransactionId:state?.originalTransactionId??null,signedAt:new Date(event.signedDate),state:state?JSON.stringify(state):null}});
  if(!state)return {processed:true,replayed:false};
  const owner=await tx.entitlement.findUnique({where:{source_externalId:{source:'apple',externalId:state.originalTransactionId}}});
  if(!owner)return {processed:true,replayed:false,bound:false};
  const later=await tx.appleNotification.findMany({where:{originalTransactionId:state.originalTransactionId,signedAt:{gt:new Date(event.signedDate)},state:{not:null}}});
  if(later.some(row=>JSON.parse(row.state).latestTransactionId===state.latestTransactionId))return {processed:true,replayed:false,bound:true};
  if(state.refundReversed&&owner.appleTransactionId===state.latestTransactionId&&owner.appleRevokedAt>new Date(event.signedDate))return {processed:true,replayed:false,bound:true};
  // 收据的请求时间可能晚于延迟送达的通知，不能因此丢掉退款等状态变化。
  // 同笔通知按signedDate排序；不同续期仍由purchaseDate保护。
  if(owner.appleVerifiedAt>state.verifiedAt)state.verifiedAt=owner.appleVerifiedAt;
  await applyApple(tx,owner.storeId,state,{allowBind:false});
  return {processed:true,replayed:false,bound:true};
 });
}
module.exports={processAppleNotification};
