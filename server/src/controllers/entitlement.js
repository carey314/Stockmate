const { z } = require('zod');
const { ok, fail } = require('../utils/response');
const { verifyAppleReceipt } = require('../utils/appleReceipt');

const { currentPlan, monthlyAiCalls, dailyAiCalls, daysHitLimit } = require('../utils/entitlement');

// App 读自己的权益状态。故意把「额度」和「渠道」都返回：
// 渠道字段让 App 知道这份权益是哪买的（用于展示"已通过 xx 订阅"），
// 但**绝不能**据此在 App 内引导去别的渠道购买——那是审核红线。
exports.mine = async (req, res) => {
  const coreLimitRaw = Number(process.env.FREE_AI_DAILY_CORE) || 0;
  const [{ plan, source, expiresAt }, month, core, other, hitDays] = await Promise.all([
    currentPlan(),
    monthlyAiCalls(),
    dailyAiCalls('core'),
    dailyAiCalls('other'),
    daysHitLimit(coreLimitRaw),
  ]);
  const free = plan === 'free';
  const {limitFor,resetInfo}=require('../utils/aiLimits');
  const lim = (n) => (free && n > 0 ? n : null); // null = 不限
  return ok(res, {
    plan,
    source,
    expiresAt,
    aiUsedThisMonth: month,
    // 本月有几天把口述额度用满了——订阅页用它说"这个月有 N 天不够用"
    daysHitLimitThisMonth: hitDays,
    // 按天给额度：App 可以在口述页显示"今天还能用 N 次"，不让用户蒙在鼓里撞墙
    today: {
      coreUsed: core,
      coreLimit: lim(limitFor('free','core')),
      otherUsed: other,
      otherLimit: lim(limitFor('free','other')),
      coreAntiAbuseLimit: free?null:(limitFor(plan,'core')||null),
      otherAntiAbuseLimit: free?null:(limitFor(plan,'other')||null),
      ...resetInfo(),
    },
  });
};

// POST /me/entitlement/apple —— App 内购完成后把收据送上来兑换权益。
//
// 为什么必须服务端校验：客户端说"我买了"是不可信的（越狱/改包/重放）。
// 苹果的收据是签过名的，只有苹果能确认真伪和到期时间。
//
// 幂等靠 originalTransactionId：这个 id 在整条续期链上不变，
// 每月续期都 upsert 到同一行，不会攒出一堆重复权益。
exports.redeemApple = async (req, res) => {
  const { receipt, transactionId, productId } = z.object({ receipt:z.string().min(20,'收据为空'), transactionId:z.string().min(1).optional(), productId:z.string().min(1).optional() }).parse(req.body);
  if(Boolean(transactionId)!==Boolean(productId))return fail(res,400,'请同时提供本次交易ID和商品ID');
  const verified=await verifyAppleReceipt(receipt,{transactionId,productId});
  if(!verified)return fail(res,400,'这份收据里没有支持的订阅记录');
  const {row,ownership}=await require('../services/appleEntitlement').bindApple(req.user.storeId,verified);
  await require('../services/metricsContext').recordVerifiedPurchase(req.user.userId,req.user.storeId,{...verified,status:row.status,revokedAt:row.appleRevokedAt});
  const effective=await currentPlan(req.user.storeId);
  const status=row.status==='active'&&row.expiresAt&&row.expiresAt<=new Date()?'expired':row.status;
  return ok(res,{...effective,transaction:{verified:true,storeId:row.storeId,originalTransactionId:row.externalId,transactionId:verified.transactionId,latestTransactionId:row.appleTransactionId,productId:verified.productId,environment:row.appleEnvironment,status,expiresAt:row.expiresAt,ownership}},status==='active'?'本次交易已验证并生效':'本次交易已验证，但当前已失效');
};

exports.appleNotification = async (req,res) => {
 const {signedPayload}=z.object({signedPayload:z.string().min(20).max(200000)}).parse(req.body);
 const event=await require('../utils/appleNotifications').verifyAppleNotification(signedPayload);
 const processed=await require('../services/appleNotifications').processAppleNotification(event);
 await require('../services/metricsContext').observeVerifiedNotification(event);
 return ok(res,processed);
};
