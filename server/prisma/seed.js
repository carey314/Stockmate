// 种子数据：管理员账号 + 三套预设品类模板（酒水/玩具/餐饮食材）
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { seedPresetTypes } = require('./presetTypes');

const prisma = new PrismaClient();

// 预设模板：开箱即用 + 当范例教用户“字段长这样”

async function main() {
  // 管理员（幂等）
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: await bcrypt.hash('admin123', 10),
      realName: '管理员',
      role: 'admin',
    },
  });

  // 预设品类（按名字幂等，播给默认店 1）
  await seedPresetTypes(prisma, 1);

  console.log('✓ seed 完成：admin/admin123 + 3 套预设品类（酒水/玩具/餐饮食材）');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
