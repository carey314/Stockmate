process.env.JWT_SECRET='sms-lifecycle-isolated';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const crypto=require('crypto');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');
test('all credential mutation paths revoke sessions and sensitive grants; deletion removes identity',async t=>{
 const file=useIsolatedDb(`sms-lifecycle-${process.pid}`);
 const db=require('../src/config/prisma').basePrisma;
 const express=require('express');const app=express();app.use(express.json());app.use('/api/v1',require('../src/routes'));app.use(require('../src/middlewares/errorHandler'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await db.$disconnect();dropIsolatedDb(file);});
 async function api(path,body,token,method=body?'POST':'GET'){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,...await r.json()};}
 let seq=0;async function fixture(storeId,role='admin'){
   const store=storeId?{id:storeId}:await db.store.create({data:{name:'Lifecycle shop'}});
   const user=await db.user.create({data:{storeId:store.id,username:`lifecycle_${++seq}`,realName:'Lifecycle',role,passwordHash:await bcrypt.hash('oldpass',4)}});
   await db.phoneIdentity.create({data:{userId:user.id,phone:`139${String(seq).padStart(8,'0')}`}});
   await db.authIdentity.create({data:{userId:user.id,provider:'apple',openId:`apple_${seq}`}});
   const token=jwt.sign({userId:user.id,sessionVersion:user.sessionVersion},process.env.JWT_SECRET);
   return{store,user,token};
 }
 async function grants(f){const expiresAt=new Date(Date.now()+300000);const code=crypto.randomBytes(24).toString('base64url');
  await db.webLoginCode.create({data:{userId:f.user.id,storeId:f.store.id,appleSub:`apple_${seq}`,codeHash:crypto.createHash('sha256').update(code).digest('hex'),expiresAt,sessionVersion:0}});
  await db.webLoginChallenge.create({data:{userId:f.user.id,storeId:f.store.id,nonceHash:'x',expiresAt,sessionVersion:0}});
  await db.smsReauth.create({data:{userId:f.user.id,storeId:f.store.id,sessionVersion:0,nonceHash:'x',expiresAt}});
  await db.smsChallenge.create({data:{userId:f.user.id,storeId:f.store.id,sessionVersion:0,phone:'13900000000',purpose:'reset',state:'sent',expiresAt}});return code;}
 async function noGrants(f){for(const model of ['webLoginCode','webLoginChallenge','smsReauth','smsChallenge'])assert.equal(await db[model].count({where:{userId:f.user.id}}),0,model);}
 await t.test('own password requires old password, new version rejects old tokens and old bridge',async()=>{
  const f=await fixture(),code=await grants(f);assert.equal((await api('/auth/profile',null,f.token)).data.storeId,f.store.id);
  assert.equal((await api('/auth/password',{oldPassword:'wrong',newPassword:'newpass'},f.token,'PUT')).status,400);
  const result=await api('/auth/password',{oldPassword:'oldpass',newPassword:'newpass'},f.token,'PUT');assert.equal(result.status,200);assert.equal(result.data?.reauthenticate,true);
  assert.equal((await api('/auth/profile',null,f.token)).status,401);await noGrants(f);
  assert.equal((await api('/auth/web-bridge/redeem',{code})).status,401);
  const login=await api('/auth/login',{username:f.user.username,password:'newpass'});assert.equal(login.status,200);assert.equal(jwt.verify(login.data.token,process.env.JWT_SECRET).sessionVersion,1);
 });
 await t.test('admin reset and toggle revoke staff grants, reenabling never resurrects prior tokens',async()=>{
  const owner=await fixture(),staff=await fixture(owner.store.id,'staff');await grants(staff);
  let result=await api(`/system/users/${staff.user.id}/password`,{password:'newstaff'},owner.token,'PUT');assert.equal(result.status,200,JSON.stringify(result));await noGrants(staff);assert.equal((await api('/auth/profile',null,staff.token)).status,401);
  const login=await api('/auth/login',{username:staff.user.username,password:'newstaff'});const fresh={...staff,token:login.data.token};await grants(fresh);
  result=await api(`/system/users/${staff.user.id}/toggle`,{},owner.token,'PUT');assert.equal(result.status,200,JSON.stringify(result));await noGrants(staff);
  assert.equal((await api('/auth/profile',null,fresh.token)).status,401);
  assert.equal((await api(`/system/users/${staff.user.id}/toggle`,{},owner.token,'PUT')).status,200);assert.equal((await api('/auth/profile',null,fresh.token)).status,401);
 });
 await t.test('delete partial and whole store remove phone identities and transient challenges',async()=>{
  for(const whole of [false,true]){const f=await fixture();if(!whole)await fixture(f.store.id,'staff');await grants(f);
   const result=await api('/auth/delete-account',{},f.token);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.shopWiped,whole);
   assert.equal(await db.phoneIdentity.count({where:{userId:f.user.id}}),0);await noGrants(f);assert.equal((await api('/auth/profile',null,f.token)).status,401);
  }
 });
});
