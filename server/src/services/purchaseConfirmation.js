const {z}=require('zod');const crypto=require('node:crypto');
const {transaction}=require('../utils/transaction');const {createPurchase}=require('./purchases');const {httpError,money}=require('../utils/biz');
const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
async function confirmedPurchase(input,actorId){
 const requestId=z.string().min(8).max(128).optional().parse(input.requestId);
 const {requestId:_,...body}=input;const hash=crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
 return transaction(async tx=>{
  const requestKey=requestId?`purchase-create:${requestId}`:null;
  if(requestKey){const prior=await tx.entryConfirmation.findFirst({where:{requestKey}});if(prior){if(prior.actorId!==actorId||prior.contentHash!==hash)throw httpError(409,'采购确认编号已用于其他内容，请核对原单');return {...JSON.parse(prior.response),replayed:true};}}
  const reservation=requestKey?await tx.entryConfirmation.create({data:{requestKey,actorId,contentHash:hash,response:''}}):null;
  const po=await createPurchase(tx,body,actorId);const result={...po,unpaidAmount:money(po.actualAmount-po.paidAmount),...(requestId?{requestId,replayed:false}:{})};
  if(reservation)await tx.entryConfirmation.update({where:{id:reservation.id},data:{response:JSON.stringify(result)}});
  return result;
 });
}
module.exports={confirmedPurchase};
