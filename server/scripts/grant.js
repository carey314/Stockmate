// 人工发放/撤销权益（内测、补偿、线下成交都走这里）。
// 跑法：
//   env -u NODE_OPTIONS node scripts/grant.js <用户名> pro 365     # 发 365 天 pro
//   env -u NODE_OPTIONS node scripts/grant.js <用户名> revoke      # 撤销人工发放的权益
const { basePrisma } = require('../src/config/prisma');
const { grantEntitlement, currentPlan } = require('../src/utils/entitlement');
(async () => {
  const [username, plan, days] = process.argv.slice(2);
  if (!username) return console.log('用法: node scripts/grant.js <用户名> <pro|revoke> [天数]');
  const user = await basePrisma.user.findUnique({ where: { username } });
  if (!user) return console.log(`找不到用户 ${username}`);
  if (plan === 'revoke') {
    const r = await basePrisma.entitlement.updateMany({ where: { storeId: user.storeId, source: 'manual' }, data: { status: 'canceled' } });
    console.log(`已撤销 ${r.count} 条人工权益`);
  } else {
    const expiresAt = days ? new Date(Date.now() + Number(days) * 864e5) : null;
    await grantEntitlement({ storeId: user.storeId, plan: plan || 'pro', source: 'manual', expiresAt, note: '人工发放' });
    console.log(`已发放 ${plan || 'pro'}${expiresAt ? ` 至 ${expiresAt.toLocaleDateString('zh-CN')}` : '（永久）'}`);
  }
  console.log('当前权益:', await currentPlan(user.storeId));
  await basePrisma.$disconnect();
})();
