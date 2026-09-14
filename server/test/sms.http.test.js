process.env.JWT_SECRET = 'sms-isolated-tests-only';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');

test('SMS HTTP: capability honestly unavailable without PNVS config', async t => {
  const file = useIsolatedDb(`sms-${process.pid}`);
  const db = require('../src/config/prisma').basePrisma;
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/v1', require('../src/routes'));
  app.use(require('../src/middlewares/errorHandler'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); dropIsolatedDb(file); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/sms/capabilities`);
  assert.equal(res.status, 200, 'SMS capability endpoint must exist');
  assert.equal((await res.json()).data.enabled, false);
  const missing = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/sms/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({phone:'13800000000', purpose:'login', consent:true}) });
  assert.equal(missing.status, 503, 'Unconfigured send fails honestly');
});

test('SMS HTTP trusted identities, atomic consumption, limits and session revocation', async t => {
  const sms = require('../src/controllers/sms');
  assert.equal(typeof sms.createController, 'function', 'SMS controller must support provider boundary injection');
  const file = useIsolatedDb(`sms-flows-${process.pid}`);
  // First test disconnected shared singleton, Prisma reconnects to original URL: use an explicit fresh Prisma client.
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  let verdict = true, sendFailure = false, checkFailure = false, checks = 0, sends = 0;
  const provider = { enabled: () => true,
    async send() { sends++; if (sendFailure) throw new Error('provider raw secret'); },
    async check() { checks++; if (checkFailure) throw new Error('uncertain timeout'); return verdict; } };
  const ctl = sms.createController({ db, provider });
  const express = require('express');
  const { wrap } = require('../src/utils/response');
  const app = express(); app.use(express.json());
  // Production auth factory with explicit isolated db, no authentication mocks.
  const auth = require('../src/middlewares/auth').createAuth({ db });
  app.post('/send', (req,res,next) => req.body.purpose === 'bind' ? auth(req,res,next) : next(), wrap(ctl.send));
  for (const method of ['login','register','resetPassword']) app.post('/'+method, wrap(ctl[method]));
  for (const method of ['reauthChallenge','reauth','bind']) app.post('/'+method, auth, wrap(ctl[method]));
  app.get('/protected', auth, (_req,res) => res.json({code:200}));
  app.use(require('../src/middlewares/errorHandler'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); dropIsolatedDb(file); });
  async function api(path, body, token) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST':'GET', headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
    return { status:r.status, ...await r.json() };
  }
  let n = 0;
  const phone = () => `138${String(++n).padStart(8,'0')}`;
  async function relax() { await db.smsRateBucket.deleteMany(); }
  async function send(p, purpose='login', extra={}, token) { await relax(); const r = await api('/send',{phone:p,purpose,consent:true,...extra},token); assert.equal(r.status,200,JSON.stringify(r)); return r.data; }
  async function fixture(role='staff') {
    const store = await db.store.create({data:{name:'Original store'}});
    const user = await db.user.create({data:{storeId:store.id,username:`original_${++n}`,realName:'Original',passwordHash:await bcrypt.hash('oldpass',4),role}});
    const token = jwt.sign({userId:user.id,sessionVersion:user.sessionVersion},process.env.JWT_SECRET);
    return {store,user,token};
  }
  async function reauth(f) { const c=await api('/reauthChallenge',{},f.token); assert.equal(c.status,200); const r=await api('/reauth',{reauthId:c.data.reauthId,password:'oldpass'},f.token); assert.equal(r.status,200); return c.data.reauthId; }
  await t.test('new phone only creates store after consent and explicit single-use register, concurrent requests create one', async()=>{
    const p=phone(), c=await send(p); const before=await db.store.count();
    const v=await api('/login',{challengeId:c.challengeId,code:'123456'}); assert.equal(v.status,200); assert.equal(v.data.registrationRequired,true); assert.equal(await db.store.count(),before);
    assert.equal((await api('/register',{registrationToken:v.data.registrationToken,realName:'New',consent:true})).status,400);
    const results=await Promise.all(Array.from({length:4},()=>api('/register',{registrationToken:v.data.registrationToken,realName:'New',consent:true,createStore:true})));
    assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results)); assert.equal(await db.store.count(),before+1);
    assert.equal(await db.phoneIdentity.count({where:{phone:p}}),1);
    assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,401);
    const next=await send('+86'+p); const r=await api('/login',{challengeId:next.challengeId,code:'123456'}); assert.equal(r.data.user.id,results.find(r=>r.status===200).data.user.id);
  });
  await t.test('fresh password proof and phone proof bind old staff without changing account/store/role; editable contact not trusted',async()=>{
    const f=await fixture(), p=phone(); await db.user.update({where:{id:f.user.id},data:{phone:p}});
    await relax(); assert.equal((await api('/send',{phone:p,purpose:'reset',consent:true})).status,400);
    assert.equal((await api('/send',{phone:p,purpose:'bind',consent:true},f.token)).status,400);
    const rid=await reauth(f), c=await send(p,'bind',{reauthId:rid},f.token);
    assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,401);
    const other=await fixture(); assert.equal((await api('/bind',{challengeId:c.challengeId,code:'123456'},other.token)).status,401);
    assert.equal((await api('/bind',{challengeId:c.challengeId,code:'123456'},f.token)).status,200);
    const c2=await send(p), r=await api('/login',{challengeId:c2.challengeId,code:'123456'}); assert.equal(r.data.user.id,f.user.id);assert.equal(r.data.user.role,'staff');
    assert.equal((await db.user.findUnique({where:{id:f.user.id}})).storeId,f.store.id);
    const conflict=await send(p,'bind',{reauthId:await reauth(other)},other.token); assert.equal((await api('/bind',{challengeId:conflict.challengeId,code:'123456'},other.token)).status,409);
    assert.equal((await db.phoneIdentity.findUnique({where:{phone:p}})).userId,f.user.id);
    const reset=await send(p,'reset'); const resetResult=await api('/resetPassword',{challengeId:reset.challengeId,code:'123456',newPassword:'newpass'}); assert.equal(resetResult.status,200);
    assert.equal((await api('/protected',null,f.token)).status,401); assert.equal((await api('/protected',null,r.data.token)).status,401);
    assert.equal(await bcrypt.compare('newpass',(await db.user.findUnique({where:{id:f.user.id}})).passwordHash),true);
  });
  await t.test('wrong code limit, expiry, cross purpose, concurrent checks and uncertain PASS failures burn grants', async()=>{
    let c=await send(phone()); verdict=false; const start=checks;
    for(let i=0;i<5;i++) assert.equal((await api('/login',{challengeId:c.challengeId,code:'000000'})).status,400);
    assert.equal((await api('/login',{challengeId:c.challengeId,code:'000000'})).status,401);assert.equal(checks-start,5);verdict=true;
    c=await send(phone());await db.smsChallenge.update({where:{id:c.challengeId},data:{expiresAt:new Date(0)}});assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,401);
    c=await send(phone());const concurrent=await Promise.all(Array.from({length:4},()=>api('/login',{challengeId:c.challengeId,code:'123456'})));assert.equal(concurrent.filter(r=>r.status===200).length,1,JSON.stringify(concurrent));
    c=await send(phone());checkFailure=true;assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,503);checkFailure=false;assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,401);
    const f=await fixture(), p=phone();await db.phoneIdentity.create({data:{phone:p,userId:f.user.id}});c=await send(p);await db.user.update({where:{id:f.user.id},data:{status:0}});assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,403);assert.equal((await api('/login',{challengeId:c.challengeId,code:'123456'})).status,401);
  });
  await t.test('fresh nonce-bound Apple proof must match current identity; stale versions cannot bind',async()=>{
    const crypto=require('crypto');const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
    const jwk={...publicKey.export({format:'jwk'}),kid:'sms-apple',alg:'RS256'};const savedFetch=global.fetch;
    global.fetch=(url,options)=>String(url)==='https://appleid.apple.com/auth/keys'?Promise.resolve({ok:true,json:async()=>({keys:[jwk]})}):savedFetch(url,options);
    try {
      const f=await fixture();await db.authIdentity.create({data:{userId:f.user.id,provider:'apple',openId:'sms-apple-owner'}});
      const c=await api('/reauthChallenge',{},f.token);
      const apple=(nonce,sub='sms-apple-owner')=>jwt.sign({nonce,sub,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,aud:'com.carey.stockmate',iss:'https://appleid.apple.com'},privateKey,{algorithm:'RS256',keyid:'sms-apple'});
      assert.equal((await api('/reauth',{reauthId:c.data.reauthId,identityToken:apple('wrong')},f.token)).status,401);
      assert.equal((await api('/reauth',{reauthId:c.data.reauthId,identityToken:apple(c.data.nonce,'other')},f.token)).status,401);
      assert.equal((await api('/reauth',{reauthId:c.data.reauthId,identityToken:apple(c.data.nonce)},f.token)).status,200);
      const challenge=await send(phone(),'bind',{reauthId:c.data.reauthId},f.token);
      await db.user.update({where:{id:f.user.id},data:{sessionVersion:{increment:1}}});
      assert.equal((await api('/bind',{challengeId:challenge.challengeId,code:'123456'},f.token)).status,401);
      const fresh=jwt.sign({userId:f.user.id,sessionVersion:1},process.env.JWT_SECRET);
      assert.equal((await api('/bind',{challengeId:challenge.challengeId,code:'123456'},fresh)).status,401);
      assert.equal(await db.phoneIdentity.count({where:{userId:f.user.id}}),0);
    }finally{global.fetch=savedFetch;}
  });
  await t.test('provider PASS followed by local bind transaction failure cannot be replayed or log phone',async()=>{
    const f=await fixture(), p=phone(), c=await send(p,'bind',{reauthId:await reauth(f)},f.token);
    await db.$executeRawUnsafe(`CREATE TRIGGER sms_fail_insert BEFORE INSERT ON PhoneIdentity BEGIN SELECT RAISE(ABORT, 'synthetic local failure'); END`);
    const saved=console.error,logs=[];console.error=(...args)=>logs.push(args.map(String).join(' '));
    try{const r=await api('/bind',{challengeId:c.challengeId,code:'123456'},f.token);assert.equal(r.status,500);assert.equal(await db.phoneIdentity.count({where:{userId:f.user.id}}),0);assert.equal((await api('/bind',{challengeId:c.challengeId,code:'123456'},f.token)).status,401);assert.deepEqual(logs,[],'Unexpected SMS database errors must not log raw sensitive invocation details');}
    finally{console.error=saved;await db.$executeRawUnsafe('DROP TRIGGER sms_fail_insert');}
  });
  await t.test('send cooldown and failed sends reserve persistent quota with retryAfter',async()=>{
    const p=phone();await relax();sendFailure=true;const first=await api('/send',{phone:p,purpose:'login',consent:true});assert.equal(first.status,503);sendFailure=false;
    const count=sends, r=await api('/send',{phone:p,purpose:'login',consent:true});assert.equal(r.status,429);assert.ok(r.data.retryAfter>0);assert.equal(sends,count);
    assert.ok(await db.smsRateBucket.count()>0);
  });
  await t.test('crossing daily quota boundary never bypasses outstanding send cooldown',async()=>{
    const p=phone();await send(p);
    await db.smsRateBucket.updateMany({data:{expiresAt:new Date(Date.now()-1)}});
    assert.equal((await api('/send',{phone:p,purpose:'login',consent:true})).status,429);
  });

});
