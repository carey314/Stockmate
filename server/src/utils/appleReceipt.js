// 苹果内购收据校验。
//
// 用的是 verifyReceipt 接口：一次 POST 带上整份 App 收据和 App 专用共享密钥，
// 苹果把这个 Apple ID 下所有交易连同到期时间一起还回来。
// 苹果标记它为「已弃用」，推荐 App Store Server API（需要 .p8 私钥 + ES256 签 JWT +
// 按 transactionId 逐笔查）。对我们这个体量，verifyReceipt 少写一大半代码而且照常工作，
// 先用它上线；等订阅量起来或苹果真关停，再迁到 Server API（换掉本文件即可，
// 上层 grantEntitlement 那套一行不用动）。
//
// 关键约定：
//   - 先打生产环境，收到 21007 再打沙盒。**顺序不能反**——沙盒收据打生产会返回 21007，
//     而生产收据打沙盒返回 21008。苹果审核用的是沙盒账号，只打生产就会把审核员挡在门外。
//   - 只认「未过期的自动续期订阅」，取到期最晚的那条为准（用户可能升降档过）。
const PROD = 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX = 'https://sandbox.itunes.apple.com/verifyReceipt';

// 苹果 status 码里需要区别对待的几个
const STATUS_SANDBOX_RECEIPT_ON_PROD = 21007;
const STATUS_PROD_RECEIPT_ON_SANDBOX = 21008;

const post = async (url, receipt, secret) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'receipt-data': receipt,
      password: secret,
      'exclude-old-transactions': false, // 要全量，才能算出最晚到期时间
    }),
  });
  if (!r.ok) throw new Error(`苹果校验服务返回 ${r.status}`);
  return r.json();
};

/// 校验收据，返回 { productId, expiresAt, originalTransactionId, environment } 或 null（无有效订阅）
const verifyAppleReceipt = async (receiptBase64) => {
  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret) throw Object.assign(new Error('未配置 APPLE_SHARED_SECRET'), { status: 503 });

  let env = 'production';
  let data = await post(PROD, receiptBase64, secret);
  if (data.status === STATUS_SANDBOX_RECEIPT_ON_PROD) {
    env = 'sandbox';
    data = await post(SANDBOX, receiptBase64, secret);
  } else if (data.status === STATUS_PROD_RECEIPT_ON_SANDBOX) {
    // 理论上不会走到（我们先打生产），留着是为了报错能说清原因
    throw Object.assign(new Error('收据环境不匹配（生产收据打到了沙盒）'), { status: 400 });
  }
  if (data.status !== 0) {
    throw Object.assign(new Error(`收据无效（苹果 status=${data.status}）`), { status: 400 });
  }

  // latest_receipt_info 是这个 Apple ID 下所有订阅交易，含续期。取到期最晚的那条。
  const items = data.latest_receipt_info ?? [];
  let best = null;
  for (const it of items) {
    const ms = Number(it.expires_date_ms ?? 0);
    if (!ms) continue; // 非订阅型商品（我们目前没有）
    if (!best || ms > Number(best.expires_date_ms)) best = it;
  }
  if (!best) return null;

  const expiresAt = new Date(Number(best.expires_date_ms));
  return {
    productId: best.product_id,
    expiresAt,
    // originalTransactionId 在整条续期链上是稳定的——用它做 externalId，
    // 续期时 upsert 到同一行而不是每月新增一条
    originalTransactionId: best.original_transaction_id,
    environment: env,
    isActive: expiresAt.getTime() > Date.now(),
  };
};

module.exports = { verifyAppleReceipt };
