// AI 用量计量 + 额度闸门。
//
// 折中方案的三条腿（第四条「提示词瘦身」在 aiParse 里）：
//
// 1) **按天不按月**。月额度的毛病是"月初挥霍、月末干瞪眼"——用户一旦撞墙，
//    这个月剩下的日子都在生气。按天给，明天就恢复，挫败感几乎为零，
//    而成本上限跟月额度是一样的（日额度×30）。
//
// 2) **好钢用在刀刃上**。口述记账是这个 App 的灵魂，额度给足；
//    AI 问生意/生成商品/粘贴导入都是低频且有手动替代方案的，共用一份小额度。
//    不区分环节的话，用户用几次"生成商品"就把当天的口述额度耗光了，很冤。
//
// 3) **超额是软着陆不是硬墙**。文案必须说清两件事：明天就恢复、以及
//    手动开单记账完全不受影响（基础功能永久免费是写进 App 的承诺）。
//
// 全部通过环境变量控制，0 或不配 = 不限：
//   FREE_AI_DAILY_CORE=8    口述记账（parse-entry / confirm-entry）
//   FREE_AI_DAILY_OTHER=5   其余 AI 功能共用
const { fail } = require('../utils/response');
const { currentPlan, recordAiUsage, dailyAiCalls, PLAN_FREE } = require('../utils/entitlement');

// 核心 = 口述记账链路；其余共用另一份额度
const CORE = new Set(['parse-entry', 'confirm-entry']);
const bucketOf = (endpoint) => (CORE.has(endpoint) ? 'core' : 'other');

const num = (name) => Number(process.env[name]) || 0;

const aiMeter = (endpoint) => async (req, res, next) => {
  const bucket = bucketOf(endpoint);
  const limit = bucket === 'core' ? num('FREE_AI_DAILY_CORE') : num('FREE_AI_DAILY_OTHER');

  if (limit > 0) {
    try {
      const { plan } = await currentPlan();
      if (plan === PLAN_FREE) {
        const used = await dailyAiCalls(bucket);
        if (used >= limit) {
          const what = bucket === 'core' ? '今天的 AI 记账次数' : '今天的 AI 助手次数';
          return fail(
            res,
            402,
            `${what}用完了（${used}/${limit}），明天 0 点自动恢复。` +
              (bucket === 'core'
                ? '着急的话手动开单一样快：商品列表点两下就成单，记账、报表、对账都不受影响。'
                : '这个功能有手动替代方案，不影响你正常做生意。')
          );
        }
      }
    } catch (_) {
      /* 额度判断出错就放行：宁可少收钱，也不能让老板干不了活 */
    }
  }

  // 只在真正调用成功后才计数（AI 服务挂了不该算用户头上）
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) recordAiUsage(endpoint);
  });
  next();
};

module.exports = { aiMeter, bucketOf, CORE };
