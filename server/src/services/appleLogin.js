const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { basePrisma } = require('../config/prisma');
const { verifyAppleToken } = require('../utils/appleAuth');
const { issueJwt } = require('./session');
const { httpError } = require('../utils/biz');

const TTL = 300_000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stale = () => httpError(401, 'Apple验证已失效，请重新通过Apple继续');
const closed = () => httpError(403, '注册暂未开放');
const publicUser = user => ({ id: user.id, storeId: user.storeId, username: user.username, realName: user.realName, role: user.role });
const result = (user, isNewUser = false) => ({ registrationRequired: false, token: issueJwt(user), user: publicUser(user), isNewUser });

function createService({ db = basePrisma, verifyToken = verifyAppleToken } = {}) {
  const registrationEnabled = () => process.env.ALLOW_REGISTRATION !== 'false';
  const registrationToken = row => crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`stockmate:apple-registration:v1\0${row.id}\0${row.appleSub}`).digest('base64url');
  async function atomic(work) {
    for (let attempt = 0; ; attempt++) {
      try { return await db.$transaction(work, { maxWait: 10000, timeout: 15000 }); }
      catch (error) {
        if (attempt >= 3 || !['P2034', 'P1008', 'P2028'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 30 * 2 ** attempt));
      }
    }
  }
  async function identity(tx, sub) {
    return tx.authIdentity.findUnique({ where: { provider_openId: { provider: 'apple', openId: sub } }, include: { user: true } });
  }
  async function active(tx, linked) {
    if (!linked?.user) throw stale();
    if (linked.user.status !== 1) throw httpError(403, '账号已被停用');
    if (!await tx.store.findUnique({ where: { id: linked.user.storeId } })) throw stale();
    return linked.user;
  }
  async function restore(tx, row) {
    const linked = await identity(tx, row.appleSub);
    const user = await active(tx, linked);
    if (user.id !== row.userId || user.storeId !== row.storeId || user.sessionVersion !== row.sessionVersion) throw stale();
    return result(user, row.createdStore);
  }
  async function createStore(tx, { sub, name, passwordHash, email = null }) {
    const store = await tx.store.create({ data: { name } });
    const user = await tx.user.create({ data: {
      storeId: store.id, username: `apple_${crypto.randomBytes(16).toString('hex')}`,
      passwordHash, realName: name, role: 'admin',
    } });
    await tx.authIdentity.create({ data: { provider: 'apple', openId: sub, userId: user.id, email, displayName: name } });
    await require('./metricsContext').recordRegistration(tx,user,'apple');
    return user;
  }
  async function capabilities() {
    // Fail closed if code is ahead of schema. This is protocol readiness, not live Apple availability.
    try { await db.appleAuthAttempt.findFirst({ select: { id: true } }); }
    catch { throw httpError(503, 'Apple登录升级准备中，请稍后重试或使用其他登录方式'); }
    return { enabled: true, twoPhase: true, version: 1, registrationEnabled: registrationEnabled(), nonceMode: 'plain', challengeExpiresIn: 300, registrationExpiresIn: 300, legacyOauthAutoRegistration: true };
  }
  async function challenge() {
    const now = new Date();
    // Expiry gates usage immediately; physical cleanup occurs on subsequent challenge requests.
    await db.appleAuthAttempt.deleteMany({ where: { OR: [
      { expiresAt: { lte: now }, registrationExpiresAt: null },
      { expiresAt: { lte: now }, registrationExpiresAt: { lte: now } },
    ] } });
    const nonce = crypto.randomBytes(32).toString('base64url');
    const row = await db.appleAuthAttempt.create({ data: { nonceHash: hash(nonce), expiresAt: new Date(Date.now() + TTL) } });
    return { challengeId: row.id, nonce, expiresAt: row.expiresAt };
  }
  async function verify({ challengeId, identityToken }) {
    const observed = await db.appleAuthAttempt.findUnique({ where: { id: challengeId } });
    if (!observed || observed.expiresAt <= new Date()) throw stale();
    const { sub } = await verifyToken(identityToken, { nonceHash: observed.nonceHash, maxAgeSeconds: 300 });
    const tokenHash = hash(identityToken);
    return atomic(async tx => {
      // First statement is a conditional write, so concurrent processes serialize BEFORE reading identity.
      const lock = await tx.appleAuthAttempt.updateMany({ where: { id: challengeId, expiresAt: { gt: new Date() } }, data: { nonceHash: observed.nonceHash } });
      if (lock.count !== 1) throw stale();
      let row = await tx.appleAuthAttempt.findUnique({ where: { id: challengeId } });
      if (row.state !== 'pending') {
        if (row.appleSub !== sub || row.tokenHash !== tokenHash) throw stale();
        if (row.state === 'login' || row.state === 'registered') return restore(tx, row);
        if (row.state !== 'register' || row.registrationExpiresAt <= new Date()) throw stale();
        const linked = await identity(tx, sub);
        if (linked) await active(tx, linked);
        else if (!registrationEnabled()) throw closed();
        const ticket = registrationToken(row);
        if (hash(ticket) !== row.registrationHash) throw stale();
        return { registrationRequired: true, registrationToken: ticket, expiresAt: row.registrationExpiresAt };
      }
      const linked = await identity(tx, sub);
      if (linked) {
        const user = await active(tx, linked);
        await tx.appleAuthAttempt.update({ where: { id: row.id }, data: {
          state: 'login', tokenHash, appleSub: sub, userId: user.id, storeId: user.storeId, sessionVersion: user.sessionVersion,
        } });
        return result(user);
      }
      if (!registrationEnabled()) throw closed();
      row = { ...row, appleSub: sub };
      const ticket = registrationToken(row), expiresAt = new Date(Date.now() + TTL);
      await tx.appleAuthAttempt.update({ where: { id: row.id }, data: {
        state: 'register', tokenHash, appleSub: sub, registrationHash: hash(ticket), registrationExpiresAt: expiresAt,
      } });
      return { registrationRequired: true, registrationToken: ticket, expiresAt };
    });
  }
  async function register({ registrationToken: ticket, realName }) {
    const registrationHash = hash(ticket);
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    return atomic(async tx => {
      const lock = await tx.appleAuthAttempt.updateMany({ where: {
        registrationHash, registrationExpiresAt: { gt: new Date() }, state: { in: ['register', 'registered'] },
      }, data: { registrationHash } });
      if (lock.count !== 1) throw stale();
      const row = await tx.appleAuthAttempt.findUnique({ where: { registrationHash } });
      if (row.state === 'registered') {
        if (row.storeName !== realName) throw httpError(409, '此注册请求已使用其他店名提交，请恢复原请求或重新登录');
        return restore(tx, row);
      }
      const linked = await identity(tx, row.appleSub);
      let user;
      if (linked) user = await active(tx, linked);
      else {
        if (!registrationEnabled()) throw closed();
        user = await createStore(tx, { sub: row.appleSub, name: realName, passwordHash });
      }
      await tx.appleAuthAttempt.update({ where: { id: row.id }, data: {
        state: 'registered', storeName: realName, userId: user.id, storeId: user.storeId,
        sessionVersion: user.sessionVersion, createdStore: !linked,
      } });
      return result(user, !linked);
    });
  }
  async function legacyLogin({ sub, name, email }) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    return atomic(async tx => {
      // Even a zero-row write obtains SQLite's write reservation before the lookup.
      await tx.authIdentity.updateMany({ where: { provider: 'apple', openId: sub }, data: { provider: 'apple' } });
      const linked = await identity(tx, sub);
      if (linked) return result(await active(tx, linked));
      if (!registrationEnabled()) throw closed();
      return result(await createStore(tx, { sub, name, email, passwordHash }), true);
    });
  }
  return { capabilities, challenge, verify, register, legacyLogin };
}
module.exports = { createService };
