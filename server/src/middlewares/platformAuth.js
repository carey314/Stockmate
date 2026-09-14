const jwt = require('jsonwebtoken');
const { basePrisma } = require('../config/prisma');
const { fail } = require('../utils/response');

const ISSUER = 'stockmate-platform';
const AUDIENCE = 'platform';
const TTL_SECONDS = 2 * 60 * 60;
const platformSecret = (env = process.env) => {
  const key = env.PLATFORM_JWT_SECRET;
  return typeof key === 'string' && key.trim() && Buffer.byteLength(key, 'utf8') >= 32
    && key !== env.JWT_SECRET ? key : null;
};
const publicAdmin = admin => ({ id: admin.id, username: admin.username, displayName: admin.displayName });

// No tenant User lookup, userId claim, role escalation, or JWT_SECRET fallback.
const createPlatformAuth = ({ db = basePrisma, env = process.env } = {}) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const key = platformSecret(env);
  if (!key) return fail(res, 503, '平台登录暂未配置');
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return fail(res, 401, '平台登录已失效，请重新登录');
  let claims;
  try {
    claims = jwt.verify(header.slice(7), key, {
      algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
      maxAge: TTL_SECONDS,
    });
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims !== 'object' || claims.iss !== ISSUER || claims.aud !== AUDIENCE
      || typeof claims.sub !== 'string'
      || !/^[1-9]\d*$/.test(claims.sub) || !Number.isSafeInteger(Number(claims.sub))
      || !Number.isInteger(claims.sessionVersion) || claims.sessionVersion < 0
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || claims.iat > now + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > TTL_SECONDS
      || claims.userId !== undefined || claims.role !== undefined || claims.storeId !== undefined) {
      return fail(res, 401, '平台登录已失效，请重新登录');
    }
  } catch {
    return fail(res, 401, '平台登录已失效，请重新登录');
  }
  try {
    const admin = await db.platformAdmin.findUnique({
      where: { id: Number(claims.sub) },
      select: { id: true, username: true, displayName: true, status: true, sessionVersion: true },
    });
    if (!admin || admin.status !== 1 || admin.sessionVersion !== claims.sessionVersion) {
      return fail(res, 401, '平台登录已失效，请重新登录');
    }
    req.platformAdmin = { ...publicAdmin(admin), sessionVersion: admin.sessionVersion };
    return next();
  } catch {
    // Do not forward raw Prisma/driver errors containing security query details.
    return fail(res, 503, '平台身份验证暂不可用，请稍后重试');
  }
};

module.exports = {
  platformAuth: createPlatformAuth(), createPlatformAuth,
  platformSecret, publicAdmin, ISSUER, AUDIENCE, TTL_SECONDS,
};
