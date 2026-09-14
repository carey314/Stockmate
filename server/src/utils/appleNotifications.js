const { verifySigned } = require('./appleSignedData');
const { httpError } = require('./biz');
async function verifyAppleNotification(signedPayload) {
 return verifySigned(signedPayload,async(verifier,payload)=>{
  const notification=await verifier.verifyAndDecodeNotification(payload);
  const transaction=notification.data?.signedTransactionInfo?await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo):null;
  const renewal=notification.data?.signedRenewalInfo?await verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo):null;
  if(renewal&&transaction&&renewal.originalTransactionId!==transaction.originalTransactionId)throw httpError(400,'Apple续订信息不属于同一交易');
  return {...notification,transaction,renewal};
 });
}
module.exports={verifyAppleNotification};
