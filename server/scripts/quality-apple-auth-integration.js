// New disposable auth integration service. Never loads .env or an existing database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
process.umask(0o077);
const allowed = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stockmate-apple-auth-'));
const database = path.join(directory, 'integration.db');
const syntheticApple = process.argv.includes('--synthetic-apple');
let syntheticJwk;
if (syntheticApple) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  syntheticJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'quality-only-apple-auth', alg: 'RS256', use: 'sig' };
  fs.writeFileSync(path.join(directory, 'apple-test-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
Object.assign(process.env, { DATABASE_URL: `file:${database}`, JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  TZ: 'Asia/Shanghai', ALLOW_REGISTRATION: 'true', APPLE_BUNDLE_ID: 'com.carey.stockmate', CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
  RATE_AUTH_MAX: '1000', RATE_REG_HOUR: '1000', RATE_REG_DAY: '3000' });
const schema = path.join(directory, 'schema.prisma');
fs.copyFileSync(path.join(__dirname, '../prisma/schema.prisma'), schema);
fs.chmodSync(schema, 0o600);
execFileSync(path.join(__dirname, '../node_modules/.bin/prisma'), ['db', 'push', '--schema', schema, '--skip-generate'], { cwd: directory, env: process.env, stdio: 'ignore' });
fs.chmodSync(database, 0o600);
const realFetch = global.fetch;
global.fetch = (url, options) => {
  if (String(url) === 'https://appleid.apple.com/auth/keys') {
    if (syntheticApple) return Promise.resolve({ ok: true, json: async () => ({ keys: [syntheticJwk] }) });
    return realFetch(url, options);
  }
  throw Object.assign(new Error('隔离认证联验不允许外部业务调用'), { status: 503 });
};
// Block SDK/legacy transports too. JWKS fetch is the only allowed external read.
for (const module of ['node:http', 'node:https']) {
  require(module).request = () => { throw Object.assign(new Error('隔离认证联验不允许外部业务调用'), { status: 503 }); };
  require(module).get = require(module).request;
}
const prisma = require('../src/config/prisma');
const db = prisma.basePrisma;
async function main() {
  const password = `QA-${crypto.randomBytes(12).toString('hex')}`;
  const passwordHash = await require('bcryptjs').hash(password, 10);
  const store = await db.store.create({ data: { name: '认证新流程合成原店' } });
  const fixtures = [];
  for (const [username, role] of [['auth_flow_owner', 'admin'], ['auth_flow_staff', 'staff']]) {
    const user = await db.user.create({ data: { storeId: store.id, username, role, passwordHash, realName: role === 'admin' ? '合成店主' : '合成员工' } });
    fixtures.push({ username, password, userId: user.id, storeId: store.id, role });
  }
  const express = require('express'); const app = express();
  require('../src/config/proxy').configureProxy(app);
  app.use(require('cors')()); app.use(express.json());
  app.use('/api/v1', require('../src/routes'));
  app.get('/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true, purpose: 'apple-two-phase-auth-integration', smsEnabled: false, externalBusinessCallsPermitted: false, appleJwksReadOnly: !syntheticApple, syntheticApple });
  });
  app.use(require('../src/middlewares/errorHandler'));
  const server = app.listen(0, '127.0.0.1', () => {
    const api = `http://127.0.0.1:${server.address().port}/api/v1`;
    fs.writeFileSync(path.join(directory, 'access.private.json'), JSON.stringify({ api, database, fixtures, jwtSecret: process.env.JWT_SECRET, syntheticApple }, null, 2), { mode: 0o600 });
    const state = { api, pid: process.pid, database, privateDirectory: directory, credentialsFile: path.join(directory, 'access.private.json'), smsEnabled: false, externalBusinessCallsPermitted: false, appleJwksReadOnly: !syntheticApple, syntheticApple, schemaSha256: crypto.createHash('sha256').update(fs.readFileSync(schema)).digest('hex') };
    fs.writeFileSync(path.join(__dirname, '../../docs/quality/2026-09-08-web/evidence-batch2/apple-auth-integration.json'), JSON.stringify(state, null, 2));
    console.log(JSON.stringify({ api, pid: process.pid, privateDirectory: directory, smsEnabled: false, externalBusinessCallsPermitted: false, syntheticApple }));
  });
  const stop = () => server.close(async () => { await db.$disconnect(); process.exit(0); });
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
main().catch(() => { console.error('Isolated Apple auth integration startup failed; no secret output'); process.exitCode = 1; });
