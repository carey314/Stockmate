// These are real processes, HTTP requests, transactions and signatures. No SMS,
// Apple or AI endpoint is invoked; tokens/secrets never enter test output.
process.env.JWT_SECRET = 'web-login-multiprocess-synthetic-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const path = require('node:path');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');

test('Web QR/code ownership and recovery persist across HTTP processes and restarts', { timeout: 45000 }, async t => {
  const file = useIsolatedDb(`web-login-multiprocess-${process.pid}`);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const { issueJwt, clearGrants } = require('../src/services/session');
  const children = new Set();
  async function stop(child, abrupt = false) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (abrupt) child.kill('SIGKILL');
      else child.send('stop');
    });
  }
  t.after(async () => {
    await Promise.all([...children].map(child => stop(child)));
    await db.$disconnect();
    dropIsolatedDb(file);
  });
  async function start() {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(PNVS_|ALIYUN_|ALIBABA_|APPLE_|DEEPSEEK_|OPENAI_)/.test(key)));
    const child = fork(path.join(__dirname, 'helpers/web-login-worker.cjs'), [], {
      env: { ...env, NODE_OPTIONS: '', RATE_AUTH_MAX: '1000' },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    children.add(child);
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker startup timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Worker exited before becoming ready')); });
      child.on('message', message => {
        if (message.type === 'ready') { clearTimeout(timer); resolve(message.port); }
      });
    });
    return { child, port };
  }
  let workers = [await start(), await start()];
  async function restart(index) {
    await stop(workers[index].child, true);
    workers[index] = await start();
  }
  async function api(index, route, body, bearer) {
    const response = await fetch(`http://127.0.0.1:${workers[index].port}/api/v1/auth/web-login${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  }
  let sequence = 0;
  async function actor(role = 'staff') {
    const store = await db.store.create({ data: { name: `Web process shop ${++sequence}` } });
    const user = await db.user.create({ data: {
      storeId: store.id, username: `web_process_${sequence}`, realName: 'Process test user',
      passwordHash: 'synthetic-not-a-real-password', role,
    } });
    return { user, bearer: issueJwt(user) };
  }
  async function challenge() {
    const result = await api(0, '/challenges', {});
    assert.equal(result.status, 200, result.message);
    assert.equal(result.cache, 'no-store');
    const c = result.data;
    const qr = new URL(c.qrContent);
    assert.equal(qr.protocol, 'stockmate:');
    assert.equal(qr.hostname, 'web-login');
    assert.equal(qr.searchParams.get('v'), '1');
    assert.deepEqual([...qr.searchParams.keys()].sort(), ['id', 'scan', 'v']);
    assert.ok(!c.qrContent.includes(c.browserSecret), 'QR must not expose browser secret');
    const scanToken = qr.searchParams.get('scan');
    const stored = await db.webAccessGrant.findUnique({ where: { id: c.challengeId } });
    assert.equal(stored.scanHash === hash(scanToken), true, 'Persist only scan hash');
    assert.equal(stored.browserHash === hash(c.browserSecret), true, 'Persist only browser hash');
    assert.ok(!JSON.stringify(stored).includes(scanToken), 'Scan secret must not be persisted');
    assert.ok(!JSON.stringify(stored).includes(c.browserSecret), 'Browser secret must not be persisted');
    return { ...c, scanToken };
  }
  const browser = c => ({ challengeId: c.challengeId, browserSecret: c.browserSecret });
  const scan = c => ({ challengeId: c.challengeId, scanToken: c.scanToken });
  async function approve(c, owner) {
    assert.equal((await api(0, '/scan', scan(c), owner.bearer)).status, 200);
    assert.equal((await api(1, '/confirm', { ...scan(c), approve: true }, owner.bearer)).status, 200);
  }
  function sameUser(result, owner) {
    assert.equal(result.status, 200, result.message);
    assert.equal(result.cache, 'no-store');
    assert.equal(result.data.user.id, owner.user.id);
    assert.equal(result.data.user.storeId, owner.user.storeId);
    assert.equal(result.data.user.role, owner.user.role);
    const claims = require('jsonwebtoken').verify(result.data.token, process.env.JWT_SECRET);
    assert.equal(claims.userId, owner.user.id);
    assert.equal(claims.sessionVersion, owner.user.sessionVersion);
  }

  await t.test('only one account can claim a QR across processes; neither secret substitutes for the other', async () => {
    const owners = [await actor(), await actor('admin')], c = await challenge();
    assert.equal((await api(1, '/scan', { ...scan(c), scanToken: c.browserSecret }, owners[0].bearer)).status, 401);
    const replies = await Promise.all(owners.map((owner, index) => api(index, '/scan', scan(c), owner.bearer)));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 403]);
    const winner = replies.findIndex(r => r.status === 200), loser = 1 - winner;
    const row = await db.webAccessGrant.findUnique({ where: { id: c.challengeId } });
    assert.equal(row.userId, owners[winner].user.id);
    assert.equal(row.storeId, owners[winner].user.storeId);
    assert.equal(row.state, 'scanned');
    assert.equal((await api(winner, '/redeem', browser(c))).status, 409, 'Scan is not approval');
    assert.equal((await api(loser, '/confirm', { ...scan(c), approve: true }, owners[loser].bearer)).status, 403);
    await restart(winner);
    assert.equal((await api(winner, '/scan', scan(c), owners[loser].bearer)).status, 403);
    assert.equal((await api(loser, '/confirm', { ...scan(c), approve: true }, owners[winner].bearer)).status, 200);
    assert.equal((await api(winner, '/redeem', { ...browser(c), browserSecret: c.scanToken })).status, 401);
    sameUser(await api(winner, '/redeem', browser(c)), owners[winner]);
  });

  await t.test('one explicit staff approval survives concurrent same-browser redemption and abrupt restart', async () => {
    const owner = await actor(), c = await challenge();
    const stores = await db.store.count(), users = await db.user.count();
    assert.equal((await api(0, '/confirm', { ...scan(c), approve: true }, owner.bearer)).status, 409);
    await approve(c, owner);
    const repeats = await Promise.all(workers.map((_, index) => api(index, '/confirm', { ...scan(c), approve: true }, owner.bearer)));
    assert.ok(repeats.every(r => r.status === 200 && r.data.state === 'approved'));
    const replies = await Promise.all(workers.map((_, index) => api(index, '/redeem', browser(c))));
    replies.forEach(result => sameUser(result, owner));
    assert.equal((await db.webAccessGrant.findUnique({ where: { id: c.challengeId } })).state, 'redeemed');
    await restart(0);
    sameUser(await api(0, '/redeem', browser(c)), owner);
    assert.equal((await api(1, '/redeem', { ...browser(c), browserSecret: secret() })).status, 401);
    assert.equal((await api(0, '/redeem', browser(c), owner.bearer)).status, 403);
    assert.equal(await db.store.count(), stores);
    assert.equal(await db.user.count(), users);
  });

  await t.test('code race assigns exactly one browser secret; only its recovery survives restart', async () => {
    const owner = await actor();
    const issued = await api(0, '/code', { consent: true }, owner.bearer);
    assert.equal(issued.status, 200);
    const bodies = [0, 1].map(() => ({ code: issued.data.code, browserSecret: secret() }));
    const replies = await Promise.all(bodies.map((body, index) => api(index, '/code/redeem', body)));
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 401]);
    const winner = replies.findIndex(r => r.status === 200), loser = 1 - winner;
    sameUser(replies[winner], owner);
    const row = await db.webAccessGrant.findUnique({ where: { codeHash: hash(issued.data.code) } });
    assert.equal(row.browserHash === hash(bodies[winner].browserSecret), true);
    assert.equal(row.state, 'redeemed');
    assert.ok(!JSON.stringify(row).includes(issued.data.code), 'Code must not be persisted');
    await restart(winner);
    sameUser(await api(winner, '/code/redeem', bodies[winner]), owner);
    assert.equal((await api(loser, '/code/redeem', bodies[loser])).status, 401);
  });

  await t.test('disabled or changed-generation accounts cannot redeem or recover even without grant cleanup', async () => {
    for (const mutation of ['disabled', 'generation', 'store']) {
      const owner = await actor(), c = await challenge();
      await approve(c, owner);
      sameUser(await api(0, '/redeem', browser(c)), owner);
      const issued = await api(1, '/code', { consent: true }, owner.bearer);
      const body = { code: issued.data.code, browserSecret: secret() };
      sameUser(await api(1, '/code/redeem', body), owner);
      const data = mutation === 'disabled' ? { status: 0 } : mutation === 'generation'
        ? { sessionVersion: { increment: 1 } } : { storeId: (await actor('admin')).user.storeId };
      await db.user.update({ where: { id: owner.user.id }, data });
      await restart(0);
      assert.equal((await api(0, '/redeem', browser(c))).status, 401, mutation);
      assert.equal((await api(1, '/code/redeem', body)).status, 401, mutation);
      assert.equal((await api(0, '/status', browser(c))).status, 401, mutation);
      assert.equal((await api(1, '/confirm', { ...scan(c), approve: true }, owner.bearer)).status, mutation === 'store' ? 403 : 401, mutation);
    }
  });

  await t.test('clearGrants deletes only target actor grants and revocation persists after restart', async () => {
    const owner = await actor(), other = await actor('admin');
    const c = await challenge(), otherQr = await challenge();
    await approve(c, owner); await approve(otherQr, other);
    const issued = await api(0, '/code', { consent: true }, owner.bearer);
    await db.$transaction(async tx => {
      await tx.user.update({ where: { id: owner.user.id }, data: { sessionVersion: { increment: 1 } } });
      await clearGrants(tx, [owner.user.id]);
    });
    assert.equal(await db.webAccessGrant.count({ where: { userId: owner.user.id } }), 0);
    assert.equal(await db.webAccessGrant.count({ where: { userId: other.user.id } }), 1);
    await restart(1);
    assert.equal((await api(1, '/redeem', browser(c))).status, 401);
    assert.equal((await api(0, '/code/redeem', { code: issued.data.code, browserSecret: secret() })).status, 401);
    sameUser(await api(1, '/redeem', browser(otherQr)), other);
  });

  await t.test('App cancellation confirmation is idempotent after a lost response and process restart', async () => {
    const owner = await actor(), c = await challenge();
    assert.equal((await api(0, '/scan', scan(c), owner.bearer)).status, 200);
    const body = { ...scan(c), approve: false };
    assert.equal((await api(0, '/confirm', body, owner.bearer)).status, 200);
    await restart(0);
    const repeated = await api(1, '/confirm', body, owner.bearer);
    assert.equal(repeated.status, 200, 'Repeated cancellation must recover its successful outcome');
    assert.equal(repeated.data.state, 'cancelled');
    assert.notEqual((await api(0, '/confirm', { ...scan(c), approve: true }, owner.bearer)).status, 200,
      'A cancelled authorization must never become approved again');
    assert.equal((await api(1, '/redeem', browser(c))).status, 401);
    const other = await actor('admin');
    assert.equal((await api(1, '/confirm', body, other.bearer)).status, 403);
    const unscanned = await challenge();
    assert.equal((await api(0, '/cancel', browser(unscanned))).status, 200);
    assert.equal((await api(1, '/confirm', { ...scan(unscanned), approve: false }, owner.bearer)).status, 401);
  });

  await t.test('expired approved or previously redeemed grants never recover after restart', async () => {
    const owner = await actor(), c = await challenge(); await approve(c, owner);
    sameUser(await api(0, '/redeem', browser(c)), owner);
    const issued = await api(1, '/code', { consent: true }, owner.bearer);
    const body = { code: issued.data.code, browserSecret: secret() };
    sameUser(await api(0, '/code/redeem', body), owner);
    await db.webAccessGrant.updateMany({ where: { userId: owner.user.id }, data: { expiresAt: new Date(0) } });
    await restart(1);
    assert.equal((await api(1, '/status', browser(c))).data.state, 'expired');
    assert.equal((await api(1, '/redeem', browser(c))).status, 401);
    assert.equal((await api(0, '/code/redeem', body)).status, 401);
    assert.equal((await api(1, '/confirm', { ...scan(c), approve: true }, owner.bearer)).status, 401);
  });

  await t.test('authentication and validation failures carry the same no-store policy as success', async () => {
    const c = await challenge();
    const unauthenticated = await api(1, '/scan', scan(c));
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.cache, 'no-store', 'Authentication errors must also be no-store');
    const invalid = await api(0, '/redeem', { challengeId: c.challengeId });
    assert.equal(invalid.status, 400); assert.equal(invalid.cache, 'no-store');
  });

  await t.test('concurrent cancellation and redemption have one durable outcome', async () => {
    const owner = await actor(), c = await challenge(); await approve(c, owner);
    const [cancelled, redeemed] = await Promise.all([
      api(0, '/cancel', browser(c)), api(1, '/redeem', browser(c)),
    ]);
    const row = await db.webAccessGrant.findUnique({ where: { id: c.challengeId } });
    if (row.state === 'cancelled') {
      assert.equal(cancelled.status, 200); assert.equal(redeemed.status, 401);
    } else {
      assert.equal(row.state, 'redeemed'); assert.equal(cancelled.status, 409); sameUser(redeemed, owner);
    }
    await restart(0);
    const recovered = await api(0, '/redeem', browser(c));
    if (row.state === 'cancelled') assert.equal(recovered.status, 401);
    else sameUser(recovered, owner);
  });
});
