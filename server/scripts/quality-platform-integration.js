// Dedicated loopback fixture server. Never load .env or real provider credentials.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
process.umask(0o077);
for (const key of Object.keys(process.env)) if (!['PATH','HOME','TMPDIR','LANG'].includes(key)) delete process.env[key];
process.env.TZ = 'Asia/Shanghai';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.PLATFORM_JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.PROMO_CODE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const root = path.resolve(__dirname, '../..');
const privateDir = fs.mkdtempSync(path.join(os.homedir(), '.config/stockmate/platform-operations-'));
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
 fs.writeFileSync(path.join(privateDir,'runtime-keys.json'),JSON.stringify({JWT_SECRET:process.env.JWT_SECRET,PLATFORM_JWT_SECRET:process.env.PLATFORM_JWT_SECRET,PROMO_CODE_ENCRYPTION_KEY:process.env.PROMO_CODE_ENCRYPTION_KEY}));
 const dbClient = prisma.basePrisma;
 const password = `Qa-${crypto.randomBytes(16).toString('hex')}`;
 const passwordHash = await bcrypt.hash(password,12);
 const admin = await dbClient.platformAdmin.create({data:{username:'platform_quality',passwordHash,displayName:'本地合成运营员'}});
 const store = await dbClient.store.create({data:{name:'体验码合成联验店'}});
 const user = await dbClient.user.create({data:{storeId:store.id,username:'promo_quality_owner',passwordHash,role:'admin',realName:'合成店主'}});
 await dbClient.platformEvent.create({data:{eventKey:`registration:${user.id}`,userId:user.id,storeId:store.id,kind:'registration',source:'password'}});
 await dbClient.aiRequestRecord.createMany({data:[
  {requestId:'synthetic-logical-1',userId:user.id,storeId:store.id,endpoint:'quality-synthetic',model:'synthetic-provider',attempt:1,status:'success',durationMs:25,promptTokens:100,completionTokens:20,totalTokens:120},
  {requestId:'synthetic-logical-2',userId:user.id,storeId:store.id,endpoint:'quality-synthetic',model:'synthetic-provider',attempt:1,status:'failed',durationMs:20},
 ]});
 const fixturePath=path.join(privateDir,'fixtures.json');
 fs.writeFileSync(fixturePath,JSON.stringify({platform:{id:admin.id,username:admin.username,password},merchant:{id:user.id,storeId:store.id,username:user.username,password}}));
 const app=express();require('../src/config/proxy').configureProxy(app);app.use(require('cors')());app.use(express.json({limit:'5mb'}));
 app.get('/health',async(_req,res)=>{await dbClient.$queryRaw`SELECT 1`;res.json({ok:true,isolated:true,externalCallsPermitted:false,smsEnabled:false,appleEnabled:false})});
 app.use('/api/v1',require('../src/routes'));app.use(require('../src/middlewares/errorHandler'));
 const server=app.listen(0,'127.0.0.1',()=>{
  const meta={api:`http://127.0.0.1:${server.address().port}/api/v1`,pid:process.pid,db,privateDir,fixturePath,initialCounts:{stores:1,users:1,platformAdmins:1,promoCodes:0,entitlements:0,aiAttempts:2},syntheticMetrics:true,externalCallsPermitted:false,startedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'docs/quality/2026-09-14-platform/integration.json'),JSON.stringify(meta,null,2));
  console.log(JSON.stringify({ready:true,api:meta.api,pid:meta.pid,fixturePath}));
 });
}
main().catch(()=>{console.error('Isolated platform quality server failed; no provider calls permitted');process.exitCode=1});
