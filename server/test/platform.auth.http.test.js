process.env.JWT_SECRET = 'tenant-only-platform-auth-test-secret';
process.env.PLATFORM_JWT_SECRET = 'platform-only-independent-auth-test-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { spawn } = require('node:child_process');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');

const middlewarePath = path.join(__dirname, '../src/middlewares/platformAuth.js');
const controllerPath = path.join(__dirname, '../src/controllers/platformAuth.js');
const cliPath = path.join(__dirname, '../scripts/platform-admin.js');

test('independent platform identities, revocation and private administrator CLI', { timeout: 45000 }, async t => {
  assert.ok(fs.existsSync(controllerPath) && fs.existsSync(middlewarePath), 'Independent platform authentication must exist');
  const file = useIsolatedDb(`platform-auth-${process.pid}`);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const { createController } = require(controllerPath);
  const { createPlatformAuth } = require(middlewarePath);
  const { createAuth } = require('../src/middlewares/auth');
  const { wrap } = require('../src/utils/response');
  const express = require('express');
  const app = express(); app.use(express.json());
  const config = { PLATFORM_JWT_SECRET: process.env.PLATFORM_JWT_SECRET };
  const controller = createController({ db, env: config });
  const platformAuth = createPlatformAuth({ db, env: config });
  app.post('/platform/auth/login', wrap(controller.login));
  app.get('/platform/auth/profile', platformAuth, wrap(controller.profile));
  app.get('/platform/context', platformAuth, (req, res) => res.json({ platformAdmin: req.platformAdmin, hasTenantUser: !!req.user }));
  app.get('/tenant', createAuth({ db }), (_req, res) => res.json({ code: 200 }));
  const disabled = createController({ db, env: { JWT_SECRET: process.env.JWT_SECRET } });
  app.post('/unconfigured/login', wrap(disabled.login));
  app.get('/unconfigured/profile', createPlatformAuth({ db, env: { JWT_SECRET: process.env.JWT_SECRET } }), wrap(disabled.profile));
  for (const [name, weakConfig] of Object.entries({
    weak: { PLATFORM_JWT_SECRET: 'short', JWT_SECRET: process.env.JWT_SECRET },
    shared: { PLATFORM_JWT_SECRET: process.env.JWT_SECRET, JWT_SECRET: process.env.JWT_SECRET },
  })) {
    const ctl = createController({ db, env: weakConfig });
    app.post(`/${name}/login`, wrap(ctl.login));
    app.get(`/${name}/profile`, createPlatformAuth({ db, env: weakConfig }), wrap(ctl.profile));
  }
  app.use(require('../src/middlewares/errorHandler'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const privateDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'platform-cli-'));
  fs.chmodSync(privateDir, 0o700);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); await db.$disconnect();
    dropIsolatedDb(file); fs.rmSync(privateDir, { recursive: true, force: true });
  });
  async function api(route, body, token) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, cache: r.headers.get('cache-control'), ...await r.json() };
  }
  let sequence = 0;
  const password = 'Synthetic-platform-pass-2026!';
  async function fixture() {
    return db.platformAdmin.create({ data: {
      username: `platform_${++sequence}`, displayName: 'Synthetic operator', passwordHash: await bcrypt.hash(password, 4),
    } });
  }
  const login = admin => api('/platform/auth/login', { username: admin.username, password });
  const sign = (admin, changes = {}, options = {}) => jwt.sign({ sessionVersion: admin.sessionVersion, ...changes }, config.PLATFORM_JWT_SECRET, {
    issuer: 'stockmate-platform', audience: 'platform', subject: String(admin.id), expiresIn: '2h', ...options,
  });

  await t.test('successful login has dedicated issuer/audience/sub, 2h lifetime and no tenant claims', async () => {
    const admin = await fixture(), r = await login(admin);
    assert.equal(r.status, 200, r.message); assert.equal(r.cache, 'no-store');
    assert.deepEqual(r.data.admin, { id: admin.id, username: admin.username, displayName: admin.displayName });
    const claims = jwt.verify(r.data.token, config.PLATFORM_JWT_SECRET, { issuer: 'stockmate-platform', audience: 'platform', algorithms: ['HS256'] });
    assert.equal(claims.sub, String(admin.id)); assert.equal(claims.sessionVersion, 0);
    assert.equal(claims.exp - claims.iat, 7200); assert.equal(claims.userId, undefined); assert.equal(claims.role, undefined);
    const profile = await api('/platform/auth/profile', null, r.data.token);
    assert.equal(profile.status, 200); assert.equal(profile.cache, 'no-store'); assert.deepEqual(profile.data.admin, r.data.admin);
    const context = await api('/platform/context', null, r.data.token);
    assert.deepEqual(context.platformAdmin, { ...r.data.admin, sessionVersion: 0 }); assert.equal(context.hasTenantUser, false);
    assert.equal(await db.user.count(), 0); assert.equal(await db.store.count(), 0);
  });

  await t.test('platform and tenant JWTs reject each other; wrong issuer/audience/algorithm/subject fail', async () => {
    const admin = await fixture(), platform = (await login(admin)).data.token;
    const store = await db.store.create({ data: { name: 'Independent merchant' } });
    const merchant = await db.user.create({ data: { storeId: store.id, username: 'merchant_admin', realName: 'Merchant', role: 'admin', passwordHash: 'synthetic' } });
    const tenant = jwt.sign({ userId: merchant.id, role: 'admin', sessionVersion: 0 }, process.env.JWT_SECRET);
    assert.equal((await api('/platform/auth/profile', null, tenant)).status, 401);
    assert.equal((await api('/tenant', null, platform)).status, 401);
    const invalid = [
      sign(admin, {}, { issuer: 'merchant' }), sign(admin, {}, { audience: 'merchant' }), sign(admin, {}, { audience: ['platform', 'merchant'] }),
      sign(admin, {}, { subject: '0' }), sign(admin, {}, { subject: '1suffix' }),
      sign(admin, {}, { expiresIn: -1 }), sign(admin, {}, { algorithm: 'HS384' }),
      sign(admin, { userId: merchant.id }), sign(admin, {}, { expiresIn: '3d' }),
      jwt.sign({ sessionVersion: 0, iss: 'stockmate-platform', aud: 'platform', sub: String(admin.id) }, config.PLATFORM_JWT_SECRET, { noTimestamp: true }),
    ];
    for (const token of invalid) assert.equal((await api('/platform/auth/profile', null, token)).status, 401);
    const absent = await api('/platform/auth/profile'); assert.equal(absent.status, 401); assert.equal(absent.cache, 'no-store');
  });

  await t.test('disabled, deleted or changed-generation platform accounts cannot retain prior sessions', async () => {
    for (const mutation of ['disabled', 'version', 'deleted']) {
      const admin = await fixture(), token = (await login(admin)).data.token;
      if (mutation === 'deleted') await db.platformAdmin.delete({ where: { id: admin.id } });
      else await db.platformAdmin.update({ where: { id: admin.id }, data: mutation === 'disabled' ? { status: 0 } : { sessionVersion: { increment: 1 } } });
      assert.equal((await api('/platform/auth/profile', null, token)).status, 401, mutation);
    }
  });

  await t.test('invalid credentials are generic and unconfigured platform secret never falls back to tenant key', async () => {
    const admin = await fixture();
    const wrong = await api('/platform/auth/login', { username: admin.username, password: 'wrong' });
    const absent = await api('/platform/auth/login', { username: 'missing_operator', password });
    await db.platformAdmin.update({ where: { id: admin.id }, data: { status: 0 } });
    const inactive = await login(admin);
    for (const result of [wrong, absent, inactive]) { assert.equal(result.status, 401); assert.equal(result.cache, 'no-store'); assert.equal(result.data, undefined); }
    assert.equal(wrong.message, absent.message); assert.equal(wrong.message, inactive.message);
    assert.equal((await api('/unconfigured/login', { username: admin.username, password })).status, 503);
    assert.equal((await api('/unconfigured/profile', null, sign(admin))).status, 503);
    for (const path of ['weak', 'shared']) {
      assert.equal((await api(`/${path}/login`, { username: admin.username, password })).status, 503);
      assert.equal((await api(`/${path}/profile`, null, sign(admin))).status, 503);
    }
  });

  function cli(action, source, input, envOverrides = {}) {
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: '',
      DATABASE_URL: `file:${file}`, PLATFORM_JWT_SECRET: config.PLATFORM_JWT_SECRET, ...envOverrides,
    };
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, action, ...source], { env, cwd: privateDir, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
      child.stdin.end(input || '');
    });
  }
  await t.test('CLI accepts private file/stdin, atomically audits creation and reset, revokes existing token', async () => {
    assert.ok(fs.existsSync(cliPath), 'Platform administrator CLI must exist');
    const username = 'cli_operator', firstPass = `Synthetic-${crypto.randomBytes(16).toString('hex')}`;
    const secondPass = `Synthetic-${crypto.randomBytes(16).toString('hex')}`;
    const inputFile = path.join(privateDir, 'administrator.json');
    fs.writeFileSync(inputFile, JSON.stringify({ username, displayName: 'CLI operator', password: firstPass }), { mode: 0o600 });
    const created = await cli('create', ['--file', inputFile]);
    assert.equal(created.code, 0, 'Private-file create succeeds');
    assert.equal((created.stdout + created.stderr).includes(firstPass), false, 'CLI must never print password');
    const admin = await db.platformAdmin.findUnique({ where: { username } }); assert.ok(admin); assert.equal(await bcrypt.compare(firstPass, admin.passwordHash), true);
    const token = (await api('/platform/auth/login', { username, password: firstPass })).data.token;
    const reset = await cli('reset-password', ['--stdin'], JSON.stringify({ username, password: secondPass }));
    assert.equal(reset.code, 0); assert.equal((reset.stdout + reset.stderr).includes(secondPass), false);
    const updated = await db.platformAdmin.findUnique({ where: { username } }); assert.equal(updated.sessionVersion, admin.sessionVersion + 1);
    assert.equal(await bcrypt.compare(secondPass, updated.passwordHash), true);
    assert.equal((await api('/platform/auth/profile', null, token)).status, 401);
    const records = await db.platformAudit.findMany({ where: { targetId: String(admin.id), action: { in: ['platform.admin.create', 'platform.admin.reset-password'] } } });
    assert.equal(records.length, 2); assert.equal(JSON.stringify(records).includes(firstPass), false); assert.equal(JSON.stringify(records).includes(secondPass), false);
  });

  await t.test('CLI rejects unsafe password sources and missing explicit environment without changing accounts', async () => {
    const before = await db.platformAdmin.count();
    const payload = JSON.stringify({ username: 'must_not_create', displayName: 'No create', password });
    const unsafe = path.join(privateDir, 'unsafe.json'); fs.writeFileSync(unsafe, payload, { mode: 0o644 });
    const privateFile = path.join(privateDir, 'private.json'); fs.writeFileSync(privateFile, payload, { mode: 0o600 });
    const link = path.join(privateDir, 'linked.json'); fs.symlinkSync(privateFile, link);
    for (const result of [
      await cli('create', ['--file', unsafe]), await cli('create', ['--file', link]),
      await cli('create', ['--password', 'invalid-source-placeholder']),
      await cli('create', ['--stdin'], payload, { DATABASE_URL: undefined }),
      await cli('create', ['--stdin'], payload, { PLATFORM_JWT_SECRET: undefined }),
      await cli('create', ['--stdin'], payload, { PLATFORM_JWT_SECRET: 'short' }),
      await cli('create', ['--stdin'], payload, { PLATFORM_JWT_SECRET: process.env.JWT_SECRET, JWT_SECRET: process.env.JWT_SECRET }),
      await cli('create', ['--stdin'], '{invalid-json'),
    ]) { assert.notEqual(result.code, 0); assert.equal((result.stdout + result.stderr).includes(password), false); }
    assert.equal(await db.platformAdmin.count(), before);
  });
  await t.test('CLI duplicate creation, disabled reset and failed auditing never change unrelated security state', async () => {
    const admin = await fixture();
    const replacement = `Synthetic-${crypto.randomBytes(16).toString('hex')}`;
    const duplicate = await cli('create', ['--stdin'], JSON.stringify({ username: admin.username, displayName: 'Duplicate', password: replacement }));
    assert.notEqual(duplicate.code, 0);
    let stored = await db.platformAdmin.findUnique({ where: { id: admin.id } });
    assert.equal(stored.passwordHash === admin.passwordHash, true);
    assert.equal(stored.sessionVersion, 0);
    await db.platformAdmin.update({ where: { id: admin.id }, data: { status: 0 } });
    const reset = await cli('reset-password', ['--stdin'], JSON.stringify({ username: admin.username, password: replacement }));
    assert.equal(reset.code, 0);
    stored = await db.platformAdmin.findUnique({ where: { id: admin.id } });
    assert.equal(stored.status, 0, 'Reset must not reactivate a disabled platform identity');
    assert.equal(stored.sessionVersion, 1);
    await db.$executeRawUnsafe("CREATE TRIGGER platform_audit_failure BEFORE INSERT ON PlatformAudit WHEN NEW.action LIKE 'platform.admin.%' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END");
    const count = await db.platformAdmin.count();
    try {
      const failed = await cli('reset-password', ['--stdin'], JSON.stringify({ username: admin.username, password }));
      assert.notEqual(failed.code, 0); assert.equal((failed.stdout + failed.stderr).includes(password), false);
      const unchanged = await db.platformAdmin.findUnique({ where: { id: admin.id } });
      assert.equal(unchanged.passwordHash === stored.passwordHash, true); assert.equal(unchanged.sessionVersion, stored.sessionVersion);
      const failedCreate = await cli('create', ['--stdin'], JSON.stringify({ username: 'audit_failure_new', displayName: 'No commit', password }));
      assert.notEqual(failedCreate.code, 0); assert.equal(await db.platformAdmin.count(), count);
    } finally { await db.$executeRawUnsafe('DROP TRIGGER platform_audit_failure'); }
  });

});
