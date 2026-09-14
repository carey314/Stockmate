// Apple JWKS is synthetic; signatures, claim validation, HTTP and SQLite are real.
process.env.JWT_SECRET = 'web-bridge-test-only-secret';
process.env.APPLE_BUNDLE_ID = 'com.carey.stockmate';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'bridge-test-key', alg: 'RS256', use: 'sig' };
const realFetch = global.fetch;
global.fetch = async (url, options) => String(url) === 'https://appleid.apple.com/auth/keys'
  ? { ok: true, json: async () => ({ keys: [jwk] }) }
  : realFetch(url, options);
after(() => { global.fetch = realFetch; });
const { verifyAppleToken } = require('../src/utils/appleAuth');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function appleToken(nonce, overrides = {}, options = {}) {
  const claims = { sub: 'apple-owner', nonce, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600, iss: 'https://appleid.apple.com',
    aud: process.env.APPLE_BUNDLE_ID, ...overrides };
  return jwt.sign(Object.fromEntries(Object.entries(claims).filter(([, v]) => v !== undefined)), privateKey,
  { algorithm: 'RS256', keyid: jwk.kid, ...options });
}

test('new Apple bridge requires nonce, fresh iat and nonempty sub; legacy oauth remains compatible', async () => {
  const strict = { nonceHash: sha256('server-nonce'), maxAgeSeconds: 300 };
  await assert.rejects(verifyAppleToken(appleToken('different'), strict), { status: 401 });
  for (const claims of [
    { nonce: undefined }, { sub: '' }, { sub: undefined },
    { iat: Math.floor(Date.now() / 1000) - 301 },
    { iat: Math.floor(Date.now() / 1000) + 60 }, { exp: undefined },
    { aud: 'other-app' }, { iss: 'https://attacker.example' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
  ]) await assert.rejects(verifyAppleToken(appleToken('server-nonce', claims), strict), { status: 401 });
  await assert.rejects(verifyAppleToken(appleToken('server-nonce', {}, { noTimestamp: true }), strict), { status: 401 });
  const result = await verifyAppleToken(appleToken('server-nonce'), strict);
  assert.equal(result.sub, 'apple-owner');
  assert.equal((await verifyAppleToken(appleToken(undefined))).sub, 'apple-owner');
});

test('Apple verification rejects forged signatures and algorithms; key transport failure is retryable', async () => {
  const strict = { nonceHash: sha256('server-nonce'), maxAgeSeconds: 300 };
  const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const claims = { sub: 'apple-owner', nonce: 'server-nonce', iss: 'https://appleid.apple.com', aud: process.env.APPLE_BUNDLE_ID };
  const forged = jwt.sign(claims, attacker.privateKey, { algorithm: 'RS256', keyid: jwk.kid, expiresIn: '5m' });
  await assert.rejects(verifyAppleToken(forged, strict), { status: 401 });
  const hmac = jwt.sign(claims, 'attacker', { algorithm: 'HS256', keyid: jwk.kid, expiresIn: '5m' });
  await assert.rejects(verifyAppleToken(hmac, strict), { status: 401 });
  const savedFetch = global.fetch;
  try {
    delete require.cache[require.resolve('../src/utils/appleAuth')];
    const isolatedVerifier = require('../src/utils/appleAuth').verifyAppleToken;
    global.fetch = async () => { throw new Error('network unavailable'); };
    await assert.rejects(isolatedVerifier(appleToken('server-nonce'), strict), { status: 502 });
    global.fetch = async () => ({ ok: true, json: async () => ({ keys: 'invalid' }) });
    await assert.rejects(isolatedVerifier(appleToken('server-nonce'), strict), { status: 502 });
  } finally { global.fetch = savedFetch; }
});

test('web bridge HTTP: fresh Apple reauthentication, same store and atomic single use', async (t) => {
  assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '../src/controllers/webBridge.js')),
    'Web bridge endpoints must be implemented');
  const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');
  const file = useIsolatedDb(`web-bridge-${process.pid}`);
  const prisma = require('../src/config/prisma');
  const db = prisma.basePrisma;
  const express = require('express');
  const { auth } = require('../src/middlewares/auth');
  const { wrap } = require('../src/utils/response');
  const controller = require('../src/controllers/webBridge');
  const app = express(); app.use(express.json());
  app.post('/challenge', auth, wrap(controller.challenge));
  app.post('/issue', auth, wrap(controller.issue));
  app.post('/redeem', wrap(controller.redeem));
  app.get('/profile', auth, wrap(require('../src/controllers/auth').profile));
  app.use(require('../src/middlewares/errorHandler'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); dropIsolatedDb(file); });
  let seq = 0;
  async function fixture(apple = true) {
    const n = ++seq;
    const store = await db.store.create({ data: { name: `Bridge store ${n}` } });
    const user = await db.user.create({ data: { storeId: store.id, username: `bridge${n}`, passwordHash: 'original-hash', realName: 'Owner', role: 'admin' } });
    const sub = `apple-sub-${n}`;
    if (apple) await db.authIdentity.create({ data: { userId: user.id, provider: 'apple', openId: sub } });
    const bearer = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { user, store, sub, bearer };
  }
  async function api(path, body = {}, bearer) {
    const response = await realFetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: path === '/profile' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(path === '/profile' ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), ...await response.json() };
  }
  async function challenge(f) {
    const r = await api('/challenge', {}, f.bearer); assert.equal(r.status, 200, r.message); return r.data;
  }
  async function issue(f) {
    const c = await challenge(f);
    const r = await api('/issue', { challengeId: c.challengeId, identityToken: appleToken(c.nonce, { sub: f.sub }) }, f.bearer);
    assert.equal(r.status, 200, r.message); return r.data;
  }

  await t.test('only signed-in Apple identities can create challenges; caller cannot supply account IDs', async () => {
    assert.equal((await api('/challenge')).status, 401);
    const passwordUser = await fixture(false);
    assert.equal((await api('/challenge', {}, passwordUser.bearer)).status, 403);
    const f = await fixture();
    assert.equal((await api('/challenge', { userId: passwordUser.user.id }, f.bearer)).status, 400);
    const c = await challenge(f);
    const row = await db.webLoginChallenge.findUnique({ where: { id: c.challengeId } });
    assert.equal(row.nonceHash, sha256(c.nonce)); assert.equal(row.userId, f.user.id); assert.equal(row.storeId, f.store.id);
    assert.ok(!JSON.stringify(row).includes(c.nonce));
    assert.ok(new Date(c.expiresAt).getTime() <= Date.now() + 300_000);
  });

  await t.test('fresh reauthentication exchanges once into original account/store without changing credentials', async () => {
    const f = await fixture();
    await db.setting.create({ data: { storeId: f.store.id, key: 'shopName', value: 'Original shop' } });
    const users = await db.user.count(), stores = await db.store.count();
    const code = await issue(f); assert.match(code.code, /^[A-Za-z0-9_-]{32}$/);
    const row = await db.webLoginCode.findUnique({ where: { codeHash: sha256(code.code) } });
    assert.equal(row.appleSub, f.sub); assert.equal(row.storeId, f.store.id);
    assert.ok(!JSON.stringify(row).includes(code.code));
    assert.ok(new Date(code.expiresAt).getTime() <= Date.now() + 120_000);
    const r = await api('/redeem', { code: code.code });
    assert.equal(r.status, 200, r.message); assert.equal(r.cacheControl, 'no-store');
    assert.equal(r.data.user.id, f.user.id);
    assert.equal(jwt.verify(r.data.token, process.env.JWT_SECRET).userId, f.user.id);
    assert.equal((await api('/profile', {}, r.data.token)).data.shopName, 'Original shop');
    assert.equal((await db.user.findUnique({ where: { id: f.user.id } })).passwordHash, 'original-hash');
    assert.equal(await db.user.count(), users); assert.equal(await db.store.count(), stores);
    assert.equal((await api('/redeem', { code: code.code })).status, 401);
  });

  await t.test('existing JWT, another Apple sub, wrong nonce and expired Apple token cannot issue a bridge', async () => {
    const a = await fixture(), b = await fixture(); const c = await challenge(a);
    assert.equal((await api('/issue', { challengeId: c.challengeId }, a.bearer)).status, 400);
    const invalid = [appleToken(c.nonce, { sub: b.sub }), appleToken('wrong', { sub: a.sub }),
      appleToken(c.nonce, { sub: a.sub, exp: Math.floor(Date.now() / 1000) - 1 }), a.bearer];
    for (const identityToken of invalid) assert.equal((await api('/issue', { challengeId: c.challengeId, identityToken }, a.bearer)).status, 401);
    assert.equal((await api('/issue', { challengeId: c.challengeId, identityToken: appleToken(c.nonce, { sub: a.sub }) }, b.bearer)).status, 401);
    assert.equal(await db.webLoginCode.count({ where: { userId: a.user.id } }), 0);
  });

  await t.test('challenge replay including concurrent requests yields exactly one code', async () => {
    const f = await fixture(); const c = await challenge(f);
    const body = { challengeId: c.challengeId, identityToken: appleToken(c.nonce, { sub: f.sub }) };
    const results = await Promise.all(Array.from({ length: 4 }, () => api('/issue', body, f.bearer)));
    assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
    assert.ok(results.every(r => [200, 401].includes(r.status)), JSON.stringify(results));
    assert.equal(await db.webLoginCode.count({ where: { userId: f.user.id } }), 1);
    assert.equal((await api('/issue', body, f.bearer)).status, 401);
  });

  await t.test('concurrent code redemption issues one session; another account Authorization is rejected', async () => {
    const f = await fixture(), other = await fixture(); const code = await issue(f);
    assert.equal((await api('/redeem', { code: code.code, userId: other.user.id })).status, 400);
    assert.equal((await api('/redeem', { code: code.code }, other.bearer)).status, 403);
    const forged = jwt.sign({ userId: f.user.id }, 'attacker-secret');
    assert.equal((await api('/redeem', { code: code.code }, forged)).status, 401);
    const results = await Promise.all(Array.from({ length: 4 }, () => api('/redeem', { code: code.code })));
    assert.equal(results.filter(r => r.status === 200).length, 1, JSON.stringify(results));
    assert.ok(results.every(r => [200, 401].includes(r.status)), JSON.stringify(results));
  });

  await t.test('expired challenges and codes are rejected', async () => {
    const f = await fixture(); const c = await challenge(f);
    await db.webLoginChallenge.update({ where: { id: c.challengeId }, data: { expiresAt: new Date(0) } });
    assert.equal((await api('/issue', { challengeId: c.challengeId, identityToken: appleToken(c.nonce, { sub: f.sub }) }, f.bearer)).status, 401);
    const code = await issue(f);
    await db.webLoginCode.update({ where: { codeHash: sha256(code.code) }, data: { expiresAt: new Date(0) } });
    assert.equal((await api('/redeem', { code: code.code })).status, 401);
  });

  await t.test('challenge cannot follow a user to another store', async () => {
    const f = await fixture(), other = await fixture(); const c = await challenge(f);
    await db.user.update({ where: { id: f.user.id }, data: { storeId: other.store.id } });
    assert.equal((await api('/issue', { challengeId: c.challengeId, identityToken: appleToken(c.nonce, { sub: f.sub }) }, f.bearer)).status, 401);
  });

  await t.test('redemption rechecks store, account status and Apple identity binding', async () => {
    for (const mutation of ['store', 'disabled', 'identity', 'deleted', 'missing-store']) {
      const f = await fixture(), other = await fixture(); const code = await issue(f);
      if (mutation === 'store') await db.user.update({ where: { id: f.user.id }, data: { storeId: other.store.id } });
      if (mutation === 'disabled') await db.user.update({ where: { id: f.user.id }, data: { status: 0 } });
      if (mutation === 'identity') await db.authIdentity.updateMany({ where: { userId: f.user.id }, data: { userId: other.user.id } });
      if (mutation === 'deleted') {
        await db.authIdentity.deleteMany({ where: { userId: f.user.id } });
        await db.user.delete({ where: { id: f.user.id } });
      }
      if (mutation === 'missing-store') await db.store.delete({ where: { id: f.store.id } });
      assert.equal((await api('/redeem', { code: code.code })).status, 401, mutation);
    }
  });
  await t.test('generation revocation rejects old challenge/code even if cleanup was interrupted', async () => {
    const f = await fixture(); const c = await challenge(f); const code = await issue(f);
    await db.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
    const fresh = jwt.sign({ userId: f.user.id, sessionVersion: 1 }, process.env.JWT_SECRET);
    assert.equal((await api('/issue', { challengeId: c.challengeId, identityToken: appleToken(c.nonce, { sub: f.sub }) }, fresh)).status, 401);
    assert.equal((await api('/redeem', { code: code.code })).status, 401);
    const newCode = await issue({ ...f, bearer: fresh });
    assert.equal((await api('/redeem', { code: newCode.code }, f.bearer)).status, 401);
    const redeemed = await api('/redeem', { code: newCode.code });
    assert.equal(redeemed.status, 200);
    assert.equal(jwt.verify(redeemed.data.token, process.env.JWT_SECRET).sessionVersion, 1);
  });

});
