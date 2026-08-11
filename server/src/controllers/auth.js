const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { runWithTenant } = require('../config/prisma');
const { seedPresetTypes } = require('../../prisma/presetTypes');
const { ok, fail } = require('../utils/response');
const { httpError } = require('../utils/biz');
const { verifyAppleToken } = require('../utils/appleAuth');

const issueJwt = (user) =>
  jwt.sign({ userId: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

exports.login = async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || user.status !== 1) return fail(res, 401, '用户名或密码错误');
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return fail(res, 401, '用户名或密码错误');
  return ok(res, {
    token: issueJwt(user),
    user: { id: user.id, username: user.username, realName: user.realName, role: user.role },
  });
};

// 用户名密码注册（注册即登录）
const registerSchema = z.object({
  username: z
    .string()
    .trim() // 防首尾空格造成"看不见的重名/查无此人"
    .min(3, '用户名至少 3 位')
    .max(20, '用户名最多 20 位')
    .regex(/^[a-zA-Z0-9_一-龥]+$/, '用户名只能是中英文、数字、下划线'),
  password: z.string().min(6, '密码至少 6 位'),
  realName: z.string().max(30).nullish(), // 称呼/店名，选填
});

// 多租户隔离上线前的止血闸：生产库是单店数据池，陌生注册者会看到并能改全部数据。
// 生产 .env 设 ALLOW_REGISTRATION=false 关闭注册；本地/开发不设即保持开放。隔离做完后移除此闸。
const registrationClosed = () => process.env.ALLOW_REGISTRATION === 'false';

exports.register = async (req, res) => {
  if (registrationClosed()) return fail(res, 403, '注册暂未开放，敬请期待');
  const data = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { username: data.username } });
  // 说清楚占用的是哪个字段，店名不参与查重
  if (exists) return fail(res, 409, `用户名「${data.username}」已被注册，换一个用户名试试（店名不影响，无需修改）`);
  // 注册 = 建店：新店数据与其他店完全隔离。建店+建号+播预设品类必须原子，
  // 否则中途失败会留下没有用户的孤儿店。整体包进事务，租户上下文经 runWithTenant 注入。
  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.$transaction(async (tx) => {
    const store = await tx.store.create({ data: { name: data.realName?.trim() || data.username } });
    return runWithTenant(store.id, async () => {
      const u = await tx.user.create({
        data: {
          username: data.username,
          passwordHash,
          realName: data.realName?.trim() || data.username,
          role: 'admin',
        },
      });
      // 刻意不预填品类：给所有人塞"酒水/玩具/餐饮食材"，对水果店老板就是三个要删的垃圾，
      // 还传递了"这软件不懂我"。新店就是空的，首页的「三步开工」引导会带他说出自己的行业，
      // AI 现场配——这才是"30秒配成你这行"。（预设数据仍保留给 prisma/seed.js 的开发种子用）
      return u;
    });
  });
  return ok(res, {
    token: issueJwt(user),
    user: { id: user.id, username: user.username, realName: user.realName, role: user.role },
  }, '注册成功');
};

// 第三方平台登录：iOS=apple(已实现) / 鸿蒙=huawei / 安卓=wechat（后两者待接平台SDK）
// 身份不存在则自动注册新用户并绑定
const oauthSchema = z.object({
  provider: z.enum(['apple', 'huawei', 'wechat']),
  identityToken: z.string().min(10).optional(), // apple 用
  fullName: z.string().nullish(),
});

exports.oauthLogin = async (req, res) => {
  const data = oauthSchema.parse(req.body);

  let openId, email;
  if (data.provider === 'apple') {
    if (!data.identityToken) throw httpError(400, '缺少 identityToken');
    ({ sub: openId, email } = await verifyAppleToken(data.identityToken));
  } else {
    // 华为/微信：需要各自开放平台的 appId/secret 才能校验，接入前明确拒绝而不是糊假的
    throw httpError(501, `${data.provider === 'huawei' ? '华为' : '微信'}登录待接入（需先在对应开放平台注册应用）`);
  }

  // 已绑定 → 直接登录
  let identity = await prisma.authIdentity.findUnique({
    where: { provider_openId: { provider: data.provider, openId } },
    include: { user: true },
  });

  let user;
  if (identity) {
    user = identity.user;
  } else {
    // 首次登录 → 自动注册 + 绑定（注册闸同样拦住第三方登录的自动建号）
    if (registrationClosed()) return fail(res, 403, '注册暂未开放，敬请期待');
    const displayName = data.fullName?.trim() || (data.provider === 'apple' ? 'Apple 用户' : '新用户');
    // 首登 = 建店（与用户名注册同语义），同样原子建店+建号+播预设
    const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10); // 随机密码（第三方账号不走密码）
    user = await prisma.$transaction(async (tx) => {
      const store = await tx.store.create({ data: { name: displayName } });
      return runWithTenant(store.id, async () => {
        const u = await tx.user.create({
          data: {
            username: `${data.provider}_${openId.slice(0, 16)}`,
            passwordHash: randomHash,
            realName: displayName,
            role: 'admin',
            identities: {
              create: { provider: data.provider, openId, email: email ?? null, displayName },
            },
          },
        });
        // 同上：不预填品类
        return u;
      });
    });
  }

  if (user.status !== 1) return fail(res, 403, '账号已被停用');
  return ok(res, {
    token: issueJwt(user),
    user: { id: user.id, username: user.username, realName: user.realName, role: user.role },
    isNewUser: !identity,
  });
};

