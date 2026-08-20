const { z } = require('zod');
const { ok, fail } = require('../utils/response');
const { verifyAppleReceipt } = require('../utils/appleReceipt');

// 商品 ID → 权益档位。加新商品必须同步这里，否则买了也不发权益。
const PRODUCT_TO_PLAN = {
  'com.carey.stockmate.pro.monthly': 'pro',
  'com.carey.stockmate.pro.yearly': 'pro',
};
const { currentPlan, monthlyAiCalls, dailyAiCalls, daysHitLimit, grantEntitlement, revokeEntitlement } = require('../utils/entitlement');

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
      coreLimit: lim(Number(process.env.FREE_AI_DAILY_CORE) || 0),
      otherUsed: other,
      otherLimit: lim(Number(process.env.FREE_AI_DAILY_OTHER) || 0),
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
  const { receipt } = z.object({ receipt: z.string().min(20, '收据为空') }).parse(req.body);
  const r = await verifyAppleReceipt(receipt);
  if (!r) return fail(res, 400, '这份收据里没有订阅记录');
  if (!r.isActive) {
    // 过期收据不发权益，但要把状态落下来（用户可能是想恢复购买但订阅确实已过期）
    await revokeEntitlement({ source: 'apple', externalId: r.originalTransactionId, status: 'expired' });
    return fail(res, 400, `订阅已于 ${r.expiresAt.toISOString().slice(0, 10)} 过期`);
  }

  const plan = PRODUCT_TO_PLAN[r.productId];
  if (!plan) return fail(res, 400, `未知的订阅商品 ${r.productId}`);

  await grantEntitlement({
    storeId: req.user.storeId,
    plan,
    source: 'apple',
    externalId: r.originalTransactionId,
    expiresAt: r.expiresAt,
    note: `${r.productId} · ${r.environment}`,
  });
  return ok(res, { plan, expiresAt: r.expiresAt }, '订阅已生效');
};
