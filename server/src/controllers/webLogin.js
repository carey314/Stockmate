const crypto = require('node:crypto');
const { z } = require('zod');
const { basePrisma: db } = require('../config/prisma');
const { issueJwt } = require('../services/session');
const { httpError } = require('../utils/biz');
const { ok } = require('../utils/response');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const stale = () => httpError(401, '登录授权已失效，请重新生成');
const expiry = () => new Date(Date.now() + 120000);
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const browserBody = z.object({ challengeId: z.string().uuid(), browserSecret: secret }).strict();
const scanBody = z.object({ challengeId: z.string().uuid(), scanToken: secret }).strict();
const siteLabel = () => process.env.WEB_LOGIN_SITE_LABEL || '智存电脑版 · qxju.shop';
const publicUser = u => ({ id: u.id, storeId: u.storeId, username: u.username, realName: u.realName, role: u.role });
const signedIn = u => ({ token: issueJwt(u), user: publicUser(u) });
async function atomic(work) {
  for (let n = 0; ; n++) {
    try { return await db.$transaction(work, { maxWait: 10000, timeout: 15000 }); }
    catch (e) { if (n >= 3 || !['P1008','P2028','P2034'].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 40 * 2 ** n)); }
  }
}
async function actor(tx, identity) {
  const u = await tx.user.findUnique({ where: { id: identity.userId } });
  if (!u || u.status !== 1 || u.storeId !== identity.storeId || u.sessionVersion !== identity.sessionVersion) throw stale();
  const store = await tx.store.findUnique({ where: { id: u.storeId } });
  if (!store) throw stale();
  return { u, store };
}
function handler(schema, fn, anonymous = false) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (anonymous && req.headers.authorization) throw httpError(403, '请先退出当前网页账号，再登录自己的店铺');
      return ok(res, await fn(schema ? schema.parse(req.body) : undefined, req));
    } catch (e) {
      if (e.status || e instanceof z.ZodError) throw e;
      throw httpError(503, '电脑版登录暂未完成，请稍后重试');
    }
  };
}
exports.capabilities = handler(null, async () => {
  await db.webAccessGrant.findFirst({ select: { id: true } });
  return { enabled: true, version: 1, qrEnabled: true, codeEnabled: true, expiresIn: 120, pollAfter: 2 };
});
exports.create = handler(z.object({}).strict(), async (_, req) => {
  await db.webAccessGrant.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const browserSecret = random(), scanToken = random();
  const ua = req.get('user-agent') || '';
  const browserLabel = /Edg\//.test(ua) ? 'Edge浏览器' : /Chrome\//.test(ua) ? 'Chrome浏览器' : /Firefox\//.test(ua) ? 'Firefox浏览器' : /Safari\//.test(ua) ? 'Safari浏览器' : '网页浏览器';
  const row = await db.webAccessGrant.create({ data: { kind: 'qr', scanHash: hash(scanToken), browserHash: hash(browserSecret), browserLabel, expiresAt: expiry() } });
  return { challengeId: row.id, browserSecret, qrContent: `stockmate://web-login?v=1&id=${row.id}&scan=${scanToken}`, expiresAt: row.expiresAt, siteLabel: siteLabel(), browserLabel };
}, true);
async function browserRow(body, tx = db) {
  const row = await tx.webAccessGrant.findUnique({ where: { id: body.challengeId } });
  if (!row || row.kind !== 'qr' || row.browserHash !== hash(body.browserSecret)) throw stale();
  return row;
}
exports.status = handler(browserBody, async body => {
  const row = await browserRow(body);
  if (row.expiresAt <= new Date()) return { state: 'expired', expiresAt: row.expiresAt };
  if (row.userId && row.state !== 'cancelled') await actor(db, row);
  return { state: row.state, expiresAt: row.expiresAt };
}, true);
exports.cancel = handler(browserBody, async body => atomic(async tx => {
  await tx.webAccessGrant.updateMany({ where: { id: body.challengeId, browserHash: hash(body.browserSecret), kind: 'qr' }, data: { browserHash: hash(body.browserSecret) } });
  const row = await browserRow(body, tx);
  if (row.expiresAt <= new Date()) throw stale();
  if (row.state === 'redeemed') throw httpError(409, '登录已完成，请在网页退出账号');
  await tx.webAccessGrant.update({ where: { id: row.id }, data: { state: 'cancelled' } });
  return { state: 'cancelled' };
}), true);
async function scanLock(tx, body, session, allowCancelled = false) {
  const locked = await tx.webAccessGrant.updateMany({ where: { id: body.challengeId, scanHash: hash(body.scanToken), kind: 'qr', expiresAt: { gt: new Date() }, state: { in: allowCancelled ? ['pending','scanned','approved','redeemed','cancelled'] : ['pending','scanned','approved','redeemed'] } }, data: { scanHash: hash(body.scanToken) } });
  if (locked.count !== 1) throw stale();
  const row = await tx.webAccessGrant.findUnique({ where: { id: body.challengeId } });
  if (row.userId && (row.userId !== session.userId || row.storeId !== session.storeId || row.sessionVersion !== session.sessionVersion)) throw httpError(403, '此二维码已由其他账号扫描，请在电脑重新生成');
  return { row, ...await actor(tx, session) };
}
exports.scan = handler(scanBody, async (body, req) => atomic(async tx => {
  const { row, u, store } = await scanLock(tx, body, req.user);
  if (row.state === 'pending') await tx.webAccessGrant.update({ where: { id: row.id }, data: { state: 'scanned', userId: u.id, storeId: u.storeId, sessionVersion: u.sessionVersion } });
  const setting = await tx.setting.findFirst({ where: { storeId: u.storeId, key: 'shopName' } });
  return { challengeId: row.id, state: row.state === 'pending' ? 'scanned' : row.state, expiresAt: row.expiresAt, user: publicUser(u), shopName: setting?.value || store.name, browserLabel: row.browserLabel, siteLabel: siteLabel() };
}));
exports.confirm = handler(scanBody.extend({ approve: z.boolean() }), async (body, req) => atomic(async tx => {
  const { row } = await scanLock(tx, body, req.user, !body.approve);
  if (row.state === 'cancelled') {
    if (!row.userId) throw stale();
    return { state: 'cancelled' };
  }
  if (row.state === 'pending') throw httpError(409, '请先扫描并核对登录信息');
  if (row.state === 'redeemed') {
    if (!body.approve) throw httpError(409, '登录已完成，请在网页退出账号');
    return { state: 'redeemed' };
  }
  const state = body.approve ? 'approved' : 'cancelled';
  await tx.webAccessGrant.update({ where: { id: row.id }, data: { state } });
  return { state };
}));
exports.redeem = handler(browserBody, async body => atomic(async tx => {
  const locked = await tx.webAccessGrant.updateMany({ where: { id: body.challengeId, kind: 'qr', browserHash: hash(body.browserSecret), expiresAt: { gt: new Date() } }, data: { browserHash: hash(body.browserSecret) } });
  if (locked.count !== 1) throw stale();
  const row = await browserRow(body, tx);
  if (row.state === 'cancelled') throw stale();
  if (!['approved','redeemed'].includes(row.state)) throw httpError(409, '请先在App确认登录');
  const { u } = await actor(tx, row);
  await tx.webAccessGrant.update({ where: { id: row.id }, data: { state: 'redeemed' } });
  return signedIn(u);
}), true);
exports.issueCode = handler(z.object({ consent: z.literal(true) }).strict(), async (_, req) => atomic(async tx => {
  const lock = await tx.user.updateMany({ where: { id: req.user.userId, storeId: req.user.storeId, sessionVersion: req.user.sessionVersion, status: 1 }, data: { sessionVersion: { increment: 0 } } });
  if (lock.count !== 1) throw stale();
  const { u } = await actor(tx, req.user); const code = random(24);
  const row = await tx.webAccessGrant.create({ data: { kind: 'code', state: 'approved', codeHash: hash(code), userId: u.id, storeId: u.storeId, sessionVersion: u.sessionVersion, browserLabel: 'App登录码', expiresAt: expiry() } });
  return { code, expiresAt: row.expiresAt };
}));
exports.redeemCode = handler(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{32}$/), browserSecret: secret }).strict(), async body => atomic(async tx => {
  const browserHash = hash(body.browserSecret), codeHash = hash(body.code);
  const lock = await tx.webAccessGrant.updateMany({ where: { codeHash, kind: 'code', state: { in: ['approved','redeemed'] }, expiresAt: { gt: new Date() }, OR: [{ browserHash: null }, { browserHash }] }, data: { browserHash } });
  if (lock.count !== 1) throw stale();
  const row = await tx.webAccessGrant.findUnique({ where: { codeHash } });
  const { u } = await actor(tx, row);
  await tx.webAccessGrant.update({ where: { id: row.id }, data: { state: 'redeemed' } });
  return signedIn(u);
}), true);