exports.profile = async (req, res) => {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, username: true, realName: true, phone: true, role: true },
    }),
    prisma.setting.findMany({ where: { key: { in: ['shopName', 'mainTypeId'] } } }),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  // 店名：店铺设置优先，没设过用本人姓名兜底（老账号平滑过渡）
  // 主营品类：全App默认筛选它（没设过则 null，App 端在只有一个品类时自动当主营）
  return ok(res, {
    ...user,
    shopName: map.shopName ?? user.realName,
    mainTypeId: map.mainTypeId ? Number(map.mainTypeId) : null,
  });
};

// 全量数据导出（诚实承诺：数据永远是用户的，随时全量带走）
exports.exportAll = async (req, res) => {
  const [types, products, skus, inventories, customers, suppliers, orders, purchaseOrders, incomes, expenses, payments, invRecords] =
    await Promise.all([
      prisma.productType.findMany({ include: { fields: true } }),
      prisma.product.findMany(),
      prisma.sku.findMany(),
      prisma.inventory.findMany(),
      prisma.customer.findMany(),
      prisma.supplier.findMany(),
      prisma.order.findMany({ include: { items: true } }),
      prisma.purchaseOrder.findMany({ include: { items: true } }),
      prisma.income.findMany(),
      prisma.expense.findMany(),
      prisma.paymentRecord.findMany(),
      prisma.inventoryRecord.findMany(),
    ]);
  return ok(res, {
    exportedAt: new Date().toISOString(),
    version: 'stockmate-export-v1',
    数据: {
      品类: types, 商品: products, 规格: skus, 库存: inventories,
      客户: customers, 供应商: suppliers, 销售单: orders, 进货单: purchaseOrders,
      收入: incomes, 支出: expenses, 收付款流水: payments, 出入库流水: invRecords,
    },
  });
};

// 修改资料（店名/称呼、手机号）
exports.updateProfile = async (req, res) => {
  const data = z.object({ realName: z.string().trim().min(1).max(30).optional(), phone: z.string().max(20).nullish() }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user.userId },
    data,
    select: { id: true, username: true, realName: true, phone: true, role: true },
  });
  return ok(res, user, '已保存');
};

const pwdSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6, '新密码至少 6 位'),
});

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = pwdSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  const match = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!match) return fail(res, 400, '原密码错误');
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  return ok(res, null, '密码已修改');
};

// ===== 删除账号（App Store 5.1.1(v) 硬要求：有注册就必须能在 app 内删号）=====
// 语义：
// - 店里还有其他活跃用户 → 只删"我"：个人数据匿名化 + 第三方登录身份硬删；
//   经营单据（订单/流水）属于店铺经营记录，保留但不再关联到可识别个人
// - 我是最后一个活跃用户 → 等于注销整店：全部业务数据一并删除，不可恢复
exports.deleteAccount = async (req, res) => {
  const userId = req.user.userId;
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me || me.status !== 1) throw httpError(404, '账号不存在或已注销');
  const otherActive = await prisma.user.count({ where: { status: 1, id: { not: userId } } });

  if (otherActive === 0) {
    // 注销整店：按外键依赖倒序清空（SQLite 外键约束下先子后父）
    await prisma.$transaction([
      prisma.recipe.deleteMany({}),
      prisma.stocktakeItem.deleteMany({}),
      prisma.orderItem.deleteMany({}),
      prisma.paymentRecord.deleteMany({}),
      prisma.purchaseOrderItem.deleteMany({}),
      prisma.inventoryRecord.deleteMany({}),
      prisma.inventory.deleteMany({}),
      prisma.pricingRule.deleteMany({}),
      prisma.stocktake.deleteMany({}),
      prisma.order.deleteMany({}),
      prisma.purchaseOrder.deleteMany({}),
      prisma.sku.deleteMany({}),
      prisma.product.deleteMany({}),
      prisma.fieldDefinition.deleteMany({}),
      prisma.productType.deleteMany({}),
      prisma.customer.deleteMany({}),
      prisma.supplier.deleteMany({}),
      prisma.income.deleteMany({}),
      prisma.expense.deleteMany({}),
      prisma.setting.deleteMany({}),
      // AuthIdentity 无 storeId，必须显式按店过滤——deleteMany({}) 会误删所有店的第三方身份
      prisma.authIdentity.deleteMany({ where: { user: { storeId: req.user.storeId } } }),
      prisma.user.deleteMany({}),
      prisma.store.delete({ where: { id: req.user.storeId } }), // 店本体一并注销
    ]);
    return ok(res, { deleted: true, shopWiped: true }, '账号及全部数据已删除');
  }

  // 只删我：匿名化（用户名/姓名/手机/密码全部不可识别不可登录）+ 硬删 Apple 等第三方身份
  await prisma.$transaction([
    prisma.authIdentity.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        username: `deleted_${userId}_${Date.now()}`,
        realName: '已注销用户',
        phone: null,
        passwordHash: crypto.randomBytes(32).toString('hex'), // 非 bcrypt 格式，永远无法匹配登录
        status: 0,
      },
    }),
  ]);
  return ok(res, { deleted: true, shopWiped: false }, '账号已删除');
};
