// Apple HTTPS验证结果是事实源；客户端交易ID/商品ID仅用于选择本次事件。
const { httpError } = require('./biz');
const PRODUCTS = new Set(['com.carey.stockmate.pro.monthly', 'com.carey.stockmate.pro.yearly']);
const PROD = 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';
const date = value => { const n=Number(value); return Number.isSafeInteger(n) && n>0 && n<=8640000000000000 ? new Date(n) : null; };
async function post(url, receipt, secret) {
  const response = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(15000), body:JSON.stringify({'receipt-data':receipt,password:secret,'exclude-old-transactions':false}) });
  if(!response.ok) throw httpError(502,'Apple校验服务暂不可用，请保留购买记录后重试');
  return response.json();
}
function validatedReceipt(data, environment, selector={}) {
  if (![0,21006].includes(data.status)) throw httpError(400,`收据无效（Apple status=${data.status}）`);
  if(data.receipt?.bundle_id !== (process.env.APPLE_BUNDLE_ID || 'com.carey.stockmate')) throw httpError(400,'收据不属于本应用');
  if(data.environment !== (environment==='sandbox'?'Sandbox':'Production')) throw httpError(400,'收据环境不匹配');
  const rows=Array.isArray(data.latest_receipt_info)?data.latest_receipt_info:[];
  const supported=rows.filter(r=>PRODUCTS.has(r.product_id));
  let selected;
  if(selector.transactionId) {
    selected=supported.find(r=>r.transaction_id===selector.transactionId && (!selector.productId||r.product_id===selector.productId));
    if(!selected)throw httpError(400,'收据中不存在本次交易或商品不匹配');
  } else {
    const chains=new Set(supported.map(r=>r.original_transaction_id));
    if(chains.size>1)throw httpError(400,'收据包含多条订阅，请提供本次交易ID和商品ID');
    selected=supported[0];
  }
  if(!selected)return null;
  if(!selected.transaction_id||!selected.original_transaction_id)throw httpError(400,'Apple交易标识缺失');
  const chain=supported.filter(r=>r.original_transaction_id===selected.original_transaction_id);
  for(const r of chain)if(!date(r.purchase_date_ms)||!date(r.expires_date_ms)||!r.transaction_id||['cancellation_date_ms','revocation_date_ms'].some(k=>r[k]!=null&&!date(r[k])))throw httpError(400,'Apple交易日期或标识无效');
  chain.sort((a,b)=>Number(b.purchase_date_ms)-Number(a.purchase_date_ms)||Number(b.expires_date_ms)-Number(a.expires_date_ms));
  const latest=chain[0], revokedAt=date(latest.cancellation_date_ms??latest.revocation_date_ms);
  let expiresAt=date(latest.expires_date_ms);
  const renewal=(Array.isArray(data.pending_renewal_info)?data.pending_renewal_info:[]).find(r=>r.original_transaction_id===latest.original_transaction_id&&r.product_id===latest.product_id);
  const grace=renewal?.is_in_billing_retry_period==='1'?date(renewal.grace_period_expires_date_ms):null;
  if(grace&&grace>expiresAt)expiresAt=grace;
  const status=revokedAt?'refunded':expiresAt.getTime()<=Date.now()?'expired':'active';
  return {productId:selected.product_id,transactionId:selected.transaction_id,originalTransactionId:selected.original_transaction_id,latestTransactionId:latest.transaction_id,latestProductId:latest.product_id,expiresAt,purchasedAt:date(latest.purchase_date_ms),verifiedAt:date(data.receipt.request_date_ms)||new Date(),revokedAt,environment,status,isActive:status==='active'};
}
async function verifyAppleReceipt(receipt,selector={}) {
  if(receipt.includes('.')) {
    const info=await require('./appleSignedData').verifyAppleSignedTransaction(receipt);
    if(!PRODUCTS.has(info.productId)||!info.transactionId||!info.originalTransactionId||!date(info.purchaseDate)||!date(info.expiresDate)||!date(info.signedDate)||(info.revocationDate!=null&&!date(info.revocationDate)))throw httpError(400,'Apple签名交易商品、日期或标识无效');
    if((selector.transactionId&&selector.transactionId!==info.transactionId)||(selector.productId&&selector.productId!==info.productId))throw httpError(400,'Apple签名交易与本次交易或商品不匹配');
    const expiresAt=date(info.expiresDate),revokedAt=date(info.revocationDate);
    const status=revokedAt?'refunded':expiresAt<=new Date()?'expired':'active';
    return {productId:info.productId,transactionId:info.transactionId,originalTransactionId:info.originalTransactionId,latestTransactionId:info.transactionId,latestProductId:info.productId,expiresAt,purchasedAt:date(info.purchaseDate),verifiedAt:date(info.signedDate),revokedAt,environment:info.environment.toLowerCase(),status,isActive:status==='active'};
  }
  const secret=process.env.APPLE_SHARED_SECRET;if(!secret)throw httpError(503,'未配置Apple收据验证，请保留购买记录并联系支持');
  let data=await post(PROD,receipt,secret),environment='production';
  if(data.status===21007){environment='sandbox';data=await post(SANDBOX,receipt,secret);}
  return validatedReceipt(data,environment,selector);
}
module.exports={verifyAppleReceipt,validatedReceipt,PRODUCTS};
