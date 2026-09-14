const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { issueJwt, clearGrants } = require('../services/session');
const { basePrisma: db } = require('../config/prisma');
const { mask } = require('../services/sms/service');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { runWithTenant } = require('../config/prisma');
const { seedPresetTypes } = require('../../prisma/presetTypes');
const { ok, fail } = require('../utils/response');
const { httpError } = require('../utils/biz');
const { verifyAppleToken } = require('../utils/appleAuth');

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
      await require('../services/metricsContext').recordRegistration(tx,u,'password');
      // 刻意不预填品类：给所有人塞"酒水/玩具/餐饮食材"，对水果店老板就是三个要删的垃圾，
      // 还传递了"这软件不懂我"。新店就是空的，首页的「三步开工」引导会带他说出自己的行业，
      // AI 现场配——这才是"30秒配成你这行"。（预设数据仍保留给 prisma/seed.js 的开发种子用）
      return u;
    });
  });
  // 注册哨兵：刷号的最早信号是"单日注册量异常放大"。不在这里阻断（阻断交给限流），
  // 只负责让人看见——pm2 logs 里一行 warn，够当天发现当天止血（ALLOW_REGISTRATION=false）
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayCount = await prisma.user.count({ where: { createdAt: { gte: dayStart } } });
    const alertAt = Number(process.env.REG_ALERT_THRESHOLD) || 50;
    if (todayCount >= alertAt) {
      console.warn(`[注册哨兵] 今日已注册 ${todayCount} 个账号（阈值 ${alertAt}）。若非推广日，怀疑脚本刷号：查日志里的 IP，必要时 .env 置 ALLOW_REGISTRATION=false 止血`);
    }
  } catch (_) { /* 哨兵挂了不影响注册本身 */ }
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

  // Legacy clients retain automatic registration. New clients MUST use /auth/apple/*.
  // Shared service serializes identity lookup/create, including different HTTP processes.
  res.set('Cache-Control', 'no-store');
  try {
    const result = await require('../services/appleLogin').createService().legacyLogin({
      sub: openId, email, name: data.fullName?.trim() || 'Apple 用户',
    });
    return ok(res, result);
  } catch (error) {
    if (error.status) throw error;
    throw httpError(503, 'Apple登录暂未完成，请稍后重试');
  }
};

exports.profile = async (req, res) => {
  const [user, settings, phoneIdentity] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, storeId: true, username: true, realName: true, phone: true, role: true },
    }),
    prisma.setting.findMany({ where: { key: { in: ['shopName', 'mainTypeId'] } } }),
    db.phoneIdentity.findUnique({ where: { userId: req.user.userId }, select: { phone: true } }),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  // 店名：店铺设置优先，没设过用本人姓名兜底（老账号平滑过渡）
  // 主营品类：全App默认筛选它（没设过则 null，App 端在只有一个品类时自动当主营）
  return ok(res, {
    ...user,
    phoneBound: !!phoneIdentity,
    phoneMasked: mask(phoneIdentity?.phone),
    shopName: map.shopName ?? user.realName,
    mainTypeId: map.mainTypeId ? Number(map.mainTypeId) : null,
  });
};

// 全量数据导出（诚实承诺：数据永远是用户的，随时全量带走）
exports.exportAll = async (req,res) => ok(res, await require('../services/exportData').exportStoreData(req.user));

// 修改资料（店名/称呼、手机号）
exports.updateProfile = async (req, res) => {
  const data = z.object({ realName: z.string().trim().min(1).max(30).optional(), phone: z.string().max(20).nullish() }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user.userId },
    data,
    select: { id: true, storeId: true, username: true, realName: true, phone: true, role: true },
  });
  return ok(res, user, '已保存');
};

const pwdSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6, '新密码至少 6 位').max(128),
});

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = pwdSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  const match = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!match) return fail(res, 400, '原密码错误');
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.$transaction(async tx => {
    const updated = await tx.user.updateMany({ where: {
      id: user.id, storeId: req.user.storeId, status: 1,
      sessionVersion: req.user.sessionVersion, passwordHash: user.passwordHash,
    }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    if (updated.count !== 1) throw httpError(401, '身份已变化，请重新登录');
    await clearGrants(tx, [user.id]);
  });
  return ok(res, { reauthenticate: true }, '密码已修改，请重新登录');
};

// ===== 删除账号（App Store 5.1.1(v) 硬要求：有注册就必须能在 app 内删号）=====
// 语义：
// - 店里还有其他活跃用户 → 只删"我"：个人数据匿名化 + 第三方登录身份硬删；
//   经营单据（订单/流水）属于店铺经营记录，保留但不再关联到可识别个人
// - 我是最后一个活跃用户 → 等于注销整店：全部业务数据一并删除，不可恢复
exports.deleteAccount = async (req, res) => {
  const { userId, storeId, sessionVersion } = req.user;
  const shopWiped = await db.$transaction(async tx => {
    // Serialize account deletion, disable and binding before deciding whether to wipe.
    const locked = await tx.user.updateMany({ where: { id: userId, storeId, status: 1, sessionVersion }, data: { sessionVersion: { increment: 1 } } });
    if (locked.count !== 1) throw httpError(401, '账号状态已变化，请重新登录');
    const otherActive = await tx.user.count({ where: { storeId, status: 1, id: { not: userId } } });
    if (otherActive === 0) {
      const users = await tx.user.findMany({ where: { storeId }, select: { id: true } });
      await clearGrants(tx, users.map(u => u.id));
      for (const model of ['entryConfirmation','tradeEvent','recipe','stocktakeItem','orderItem','paymentRecord','purchaseOrderItem','inventoryRecord','inventory','pricingRule','stocktake','order','purchaseOrder','sku','product','fieldDefinition','productType','customer','supplier','income','expense','setting']) {
        await tx[model].deleteMany({ where: { storeId } });
      }
      await tx.authIdentity.deleteMany({ where: { user: { storeId } } });
      await tx.phoneIdentity.deleteMany({ where: { user: { storeId } } });
      await tx.user.deleteMany({ where: { storeId } });
      await tx.store.delete({ where: { id: storeId } });
      return true;
    }
    await clearGrants(tx, [userId]);
    await tx.authIdentity.deleteMany({ where: { userId } });
    await tx.phoneIdentity.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: {
      username: `deleted_${userId}_${Date.now()}`, realName: '已注销用户', phone: null,
      passwordHash: crypto.randomBytes(32).toString('hex'), status: 0,
    } });
    return false;
  });
  return ok(res, { deleted: true, shopWiped }, shopWiped ? '账号及店铺主要经营数据已删除；部分记录按隐私政策保留，Apple订阅需另行取消' : '账号已注销；店铺经营记录及隐私政策所述资料保留，Apple订阅需另行取消');
};
