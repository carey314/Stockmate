const { transaction }=require('../utils/transaction');
const { httpError }=require('../utils/biz');
// 归属校验先于任何状态变更，包括过期/退款；不会撤销另一店的权益。
async function applyApple(tx, storeId, verified, {allowBind=true}={}) {
 const externalId=verified.originalTransactionId;
 const prior=await tx.entitlement.findUnique({where:{source_externalId:{source:'apple',externalId}}});
 if(prior&&prior.storeId!==storeId)throw httpError(409,'该交易已绑定其他店铺，请回到购买时的店铺恢复');
 if(!prior&&!allowBind)return null;
 if(prior?.appleEnvironment&&prior.appleEnvironment!==verified.environment)throw httpError(400,'同一交易的Apple环境不一致');
 const olderPurchase=prior?.applePurchaseAt && verified.purchasedAt<prior.applePurchaseAt;
 const olderObservation=prior?.appleVerifiedAt && verified.verifiedAt<prior.appleVerifiedAt;
 const sameTransaction=prior?.appleTransactionId===verified.latestTransactionId;
 // 对旧通知/旧收据保持单调；退款墓碑不能被同笔未撤销的旧快照复活。
 const stickyRefund=sameTransaction&&prior.appleRevokedAt&&!verified.revokedAt&&!verified.refundReversed;
 if(prior&&(olderPurchase||(sameTransaction&&olderObservation)||stickyRefund))return {row:prior,ownership:'restored'};
 const fields={plan:'pro',expiresAt:verified.expiresAt,status:verified.status,note:`${verified.latestProductId} · ${verified.environment}`,appleTransactionId:verified.latestTransactionId,appleProductId:verified.latestProductId,appleEnvironment:verified.environment,applePurchaseAt:verified.purchasedAt,appleVerifiedAt:verified.verifiedAt,appleRevokedAt:verified.revokedAt??null};
 const row=prior?await tx.entitlement.update({where:{id:prior.id},data:fields}):await tx.entitlement.create({data:{storeId,source:'apple',externalId,...fields}});
 return {row,ownership:prior?'restored':'bound'};
}
const revive = state => { const s=JSON.parse(state); for(const k of ['expiresAt','purchasedAt','verifiedAt','revokedAt','graceExpiresAt']) if(s[k])s[k]=new Date(s[k]); return s; };
const bindApple=(storeId,verified)=>transaction(async tx=>{
  // 通知可能先于首次兑换到达；未绑定时也保留验证过的状态，不能靠旧收据绕过退款。
  const events=await tx.appleNotification.findMany({where:{originalTransactionId:verified.originalTransactionId,state:{not:null}},orderBy:{signedAt:'asc'}});
  const states=events.map(event=>revive(event.state));
  let state={...verified};
  for(const next of states)if(next.purchasedAt>state.purchasedAt||(next.latestTransactionId===state.latestTransactionId&&next.verifiedAt>=state.verifiedAt))state={...next};
  // 收据请求时间不是退款/撤销/宽限期的事件时间。按已签名通知的先后折叠同一笔交易，
  // 再合并新的收据；否则刷新收据会抹掉宽限期，或把已撤销的退款重新应用。
  const same=states.filter(next=>next.latestTransactionId===state.latestTransactionId);
  const disposition=same.filter(next=>next.revokedAt||next.refundReversed).at(-1);
  if(disposition&&(!state.revokedAt||state.revokedAt<=disposition.verifiedAt)){state.revokedAt=disposition.revokedAt;state.refundReversed=!!disposition.refundReversed;}
  const last=same.at(-1);
  if(last?.graceExpiresAt&&last.graceExpiresAt>state.expiresAt)state.expiresAt=last.graceExpiresAt;
  state.status=state.revokedAt?'refunded':state.expiresAt>new Date()?'active':'expired';
  return applyApple(tx,storeId,state);
});
module.exports={bindApple,applyApple};
