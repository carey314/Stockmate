// Real HTTP, SQLite and RSA claim validation. ONLY Apple's remote JWKS is synthetic.
process.env.JWT_SECRET = 'apple-two-phase-isolated-test-secret';
process.env.APPLE_BUNDLE_ID = 'com.carey.stockmate';
process.env.RATE_AUTH_MAX = '10000';
process.env.RATE_REG_HOUR = '10000';
process.env.RATE_REG_DAY = '10000';
process.env.ALLOW_REGISTRATION = 'true';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'apple-auth-test-key', alg: 'RS256', use: 'sig' };
const realFetch = global.fetch;
global.fetch = async (url, options) => {
  if (String(url) === 'https://appleid.apple.com/auth/keys') return { ok: true, json: async () => ({ keys: [jwk] }) };
  assert.match(String(url), /^http:\/\/127\.0\.0\.1:/, 'External requests forbidden in this test');
  return realFetch(url, options);
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function token(nonce, sub, claims = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { nonce, sub, iss: 'https://appleid.apple.com', aud: process.env.APPLE_BUNDLE_ID, iat: now, exp: now + 600, ...claims };
  return jwt.sign(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)), key, { algorithm: 'RS256', keyid: jwk.kid });
}

test('Apple two-phase HTTP contract: verify without account creation and explicit atomic registration', async t => {
  const file = useIsolatedDb(`apple-auth-${process.pid}`);
  const prisma = require('../src/config/prisma');
  const db = prisma.basePrisma;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1', require('../src/routes'));
  app.use((_req, res) => res.status(404).json({ code: 404 }));
  app.use(require('../src/middlewares/errorHandler'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { global.fetch = realFetch; await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); dropIsolatedDb(file); });
  const api = async (route, body, bearer, method = body === undefined ? 'GET' : 'POST') => {
    const response = await realFetch(`http://127.0.0.1:${server.address().port}/api/v1${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  const capabilities = await api('/auth/apple/capabilities');
  assert.equal(capabilities.status, 200, 'Two-phase routes must exist; never fall back to automatic oauth registration');
  assert.equal(capabilities.data.twoPhase, true);
  assert.equal(capabilities.data.nonceMode, 'plain');
  assert.equal(capabilities.data.version, 1);
  assert.equal(capabilities.cache, 'no-store');
  const counts = async () => [await db.store.count(), await db.user.count(), await db.authIdentity.count()];
  const challenge = async () => {
    const r = await api('/auth/apple/challenge', {});
    assert.equal(r.status, 200); assert.match(r.data.nonce, /^[\w-]{43}$/);
    return r.data;
  };
  const verify = (c, sub, claims = {}) => api('/auth/apple/verify', { challengeId: c.challengeId, identityToken: token(c.nonce, sub, claims) });
  const registration = async sub => {
    const c = await challenge(); const r = await verify(c, sub);
    assert.equal(r.status, 200); assert.equal(r.data.registrationRequired, true);
    return { c, ...r.data };
  };
  const register = (r, name = 'Explicit Apple shop', extra = {}) => api('/auth/apple/register', { registrationToken: r.registrationToken, createStore: true, consent: true, realName: name, ...extra });

  await t.test('new verified identity returns stable short ticket, never a User/Store/login token', async () => {
    const before = await counts(); const c = await challenge();
    const row = await db.appleAuthAttempt.findUnique({ where: { id: c.challengeId } });
    assert.equal(row.nonceHash, hash(c.nonce)); assert.ok(!JSON.stringify(row).includes(c.nonce));
    const signed = token(c.nonce, 'new-no-account');
    const body = { challengeId: c.challengeId, identityToken: signed };
    const a = await api('/auth/apple/verify', body), b = await api('/auth/apple/verify', body);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(a.data.registrationRequired, true); assert.equal(a.data.token, undefined);
    assert.equal(a.data.registrationToken, b.data.registrationToken); assert.equal(a.data.expiresAt, b.data.expiresAt);
    assert.match(a.data.registrationToken, /^[\w-]{43}$/);
    const stored = await db.appleAuthAttempt.findUnique({ where: { id: c.challengeId } });
    assert.equal(stored.registrationHash, hash(a.data.registrationToken));
    assert.ok(!JSON.stringify(stored).includes(signed)); assert.ok(!JSON.stringify(stored).includes(a.data.registrationToken));
    assert.deepEqual(await counts(), before);
  });

  await t.test('explicit consent, store name and strict purpose/identity fields required', async () => {
    const r = await registration('strict-new'); const before = await counts();
    for (const extra of [{ createStore: false }, { consent: false }, { userId: 1 }, { storeId: 1 }, { sub: 'other' }, { identityToken: token(r.c.nonce, 'other') }, { email: 'same@example.test' }, { phone: 'not-an-auth-identity' }]) {
      assert.equal((await register(r, 'Valid name', extra)).status, 400);
    }
    for (const name of ['', '   ', 'a'.repeat(31)]) assert.equal((await register(r, name)).status, 400);
    assert.equal((await api('/auth/apple/challenge', { sub: 'other' })).status, 400);
    assert.equal((await api('/auth/profile', undefined, r.registrationToken)).status, 401);
    assert.equal((await api('/auth/sms/register', { registrationToken: r.registrationToken, realName: 'No', createStore: true, consent: true })).status, 401);
    assert.deepEqual(await counts(), before);
  });

  await t.test('signature, audience, issuer, nonce, expiry and freshness must match', async () => {
    const c = await challenge(); const before = await counts(); const now = Math.floor(Date.now() / 1000);
    for (const claims of [{ nonce: 'wrong' }, { nonce: hash(c.nonce) }, { nonce: undefined }, { sub: '' }, { aud: 'different' }, { iss: 'https://evil.test' }, { iat: now - 301 }, { iat: now + 60 }, { exp: now - 1 }, { exp: undefined }]) {
      assert.equal((await verify(c, 'invalid-claims', claims)).status, 401);
    }
    const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.equal((await api('/auth/apple/verify', { challengeId: c.challengeId, identityToken: token(c.nonce, 'forged', {}, otherKey.privateKey) })).status, 401);
    assert.deepEqual(await counts(), before);
    await db.appleAuthAttempt.update({ where: { id: c.challengeId }, data: { expiresAt: new Date(0) } });
    assert.equal((await verify(c, 'expired-challenge')).status, 401);
  });

  await t.test('successful challenge cannot be swapped to another signed Apple sub/token', async () => {
    const c = await challenge();
    assert.equal((await verify(c, 'first-sub')).status, 200);
    assert.equal((await verify(c, 'second-sub')).status, 401);
    assert.equal((await verify(c, 'first-sub', { email: 'different@example.test' })).status, 401);
  });

  let created;
  await t.test('concurrent click, lost response and canonical retry recover one account; altered payload conflicts', async () => {
    const r = await registration('new-registered'); const before = await counts();
    const replies = await Promise.all(Array.from({ length: 4 }, () => register(r, '  My new shop  ')));
    for (const reply of replies) assert.equal(reply.status, 200);
    assert.equal(new Set(replies.map(reply => reply.data.user.id)).size, 1);
    const a = replies[0]; created = { ...r, ...a.data };
    assert.equal(a.data.user.realName, 'My new shop'); assert.equal(a.data.user.role, 'admin');
    assert.ok(Number.isInteger(a.data.user.storeId)); assert.equal(a.data.isNewUser, true);
    assert.deepEqual(await counts(), before.map(n => n + 1));
    assert.equal((await register(r, 'My new shop')).data.user.id, a.data.user.id);
    assert.equal((await register(r, 'Changed shop')).status, 409);
    const profile = await api('/auth/profile', undefined, a.data.token);
    assert.equal(profile.status, 200); assert.equal(profile.data.storeId, a.data.user.storeId);
    assert.equal(profile.data.phoneBound, false);
    assert.equal(jwt.verify(a.data.token, process.env.JWT_SECRET).sessionVersion, 0);
  });

  await t.test('same Apple sub via independent challenges creates only one store', async () => {
    const a = await registration('parallel-sub'), b = await registration('parallel-sub'); const before = await counts();
    const results = await Promise.all([register(a, 'First payload'), register(b, 'Other payload')]);
    assert.ok(results.every(r => r.status === 200));
    assert.equal(results[0].data.user.id, results[1].data.user.id);
    assert.equal(results.filter(r => r.data.isNewUser).length, 1);
    assert.deepEqual(await counts(), before.map(n => n + 1));
  });

  await t.test('registration closed blocks uncommitted new account, but allows existing login and committed retry', async () => {
    const fresh = await registration('closing-new'); const before = await counts();
    process.env.ALLOW_REGISTRATION = 'false';
    try {
      assert.equal((await api('/auth/apple/capabilities')).data.registrationEnabled, false);
      assert.equal((await verify(await challenge(), 'closed-no-account')).status, 403);
      assert.equal((await register(fresh)).status, 403);
      assert.equal((await register(created, 'My new shop')).status, 200);
      assert.equal((await verify(await challenge(), 'new-registered')).data.user.id, created.user.id);
      assert.deepEqual(await counts(), before);
    } finally { process.env.ALLOW_REGISTRATION = 'true'; }
    assert.equal((await register(fresh)).status, 200);
  });

  await t.test('bound staff remains same account/store/role; disabled account blocked on verify and retry', async () => {
    await db.user.update({ where: { id: created.user.id }, data: { role: 'staff' } });
    const before = await counts();
    const c = await challenge();
    const body = { challengeId: c.challengeId, identityToken: token(c.nonce, 'new-registered') };
    const r = await api('/auth/apple/verify', body);
    assert.equal(r.data.user.role, 'staff'); assert.equal(r.data.user.storeId, created.user.storeId);
    await db.user.update({ where: { id: created.user.id }, data: { status: 0 } });
    assert.equal((await verify(await challenge(), 'new-registered')).status, 403);
    assert.equal((await register(created, 'My new shop')).status, 403);
    assert.equal((await api('/auth/apple/verify', body)).status, 403);
    assert.deepEqual(await counts(), before);
    await db.user.update({ where: { id: created.user.id }, data: { status: 1, role: 'admin' } });
  });

  await t.test('expiry requires fresh Apple login, which returns already created account', async () => {
    const r = await registration('expire-registration'); const made = await register(r); const before = await counts();
    await db.appleAuthAttempt.update({ where: { id: r.c.challengeId }, data: { registrationExpiresAt: new Date(0) } });
    assert.equal((await register(r)).status, 401);
    assert.equal((await verify(await challenge(), 'expire-registration')).data.user.id, made.data.user.id);
    assert.deepEqual(await counts(), before);
  });

  await t.test('no email/name/contact merging, including legacy unknown Apple identities', async () => {
    const a = await challenge(), b = await challenge(); const before = await counts();
    const x = await verify(a, 'same-email-one', { email: 'shared@example.test' });
    const y = await verify(b, 'same-email-two', { email: 'shared@example.test' });
    const rx = await register(x.data, 'Same name'), ry = await register(y.data, 'Same name');
    assert.notEqual(rx.data.user.id, ry.data.user.id); assert.notEqual(rx.data.user.storeId, ry.data.user.storeId);
    assert.deepEqual(await counts(), before.map(n => n + 2));
    const old = { provider: 'apple', identityToken: token(undefined, 'legacy-new'), fullName: 'Same name' };
    const replies = await Promise.all([api('/auth/oauth', old), api('/auth/oauth', old)]);
    assert.ok(replies.every(r => r.status === 200)); assert.equal(replies[0].data.user.id, replies[1].data.user.id);
    process.env.ALLOW_REGISTRATION = 'false';
    try {
      assert.equal((await api('/auth/oauth', old)).status, 200);
      assert.equal((await api('/auth/oauth', { ...old, identityToken: token(undefined, 'legacy-closed') })).status, 403);
    } finally { process.env.ALLOW_REGISTRATION = 'true'; }
  });

  await t.test('password/session revocation invalidates committed and other unbound tickets for same Apple sub', async () => {
    const a = await registration('revoked-sub'), b = await registration('revoked-sub'); const made = await register(a);
    await db.$transaction(async tx => {
      await tx.user.update({ where: { id: made.data.user.id }, data: { sessionVersion: { increment: 1 } } });
      await require('../src/services/session').clearGrants(tx, [made.data.user.id]);
    });
    assert.equal((await register(a)).status, 401); assert.equal((await register(b)).status, 401);
    assert.equal((await api('/auth/profile', undefined, made.data.token)).status, 401);
  });

  await t.test('account deletion revokes all issued Apple tickets, never recreates from old proof', async () => {
    const a = await registration('deleted-sub'), b = await registration('deleted-sub'); const made = await register(a);
    assert.equal((await api('/auth/delete-account', {}, made.data.token)).status, 200);
    const before = await counts();
    assert.equal((await register(a)).status, 401); assert.equal((await register(b)).status, 401);
    assert.deepEqual(await counts(), before);
  });

  await t.test('failed identity insert rolls back Store/User/ticket atomically, original payload can retry', async () => {
    const r = await registration('rollback-sub'); const before = await counts();
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_apple_insert BEFORE INSERT ON AuthIdentity WHEN NEW.openId = 'rollback-sub' BEGIN SELECT RAISE(ABORT, 'synthetic transaction failure'); END`);
    try {
      const failed = await register(r);
      assert.equal(failed.status, 503);
      assert.deepEqual(await counts(), before);
      assert.equal((await db.appleAuthAttempt.findUnique({ where: { id: r.c.challengeId } })).state, 'register');
    } finally { await db.$executeRawUnsafe('DROP TRIGGER fail_apple_insert'); }
    assert.equal((await register(r)).status, 200);
    assert.deepEqual(await counts(), before.map(n => n + 1));
  });

  await t.test('retrying verify detects an identity disabled after a different challenge created its account', async () => {
    const c = await challenge(); const signed = token(c.nonce, 'disabled-between-proofs');
    const body = { challengeId: c.challengeId, identityToken: signed };
    assert.equal((await api('/auth/apple/verify', body)).status, 200);
    const other = await registration('disabled-between-proofs'); const made = await register(other);
    await db.user.update({ where: { id: made.data.user.id }, data: { status: 0 } });
    assert.equal((await api('/auth/apple/verify', body)).status, 403);
  });

  await t.test('capability fails closed when the new security table is not migrated', async () => {
    await db.$executeRawUnsafe('ALTER TABLE AppleAuthAttempt RENAME TO AppleAuthAttempt_pending_migration');
    try { assert.equal((await api('/auth/apple/capabilities')).status, 503); }
    finally { await db.$executeRawUnsafe('ALTER TABLE AppleAuthAttempt_pending_migration RENAME TO AppleAuthAttempt'); }
  });

  await t.test('actual password-change and owner employee-reset HTTP revoke Apple grants and old sessions', async () => {
    const bcrypt = require('bcryptjs');
    const r = await registration('password-change-sub'); const made = await register(r);
    await db.user.update({ where: { id: made.data.user.id }, data: { passwordHash: await bcrypt.hash('Old-test-password', 10) } });
    const c = await challenge(); const body = { challengeId: c.challengeId, identityToken: token(c.nonce, 'password-change-sub') };
    assert.equal((await api('/auth/apple/verify', body)).status, 200);
    const changed = await api('/auth/password', { oldPassword: 'Old-test-password', newPassword: 'New-test-password' }, made.data.token, 'PUT');
    assert.equal(changed.status, 200); assert.equal(changed.data.reauthenticate, true);
    assert.equal((await register(r)).status, 401); assert.equal((await api('/auth/apple/verify', body)).status, 401);
    assert.equal((await api('/auth/profile', undefined, made.data.token)).status, 401);
    const ownerLogin = await verify(await challenge(), 'password-change-sub');
    const staff = await db.user.create({ data: { username: 'reset-apple-staff', realName: 'Employee', role: 'staff', passwordHash: 'synthetic-old-hash', storeId: made.data.user.storeId } });
    await db.authIdentity.create({ data: { userId: staff.id, provider: 'apple', openId: 'staff-reset-sub' } });
    const sc = await challenge(); const staffBody = { challengeId: sc.challengeId, identityToken: token(sc.nonce, 'staff-reset-sub') };
    const staffLogin = await api('/auth/apple/verify', staffBody);
    assert.equal((await api(`/system/users/${staff.id}/password`, { password: 'Reset-test-password' }, ownerLogin.data.token, 'PUT')).status, 200);
    assert.equal((await api('/auth/apple/verify', staffBody)).status, 401);
    assert.equal((await api('/auth/profile', undefined, staffLogin.data.token)).status, 401);
  });
});
