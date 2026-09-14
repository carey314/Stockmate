// Local PNVS preparation only. No flag or HTTP endpoint enables real SMS calls.
// Do not import this executable from tests; --self-check never loads credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const express = require('express');
const credentialPath = '/Users/carey/.config/stockmate/pnvs.env';
const lockedMessage = '真实短信联验尚未放行：等待RAM权限核验及用户指定号码';

function lockedGate(req, res, next) {
  if (req.path.startsWith('/api/v1/auth/sms/') && req.path !== '/api/v1/auth/sms/capabilities') {
    return res.status(503).json({ code: 503, message: lockedMessage, data: { integrationLocked: true } });
  }
  next();
}

async function selfCheck() {
  const assert = require('node:assert/strict');
  let reached = 0;
  const app = express();
  app.use(lockedGate);
  app.use((_req, res) => { reached++; res.json({ reached: true }); });
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  try {
    for (const route of ['send', 'login', 'register', 'reset-password', 'bind', 'reauth', 'reauth/challenge']) {
      const reply = await fetch(`http://127.0.0.1:${listener.address().port}/api/v1/auth/sms/${route}`, { method: 'POST' });
      assert.equal(reply.status, 503);
      assert.equal((await reply.json()).data.integrationLocked, true);
    }
    assert.equal(reached, 0);
    console.log(JSON.stringify({ preparationGateChecks: 7, downstreamCalls: 0, credentialsLoaded: false }));
  } finally { await new Promise(resolve => listener.close(resolve)); }
}

