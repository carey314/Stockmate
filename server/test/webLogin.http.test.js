process.env.JWT_SECRET='web-login-isolated-secret';
const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');
test('generic App authorization: separate QR secrets, explicit approval, original user/store and safe retries',async t=>{
 const file=useIsolatedDb(`web-login-${process.pid}`);const prisma=require('../src/config/prisma'),db=prisma.basePrisma;
 const express=require('express');const app=express();app.use(express.json());app.use('/api/v1',require('../src/routes'));app.use((_q,r)=>r.status(404).json({code:404}));app.use(require('../src/middlewares/errorHandler'));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 t.after(async()=>{await new Promise(r=>server.close(r));await prisma.$disconnect();dropIsolatedDb(file);});
 async function api(route,body,bearer){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/web-login${route}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:`Bearer ${bearer}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,...await r.json()};}
 assert.equal((await api('/capabilities')).status,200,'new generic login must be available');
 async function actor(n,role='admin'){const store=await db.store.create({data:{name:`QR store${n}`}});const user=await db.user.create({data:{storeId:store.id,username:`qr${n}`,realName:`QR${n}`,role,passwordHash:'synthetic'}});return{user,bearer:require('../src/services/session').issueJwt(user)};}
 const a=await actor(1,'staff'),b=await actor(2);const secret=()=>crypto.randomBytes(32).toString('base64url');
 async function challenge(){const r=await api('/challenges',{});assert.equal(r.status,200);const c=r.data;const u=new URL(c.qrContent);assert.equal(u.protocol,'stockmate:');assert.equal(u.hostname,'web-login');assert.ok(!c.qrContent.includes(c.browserSecret));return{...c,scanToken:u.searchParams.get('scan')};}
 const browser=c=>({challengeId:c.challengeId,browserSecret:c.browserSecret});const scan=c=>({challengeId:c.challengeId,scanToken:c.scanToken});
 await t.test('scanning never logs browser in, explicit confirmation keeps staff role and same store',async()=>{
  const c=await challenge();assert.equal((await api('/redeem',browser(c))).status,409);
  assert.equal((await api('/scan',scan(c))).status,401);
  assert.equal((await api('/scan',scan(c),a.bearer)).status,200);
  assert.equal((await api('/redeem',browser(c))).status,409);
  assert.equal((await api('/confirm',{...scan(c),approve:true},b.bearer)).status,403);
  assert.equal((await api('/scan',scan(c),b.bearer)).status,403);
  assert.equal((await api('/confirm',{...scan(c),approve:true},a.bearer)).status,200);
  assert.equal((await api('/redeem',{...browser(c),browserSecret:c.scanToken})).status,401);
  const replies=await Promise.all([api('/redeem',browser(c)),api('/redeem',browser(c))]);
  for(const r of replies){assert.equal(r.status,200);assert.equal(r.data.user.id,a.user.id);assert.equal(r.data.user.storeId,a.user.storeId);assert.equal(r.data.user.role,'staff');}
  assert.equal((await api('/cancel',browser(c))).status,409);
  assert.equal((await api('/status',browser(c))).data.state,'redeemed');
 });
 await t.test('no account creation or implicit login from confirmed QR without browser secret',async()=>{
  const c=await challenge();assert.equal((await api('/confirm',{...scan(c),approve:true},a.bearer)).status,409);
  assert.equal((await api('/status',{...browser(c),browserSecret:secret()})).status,401);
  assert.equal((await api('/challenges',{},a.bearer)).status,403);
  assert.equal((await api('/scan',{...scan(c),storeId:b.user.storeId},a.bearer)).status,400);
  assert.equal(await db.store.count(),2);assert.equal(await db.user.count(),2);
 });
 await t.test('cancel and expiry never produce a session',async()=>{
  const c=await challenge();await api('/scan',scan(c),a.bearer);await api('/confirm',{...scan(c),approve:false},a.bearer);
  assert.equal((await api('/status',browser(c))).data.state,'cancelled');assert.equal((await api('/redeem',browser(c))).status,401);
  const d=await challenge();await db.webAccessGrant.update({where:{id:d.challengeId},data:{expiresAt:new Date(0)}});
  assert.equal((await api('/status',browser(d))).data.state,'expired');assert.equal((await api('/scan',scan(d),a.bearer)).status,401);
 });
 await t.test('generic code supports non-Apple App users, binds first browser and recovers only there',async()=>{
  assert.equal((await api('/code',{consent:false},a.bearer)).status,400);
  const r=await api('/code',{consent:true},a.bearer);assert.equal(r.status,200);const body={code:r.data.code,browserSecret:secret()};
  const first=await api('/code/redeem',body);assert.equal(first.status,200);assert.equal(first.data.user.id,a.user.id);
  assert.equal((await api('/code/redeem',{...body,browserSecret:secret()})).status,401);
  assert.equal((await api('/code/redeem',body)).data.user.id,a.user.id);
 });
 await t.test('generation change and cleanup revoke approved QR and pending code',async()=>{
  const c=await challenge();await api('/scan',scan(c),a.bearer);await api('/confirm',{...scan(c),approve:true},a.bearer);
  const code=(await api('/code',{consent:true},a.bearer)).data.code;
  await db.$transaction(async tx=>{await tx.user.update({where:{id:a.user.id},data:{sessionVersion:{increment:1}}});await require('../src/services/session').clearGrants(tx,[a.user.id]);});
  assert.equal((await api('/redeem',browser(c))).status,401);assert.equal((await api('/code/redeem',{code,browserSecret:secret()})).status,401);
 });
});
