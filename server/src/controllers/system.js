const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { getTenantId, basePrisma } = require('../config/prisma');
const { ok, created, fail } = require('../utils/response');
const { httpError } = require('../utils/biz');

// ===== 员工管理（仅老板 admin）=====

exports.listUsers = async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, realName: true, phone: true, role: true, status: true, createdAt: true },
    orderBy: { id: 'asc' },
  });
  return ok(res, users);
};

const staffSchema = z.object({
  username: z.string().trim().min(3, '用户名至少3位').max(20).regex(/^[a-zA-Z0-9_一-龥]+$/, '用户名只能是中英文、数字、下划线'),
  password: z.string().min(6, '密码至少6位'),
  realName: z.string().trim().min(1, '姓名必填').max(30),
  phone: z.string().max(20).nullish(),
});

exports.createStaff = async (req, res) => {
  const data = staffSchema.parse(req.body);
  const exists = await basePrisma.user.findFirst({ where: { username: data.username }, select: { id: true } }); // 用户名全局唯一，占用检查查全局
  if (exists) return fail(res, 409, `用户名「${data.username}」已被占用`);
  const user = await prisma.user.create({
    data: {
      username: data.username,
      passwordHash: await bcrypt.hash(data.password, 10),
      realName: data.realName,
      phone: data.phone ?? null,
      role: 'staff',
    },
    select: { id: true, username: true, realName: true, role: true, status: true },
  });
  return created(res, user, '员工已创建');
};

// 启用/停用
exports.toggleUser = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.userId) return fail(res, 400, '不能停用自己');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw httpError(404, '用户不存在');
  const updated = await prisma.user.update({
    where: { id },
    data: { status: user.status === 1 ? 0 : 1 },
    select: { id: true, username: true, realName: true, status: true },
  });
  return ok(res, updated, updated.status === 1 ? '已启用' : '已停用');
};

// 重置密码
exports.resetPassword = async (req, res) => {
  const id = Number(req.params.id);
  const { password } = z.object({ password: z.string().min(6, '密码至少6位') }).parse(req.body);
  const owned = await prisma.user.findFirst({ where: { id } }); // 本店归属校验（跨店改密=账号接管，高危）
  if (!owned) throw httpError(404, '用户不存在');
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  return ok(res, null, '密码已重置');
};

// ===== 店铺设置 =====

exports.getShopName = async (req, res) => {
  const s = await prisma.setting.findFirst({ where: { key: 'shopName' } });
  return ok(res, { shopName: s?.value ?? null });
};

exports.setShopName = async (req, res) => {
  const { shopName } = z.object({ shopName: z.string().trim().min(1).max(30) }).parse(req.body);
  await prisma.setting.upsert({ where: { storeId_key: { storeId: getTenantId(), key: 'shopName' } }, create: { key: 'shopName', value: shopName }, update: { value: shopName } });
  return ok(res, { shopName }, '店名已更新');
};

// 主营品类：绝大多数人只做一门生意，设一次之后全App默认它（商品页/开单/进货/盘点/建品）
exports.setMainType = async (req, res) => {
  const { productTypeId } = z.object({ productTypeId: z.number().int().nullable() }).parse(req.body);
  if (productTypeId !== null) {
    const type = await prisma.productType.findFirst({ where: { id: productTypeId, isDeleted: 0 } });
    if (!type) throw httpError(404, '品类不存在');
  }
  if (productTypeId === null) {
    await prisma.setting.deleteMany({ where: { key: 'mainTypeId' } });
    return ok(res, { mainTypeId: null }, '已取消主营品类');
  }
  await prisma.setting.upsert({
    where: { storeId_key: { storeId: getTenantId(), key: 'mainTypeId' } },
    create: { key: 'mainTypeId', value: String(productTypeId) },
    update: { value: String(productTypeId) },
  });
  return ok(res, { mainTypeId: productTypeId }, '已设为主营品类');
};
