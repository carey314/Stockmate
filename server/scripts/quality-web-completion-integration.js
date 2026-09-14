// Dedicated loopback fixture server. Never load .env or real provider credentials.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
process.umask(0o077);
for (const key of Object.keys(process.env)) if (!['PATH','HOME','TMPDIR','LANG'].includes(key)) delete process.env[key];
process.env.TZ = 'Asia/Shanghai';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const root = path.resolve(__dirname, '../..');
const privateDir = fs.mkdtempSync(path.join(os.homedir(), '.config/stockmate/web-completion-'));
const db = path.join(privateDir, 'integration.db');
process.env.DATABASE_URL = `file:${db}`;
fs.copyFileSync(path.join(root, 'server/prisma/schema.prisma'), path.join(privateDir, 'schema.prisma'));
fs.chmodSync(path.join(privateDir, 'schema.prisma'), 0o600);
execFileSync(path.join(root, 'server/node_modules/.bin/prisma'), ['db','push','--skip-generate','--schema',path.join(privateDir,'schema.prisma')], { cwd: privateDir, env: process.env, stdio: 'ignore' });
// Defense in depth for the current provider adapters: direct fetch/request targets must be loopback.
// This is an application guard, not an OS network sandbox (get/redirect paths are not covered).
const permitted = value => { const u = new URL(typeof value === 'string' ? value : value.url || value.href); return ['127.0.0.1','localhost','[::1]'].includes(u.hostname) };
const originalFetch = global.fetch;
global.fetch = (input, init) => { if (!permitted(input)) return Promise.reject(new Error('External calls disabled in quality server')); return originalFetch(input, init) };
for (const moduleName of ['node:http','node:https']) {
 const module = require(moduleName); const original = module.request;
 module.request = function (options, ...args) { const hostname = typeof options === 'string' || options instanceof URL ? new URL(options).hostname : options.hostname || options.host || 'localhost'; if (!['127.0.0.1','localhost','::1','[::1]'].includes(hostname)) throw new Error('External calls disabled in quality server'); return original.call(this, options, ...args) };
}
const prisma = require('../src/config/prisma'), bcrypt = require('bcryptjs'), express = require('express');
async function main() {
 const fixtures = [];
 for (const suffix of ['a','b']) {
  const store = await prisma.basePrisma.store.create({ data: { name: `Web功能联验${suffix.toUpperCase()}` } });
  await prisma.runWithTenant(store.id, async () => {
   const password = `Qa-${crypto.randomBytes(12).toString('hex')}`;
   const admin = await prisma.user.create({ data: { username: `web_qa_${suffix}`, passwordHash: await bcrypt.hash(password, 10), realName: '合成老板', role: 'admin' } });
   const staff = await prisma.user.create({ data: { username: `web_qa_staff_${suffix}`, passwordHash: await bcrypt.hash(password, 10), realName: '合成员工', role: 'staff' } });
   const type = await prisma.productType.create({ data: { name: '手工联验商品' } });
   const product = await prisma.product.create({ data: { name: '手工测试饮料', code: `WEB-${suffix}`, productTypeId: type.id, unit: '瓶', defaultPrice: 10, costPrice: 6 } });
   const sku = await prisma.sku.create({ data: { productId: product.id, code: `WEB-${suffix}-1`, price: 10, costPrice: 6, isDefault: 1, specText: '单瓶' } });
   await prisma.inventory.create({ data: { productId: product.id, skuId: sku.id, quantity: 100 } });
   const customer = await prisma.customer.create({ data: { name: '手工联验客户' } });
   fixtures.push({ storeId: store.id, admin: { id: admin.id, username: admin.username, password }, staff: { id: staff.id, username: staff.username, password }, typeId: type.id, productId: product.id, skuId: sku.id, customerId: customer.id });
  });
 }
 const fixturePath = path.join(privateDir, 'fixtures.json'); fs.writeFileSync(fixturePath, JSON.stringify(fixtures));
 const app = express(); app.use(require('cors')()); app.use(express.json({ limit: '5mb' }));
 app.get('/health', async (_req, res) => { await prisma.basePrisma.$queryRaw`SELECT 1`; res.json({ ok: true, isolated: true, externalCallsPermitted: false, smsEnabled: false, appleEnabled: false }) });
 app.use('/api/v1', require('../src/routes')); app.use(require('../src/middlewares/errorHandler'));
 const server = app.listen(0, '127.0.0.1', () => {
  const meta = { api: `http://127.0.0.1:${server.address().port}/api/v1`, pid: process.pid, db, privateDir, fixturePath, initialCounts: { stores: 2, users: 4, orders: 0 }, externalCallsPermitted: false, startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'docs/quality/2026-09-14-web/integration.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ ready: true, api: meta.api, pid: meta.pid, fixturePath }));
 });
}
main().catch(() => { console.error('Isolated quality server failed to start; no provider calls permitted'); process.exitCode = 1 });
