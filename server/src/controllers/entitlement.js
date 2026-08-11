const { ok } = require('../utils/response');
const { currentPlan, monthlyAiCalls, dailyAiCalls } = require('../utils/entitlement');

// App 读自己的权益状态。故意把「额度」和「渠道」都返回：
// 渠道字段让 App 知道这份权益是哪买的（用于展示"已通过 xx 订阅"），
// 但**绝不能**据此在 App 内引导去别的渠道购买——那是审核红线。
exports.mine = async (req, res) => {
  const [{ plan, source, expiresAt }, month, core, other] = await Promise.all([
    currentPlan(),
    monthlyAiCalls(),
    dailyAiCalls('core'),
    dailyAiCalls('other'),
  ]);
  const free = plan === 'free';
  const lim = (n) => (free && n > 0 ? n : null); // null = 不限
  return ok(res, {
    plan,
    source,
    expiresAt,
    aiUsedThisMonth: month,
    // 按天给额度：App 可以在口述页显示"今天还能用 N 次"，不让用户蒙在鼓里撞墙
    today: {
      coreUsed: core,
      coreLimit: lim(Number(process.env.FREE_AI_DAILY_CORE) || 0),
      otherUsed: other,
      otherLimit: lim(Number(process.env.FREE_AI_DAILY_OTHER) || 0),
    },
  });
};
