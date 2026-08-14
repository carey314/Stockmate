#!/usr/bin/env node
// 客服人工重置密码（老板本人忘密码时的唯一出路——注册不强制手机号，没有自助找回通道）。
// 用法（先人工核实身份：店名 + 用户名 + 最近单据信息对得上再操作）：
//   env -u NODE_OPTIONS node scripts/reset-password.js <用户名> <新密码>
// 生产：ssh root@qxju.shop 后在 /opt/stockmate/server 下执行。
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const [username, newPassword] = process.argv.slice(2);
if (!username || !newPassword) {
  console.error('用法: node scripts/reset-password.js <用户名> <新密码>');
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error('新密码至少 6 位');
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.error(`用户不存在: ${username}`);
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    console.log(`✓ 已重置 ${username}（${user.realName ?? ''} / 店铺#${user.storeId} / 角色 ${user.role}）的密码`);
    console.log('提醒用户：登录后尽快在 设置 → 修改我的密码 里改成自己的密码');
  } finally {
    await prisma.$disconnect();
  }
})();
