// 看客户端崩溃日志（运维用，故意不做成 API——那会让任意店主看到别人的堆栈）
// 跑法：env -u NODE_OPTIONS node scripts/errors.js [条数]
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const take = Number(process.argv[2]) || 30;
  const rows = await p.clientLog.findMany({ orderBy: { id: 'desc' }, take });
  if (!rows.length) return console.log('暂无客户端错误上报 🎉');
  const byMsg = {};
  for (const r of rows) byMsg[r.message] = (byMsg[r.message] || 0) + 1;
  console.log('=== 出现次数排行 ===');
  Object.entries(byMsg).sort((a, b) => b[1] - a[1]).forEach(([m, c]) => console.log(`  ${c}次  ${m.slice(0, 100)}`));
  console.log(`\n=== 最近 ${rows.length} 条 ===`);
  for (const r of rows) {
    console.log(`\n[${r.createdAt.toLocaleString('zh-CN')}] ${r.level} ${r.platform ?? ''} v${r.appVersion ?? '?'} user=${r.userId ?? '未登录'}`);
    console.log(`  ${r.message.slice(0, 200)}`);
    if (r.stack) console.log(`  ${r.stack.split('\n').slice(0, 3).join('\n  ')}`);
  }
  await p.$disconnect();
})();
