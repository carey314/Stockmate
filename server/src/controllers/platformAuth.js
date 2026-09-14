const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { basePrisma } = require('../config/prisma');
const { ok, fail } = require('../utils/response');
const { platformSecret, publicAdmin, ISSUER, AUDIENCE, TTL_SECONDS } = require('../middlewares/platformAuth');

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
}).strict();
// A nonexistent or disabled account still performs password hashing work.
const dummyHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
const invalidCredentials = res => fail(res, 401, '平台账号或密码错误');

function createController({ db = basePrisma, env = process.env } = {}) {
  return {
    login: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const key = platformSecret(env);
      if (!key) return fail(res, 503, '平台登录暂未配置');
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, '平台登录参数无效');
      const { username, password } = parsed.data;
      try {
        const admin = await db.platformAdmin.findUnique({ where: { username } });
        const match = await bcrypt.compare(password, admin?.passwordHash || dummyHash);
        if (!admin || admin.status !== 1 || !match) return invalidCredentials(res);
        // Bind the successful password check to the version/hash actually checked.
        // A simultaneous CLI reset cannot issue a fresh-generation session from an old password.
        const accepted = await db.$transaction(async tx => {
          const claim = await tx.platformAdmin.updateMany({
            where: { id: admin.id, status: 1, sessionVersion: admin.sessionVersion, passwordHash: admin.passwordHash },
            data: { sessionVersion: { increment: 0 } },
          });
          if (claim.count !== 1) return false;
          await tx.platformAudit.create({ data: { adminId: admin.id, action: 'platform.auth.login', targetId: String(admin.id) } });
          return true;
        });
        if (!accepted) return invalidCredentials(res);
        const token = jwt.sign({ sessionVersion: admin.sessionVersion }, key, {
          algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE,
          subject: String(admin.id), expiresIn: TTL_SECONDS,
        });
        return ok(res, { token, admin: publicAdmin(admin) });
      } catch {
        return fail(res, 503, '平台登录暂不可用，请稍后重试');
      }
    },
    profile: async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!req.platformAdmin) return fail(res, 401, '平台登录已失效，请重新登录');
      return ok(res, { admin: publicAdmin(req.platformAdmin) });
    },
  };
}
module.exports = { ...createController(), createController };