async function main() {
  process.umask(0o077);
  process.env.TZ = 'Asia/Shanghai';
  // Remove inherited providers/debug before any schema process. Never source server/.env.
  for (const key of Object.keys(process.env)) {
    if (/^(PNVS_|ALIYUN_|ALIBABA_CLOUD_|APPLE_|DEEPSEEK_)/.test(key)
      || ['DEBUG', 'NODE_DEBUG', 'NODE_OPTIONS'].includes(key)) delete process.env[key];
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stockmate-pnvs-prep-'));
  const database = path.join(directory, 'integration.db');
  const schema = path.join(directory, 'schema.prisma');
  fs.copyFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), schema);
  process.env.DATABASE_URL = `file:${database}`;
  // Isolated schema path + cwd prevents Prisma discovering the repository .env.
  // Child environment is allowlisted and real PNVS credentials are not loaded yet.
  execFileSync(process.execPath, [path.resolve(__dirname, '../node_modules/prisma/build/index.js'),
    'db', 'push', '--skip-generate', '--schema', schema], {
    cwd: directory, stdio: 'ignore',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: process.env.DATABASE_URL,
      PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' },
  });

  const parent = fs.lstatSync(path.dirname(credentialPath));
  const file = fs.lstatSync(credentialPath);
  if (!parent.isDirectory() || !file.isFile() || (parent.mode & 0o777) !== 0o700
    || (file.mode & 0o777) !== 0o600 || file.uid !== process.getuid() || parent.uid !== process.getuid()) {
    throw new Error('credential-permissions');
  }
  const parsed = require('dotenv').parse(fs.readFileSync(credentialPath));
  const { REQUIRED, checkConfig } = require('../src/services/sms/config');
  const providerEnv = Object.fromEntries(REQUIRED.map(key => [key, parsed[key]]));
  if (!checkConfig(providerEnv).enabled) throw new Error('credential-fields');
  // Keep provider credentials in a dedicated object, not process.env or child processes.
  // Constructing this adapter does not initialize the SDK client or make requests.
  const realProvider = require('../src/services/sms/provider').createProvider({ env: providerEnv });
  const configurationPresent = realProvider.enabled();
  // Deliberately never mount realProvider.send/check. There is no runtime unlock switch.
  const lockedProvider = {
    enabled: () => false,
    send: async () => { throw Object.assign(new Error(lockedMessage), { status: 503 }); },
    check: async () => { throw Object.assign(new Error(lockedMessage), { status: 503 }); },
  };
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.ALLOW_REGISTRATION = 'false';
  const db = require('../src/config/prisma').basePrisma;
  if (await db.user.count() !== 0) throw new Error('database-not-empty');
  const bcrypt = require('bcryptjs');
  const fixtures = [];
  for (const group of ['a', 'b']) {
    const store = await db.store.create({ data: { name: `PNVS待放行合成店${group.toUpperCase()}` } });
    for (const role of group === 'a' ? ['admin', 'staff'] : ['admin']) {
      const password = `Qa-${crypto.randomBytes(12).toString('hex')}`;
      const user = await db.user.create({ data: { storeId: store.id, username: `pnvs_${group}_${role}`,
        realName: `PNVS合成${role}`, role, phone: null, passwordHash: await bcrypt.hash(password, 10) } });
      fixtures.push({ username: user.username, password, userId: user.id, storeId: store.id, role });
    }
  }
  const { auth } = require('../src/middlewares/auth');
  const { authLimiter, globalLimiter } = require('../src/middlewares/rateLimit');
  const { wrap } = require('../src/utils/response');
  const authCtl = require('../src/controllers/auth');
  const sms = require('../src/controllers/sms').createController({ db, provider: lockedProvider });
  const app = express();
  app.set('trust proxy', false); // Direct loopback only; this service has no nginx proxy.
  app.disable('x-powered-by');
  app.use(require('helmet')());
  app.use(lockedGate); // Before body parsing/auth/provider invocation.
  app.use(globalLimiter);
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ ok: true, database: 'isolated', configurationPresent, integrationLocked: true,
        providerCallsPermitted: false, ramPermissionVerified: false, testNumberDesignated: false });
    } catch { res.status(503).json({ ok: false }); }
  });
  app.get('/api/v1/auth/sms/capabilities', wrap(sms.capabilities));
  app.post('/api/v1/auth/login', authLimiter, wrap(authCtl.login));
  app.get('/api/v1/auth/profile', auth, wrap(authCtl.profile));
  // Other business mutations/Apple/AI routes are intentionally not mounted during preparation.
  app.use((_req, res) => res.status(404).json({ code: 404, message: '仅开放隔离联验准备入口' }));
  // No request bodies/headers, provider errors, Prisma error objects or stack traces in logs.
  app.use((_error, _req, res, _next) => res.status(500).json({ code: 500, message: '隔离联验请求未完成' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const accessFile = path.join(directory, 'synthetic-access.json');
  const metadata = { api: `http://127.0.0.1:${server.address().port}/api/v1`, pid: process.pid,
    directory, database, credentialSource: credentialPath, syntheticAccessFile: accessFile,
    state: 'PREPARATION_LOCKED', configurationPresent, ramPermissionVerified: false,
    testNumberDesignated: false, providerCallsPermitted: false,
    accounts: fixtures.map(({ password, ...publicFields }) => publicFields),
    logPolicy: 'metadata only; no bodies/headers/OTP/provider errors; secrets never exported to process.env',
    startedAt: new Date().toISOString() };
  fs.writeFileSync(accessFile, JSON.stringify({ api: metadata.api, fixtures }, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'service.json'), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.resolve(__dirname, '../../docs/quality/2026-09-08-web/evidence-batch2/pnvs-preparation.json'), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata));
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
    console.log(JSON.stringify({ state: 'STOPPED', databasePreserved: true, pid: process.pid }));
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

const run = process.argv.length === 3 && process.argv[2] === '--self-check' ? selfCheck
  : process.argv.length === 3 && process.argv[2] === '--prepare-only' ? main : null;
if (!run) { console.error('Use --self-check or --prepare-only; no SMS activation flag exists'); process.exitCode = 1; }
else run().catch(() => { console.error('PNVS preparation failed; inspect configuration/permissions locally without printing secrets'); process.exitCode = 1; });
