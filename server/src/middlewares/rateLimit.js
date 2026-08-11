// 接口限流：零依赖内存实现（单 PM2 进程，够用且不引入新依赖）。
//
// 三条线各有各的怕：
//   auth  —— 怕撞库（拿密码字典硬猜）
//   ai    —— 怕烧钱（每次调用都花真金白银的 DeepSeek 额度）
//   全局  —— 怕失控（客户端死循环或脚本刷接口把服务器打满）
// 阈值都设得比真实店铺用量宽松很多：正常用永远碰不到，异常流量立刻挡住。
const { fail } = require('../utils/response');

const buckets = new Map(); // key -> { count, resetAt }

// 定期清理过期桶，别让 Map 无限长大
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

const limiter = ({ windowMs, max, keyOf, message }) => (req, res, next) => {
  const key = `${keyOf(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  b.count += 1;
  if (b.count > max) {
    const wait = Math.ceil((b.resetAt - now) / 1000);
    res.set('Retry-After', String(wait));
    return fail(res, 429, `${message}（请 ${wait} 秒后再试）`);
  }
  next();
};

const ip = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
const num = (name, dft) => Number(process.env[name]) || dft;

// 登录/注册：防撞库。一个 IP 5 分钟 60 次——正常人输错几次密码远够用
const authLimiter = limiter({
  windowMs: 5 * 60_000,
  max: num('RATE_AUTH_MAX', 60),
  keyOf: (req) => `auth:${ip(req)}`,
  message: '尝试太频繁了',
});

// AI 接口：防烧钱。按账号算，一小时 120 次（一家店一天口述几十次顶天了）
const aiLimiter = limiter({
  windowMs: 60 * 60_000,
  max: num('RATE_AI_MAX', 120),
  keyOf: (req) => `ai:${req.user?.userId ?? ip(req)}`,
  message: 'AI 用得太频繁了，歇一会儿',
});

// 全局兜底：防失控
const globalLimiter = limiter({
  windowMs: 60_000,
  max: num('RATE_GLOBAL_MAX', 1200),
  keyOf: (req) => `all:${ip(req)}`,
  message: '请求太频繁',
});

module.exports = { authLimiter, aiLimiter, globalLimiter };
