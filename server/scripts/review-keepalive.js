// 审核演示店保活：每天给 review 店造 2-3 笔当日销售单。
//
// 为什么需要它：苹果审核哪天来没人知道。演示数据只造一次的话，审核员打开
// 首页看到的是「今日销售额 ¥0 · 0 单」——一家死店，第一印象直接完蛋。
// 这个脚本挂在服务器 cron 上每天早上跑一次，保证演示店永远"活着"。
//
// 三条纪律：
//   1. 只走 HTTP API、只用 review 账号登录——租户隔离由后端保证，
//      这个脚本在物理上碰不到任何真实用户的店。
//   2. 幂等保护：当天已有 ≥3 单就直接退出（审核员/我们自己手动演示过的那天不叠加）。
//   3. 全部现款结清（散客），不挂账——日积月累的假欠款会把"客户欠款"页面变成垃圾场。
//
// 用法：node scripts/review-keepalive.js   （依赖服务本机 3100 端口）
const BASE = process.env.KEEPALIVE_BASE || 'http://localhost:3100/api/v1';
const USER = 'review';
const PASS = 'ReviewDemo2026';

const api = async (method, path, body, token) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.code && j.code >= 400) throw new Error(`${method} ${path} → ${j.code} ${j.message}`);
  return j.data ?? j;
};

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

(async () => {
  const { token } = await api('POST', '/auth/login', { username: USER, password: PASS });

  const ov = await api('GET', '/stats/overview', null, token);
  if ((ov.todayOrderCount ?? 0) >= 3) {
    console.log(`今天已有 ${ov.todayOrderCount} 单，不叠加，退出`);
    return;
  }

  const prods = (await api('GET', '/products?page=1&pageSize=50', null, token)).list ?? [];
  // 只挑有正价规格的商品，价格为 0 的演示品开出来的单不像真的
  const skus = prods.flatMap((p) => (p.skus ?? []).filter((s) => (s.price ?? 0) > 0).map((s) => ({ ...s, pname: p.name })));
  if (skus.length < 2) {
    console.log('演示店可卖规格不足 2 个，跳过（先去补商品数据）');
    return;
  }

  const orderCount = 2 + Math.floor(Math.random() * 2); // 2-3 单
  for (let i = 0; i < orderCount; i++) {
    const lineCount = 1 + Math.floor(Math.random() * 2); // 每单 1-2 行
    const chosen = [];
    while (chosen.length < lineCount) {
      const s = rnd(skus);
      if (!chosen.find((c) => c.id === s.id)) chosen.push(s);
    }
    const items = chosen.map((s) => ({ skuId: s.id, quantity: 1 + Math.floor(Math.random() * 3), unitPrice: s.price }));
    const total = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
    await api('POST', '/orders', {
      items,
      paidAmount: total, // 现款结清，不留假欠款
      settlementAccount: rnd(['现金', '微信', '支付宝']),
    }, token);
    console.log(`✓ 单${i + 1}：${chosen.map((c) => c.pname).join('+')} ¥${total.toFixed(2)}`);
  }
  console.log(`完成：今天新增 ${orderCount} 单`);
})().catch((e) => {
  console.error('keepalive 失败：', e.message);
  process.exit(1);
});
