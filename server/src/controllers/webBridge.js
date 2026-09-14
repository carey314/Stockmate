// Native Apple reauthentication -> short-lived bearer code -> the same Web account.
// These auth tables are outside tenant middleware; every account/store check is explicit.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { issueJwt, sessionMatches } = require('../services/session');
const { z } = require('zod');
const { basePrisma: db } = require('../config/prisma');
const { verifyAppleToken } = require('../utils/appleAuth');
const { httpError } = require('../utils/biz');
const { ok } = require('../utils/response');

const CHALLENGE_MS = 300_000;
const CODE_MS = 120_000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const unavailable = () => httpError(401, '网页登录验证已失效，请在 App 中重新验证');
const challengeSchema = z.object({}).strict();
const issueSchema = z.object({
  challengeId: z.string().uuid(),
  identityToken: z.string().min(10).max(16_384),
}).strict();
const redeemSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{32}$/) }).strict();

async function checkedUser(tx, userId, storeId, appleSub, sessionVersion) {
  const [user, store, identity] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }),
    tx.store.findUnique({ where: { id: storeId } }),
    tx.authIdentity.findUnique({ where: { provider_openId: { provider: 'apple', openId: appleSub } } }),
  ]);
  if (!user || user.status !== 1 || user.storeId !== storeId || user.sessionVersion !== sessionVersion || !store || identity?.userId !== userId) {
    throw unavailable();
  }
  return user;
}

exports.challenge = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  challengeSchema.parse(req.body);
  const identity = await db.authIdentity.findFirst({ where: { userId: req.user.userId, provider: 'apple' } });
  if (!identity) throw httpError(403, '此账号未绑定 Apple，请使用用户名和密码登录网页');
  await checkedUser(db, req.user.userId, req.user.storeId, identity.openId, req.user.sessionVersion);
  const cutoff = new Date();
  await db.webLoginChallenge.deleteMany({ where: { userId: req.user.userId, storeId: req.user.storeId, expiresAt: { lt: cutoff } } });
  await db.webLoginCode.deleteMany({ where: { userId: req.user.userId, storeId: req.user.storeId, expiresAt: { lt: cutoff } } });
  const nonce = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CHALLENGE_MS);
  const challenge = await db.webLoginChallenge.create({ data: {
    userId: req.user.userId, storeId: req.user.storeId, sessionVersion: req.user.sessionVersion, nonceHash: hash(nonce), expiresAt,
  } });
  return ok(res, { challengeId: challenge.id, nonce, expiresAt });
};

exports.issue = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { challengeId, identityToken } = issueSchema.parse(req.body);
  const challenge = await db.webLoginChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.userId !== req.user.userId || challenge.storeId !== req.user.storeId
      || challenge.sessionVersion !== req.user.sessionVersion || challenge.usedAt || challenge.expiresAt <= new Date()) throw unavailable();

  // Never substitute an app JWT for a freshly nonce-bound Apple identity token.
  const { sub } = await verifyAppleToken(identityToken, { nonceHash: challenge.nonceHash, maxAgeSeconds: 300 });
  const code = crypto.randomBytes(24).toString('base64url');
  const result = await db.$transaction(async tx => {
    // A conditional write is the first transaction statement. It serializes competing
    // issuers in SQLite as well as preventing replay across processes or restarts.
    const now = new Date();
    const claim = await tx.webLoginChallenge.updateMany({ where: {
      id: challenge.id, userId: req.user.userId, storeId: req.user.storeId,
      usedAt: null, expiresAt: { gt: now },
    }, data: { usedAt: now } });
    if (claim.count !== 1) throw unavailable();
    await checkedUser(tx, challenge.userId, challenge.storeId, sub, challenge.sessionVersion);
    const expiresAt = new Date(Date.now() + CODE_MS);
    await tx.webLoginCode.create({ data: {
      userId: challenge.userId, storeId: challenge.storeId, sessionVersion: challenge.sessionVersion, appleSub: sub,
      codeHash: hash(code), expiresAt,
    } });
    return { code, expiresAt };
  });
  return ok(res, result);
};

exports.redeem = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { code } = redeemSchema.parse(req.body);
  const row = await db.webLoginCode.findUnique({ where: { codeHash: hash(code) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) throw unavailable();

  // Anonymous browsers are the normal case. An existing different Web session must
  // explicitly log out first; never silently replace a different user's account.
  if (req.headers.authorization) {
    const header = req.headers.authorization;
    let session;
    try {
      if (!header.startsWith('Bearer ')) throw new Error('Invalid authorization');
      session = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (!Number.isInteger(session.userId)) throw new Error('Invalid account');
    } catch { throw httpError(401, '当前网页登录已失效，请先退出后再输入登录码'); }
    const current = await db.user.findUnique({ where: { id: session.userId } });
    if (!current || current.status !== 1 || !sessionMatches(session, current)) throw httpError(401, '当前网页登录已失效，请先退出后再输入登录码');
    if (session.userId !== row.userId) throw httpError(403, '请先退出当前网页账号，再输入自己的登录码');
  }

  const result = await db.$transaction(async tx => {
    const now = new Date();
    const claim = await tx.webLoginCode.updateMany({ where: {
      id: row.id, codeHash: hash(code), usedAt: null, expiresAt: { gt: now },
    }, data: { usedAt: now } });
    if (claim.count !== 1) throw unavailable();
    const user = await checkedUser(tx, row.userId, row.storeId, row.appleSub, row.sessionVersion);
    return {
      token: issueJwt(user),
      user: { id: user.id, username: user.username, realName: user.realName, role: user.role },
    };
  });
  return ok(res, result);
};
