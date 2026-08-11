const jwt = require('jsonwebtoken');
const { fail } = require('../utils/response');
const prisma = require('../config/prisma');
const { runWithTenant } = require('../config/prisma');

// JWT 认证。验签后查一次用户状态：删号/禁用后旧 token 必须立刻失效
// （否则被删员工的 token 到期前还能操作——App Store 删号合规也过不去）
// 多租户：这里顺带取 storeId，把后续整条请求链包进租户上下文——
// 所有 prisma 查询由扩展层自动按店过滤（见 config/prisma.js）。
const auth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 401, '未登录');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return fail(res, 401, '登录已过期，请重新登录');
  }
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { status: true, storeId: true },
    });
    if (!u || u.status !== 1) return fail(res, 401, '账号已注销或被停用');
    req.user.storeId = u.storeId;
    runWithTenant(u.storeId, () => next());
  } catch (e) {
    next(e);
  }
};

// 仅管理员
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return fail(res, 403, '无权限（仅管理员）');
  next();
};

module.exports = { auth, adminOnly };
