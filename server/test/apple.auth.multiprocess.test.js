const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');

test('Apple registration/verification survives two HTTP processes, committed response loss and restart', async t => {
  const file = useIsolatedDb(`apple-auth-multi-${process.pid}`);
  const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'multi-apple-key', alg: 'RS256', use: 'sig' };
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: 'apple-multi-test-secret', APPLE_BUNDLE_ID: 'com.carey.stockmate', APPLE_TEST_JWK: JSON.stringify(jwk),
    ALLOW_REGISTRATION: 'true', RATE_AUTH_MAX: '1000', RATE_REG_HOUR: '1000', RATE_REG_DAY: '1000' };
  const workers = [];
  const start = async () => {
    const child = fork(path.join(__dirname, 'helpers/apple-auth-worker.cjs'), [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    workers.push(child);
    const port = await new Promise((resolve, reject) => {
      child.on('message', message => { if (message.event === 'ready') resolve(message.port); });
      child.on('error', reject); child.on('exit', code => { if (code) reject(Error('Isolated worker failed')); });
    });
    return { child, port };
  };
  const stop = child => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve); child.send('stop');
  });
  t.after(async () => { await Promise.all(workers.map(stop)); await db.$disconnect(); dropIsolatedDb(file); });
  const a = await start(), b = await start();
  const api = async (worker, endpoint, body) => {
    const response = await fetch(`http://127.0.0.1:${worker.port}/api/v1/auth/apple/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  const proof = async (sub, worker = a) => {
    const c = (await api(worker, 'challenge', {})).data;
    return { challengeId: c.challengeId, identityToken: jwt.sign({ nonce: c.nonce, sub, iss: 'https://appleid.apple.com', aud: env.APPLE_BUNDLE_ID }, privateKey, { algorithm: 'RS256', keyid: jwk.kid, expiresIn: '5m' }) };
  };
  const payload = (ticket, name = 'Multiprocess shop') => ({ registrationToken: ticket, createStore: true, consent: true, realName: name });
  const p = await proof('same-ticket-sub');
  const verified = await Promise.all([api(a, 'verify', p), api(b, 'verify', p)]);
  assert.ok(verified.every(r => r.status === 200));
  assert.equal(verified[0].data.registrationToken, verified[1].data.registrationToken);
  assert.equal(await db.store.count(), 0); assert.equal(await db.user.count(), 0);
  const body = payload(verified[0].data.registrationToken);
  const created = await Promise.all([api(a, 'register', body), api(b, 'register', body)]);
  assert.ok(created.every(r => r.status === 200));
  assert.equal(created[0].data.user.id, created[1].data.user.id);
  assert.equal(await db.store.count(), 1); assert.equal(await db.user.count(), 1);
  const committedUser = created[0].data.user;
  // Discard a response deliberately, then replace the serving process; no in-memory idempotency.
  await api(a, 'register', body); await stop(a.child); const restarted = await start();
  const recovered = await api(restarted, 'register', body);
  assert.equal(recovered.status, 200); assert.deepEqual(recovered.data.user, committedUser);
  assert.equal((await api(restarted, 'register', { ...body, realName: 'Changed payload' })).status, 409);
  const verifiedAgain = await api(restarted, 'verify', p);
  assert.equal(verifiedAgain.data.user.id, committedUser.id);
  const p1 = await proof('separate-ticket-sub', b), p2 = await proof('separate-ticket-sub', restarted);
  const v1 = await api(b, 'verify', p1), v2 = await api(restarted, 'verify', p2);
  const separate = await Promise.all([api(b, 'register', payload(v1.data.registrationToken, 'One name')), api(restarted, 'register', payload(v2.data.registrationToken, 'Another name'))]);
  assert.ok(separate.every(r => r.status === 200)); assert.equal(separate[0].data.user.id, separate[1].data.user.id);
  assert.equal(await db.store.count(), 2); assert.equal(await db.user.count(), 2); assert.equal(await db.authIdentity.count(), 2);
});
