process.env.JWT_SECRET='registration-metrics-test-only';process.env.ALLOW_REGISTRATION='true';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');const crypto=require('node:crypto');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');const file=useIsolatedDb(`metrics-registration-${process.pid}`);
const prisma=require('../src/config/prisma'),{basePrisma:db}=prisma;const express=require('express');const {auth,adminOnly}=require('../src/middlewares/auth');const {wrap}=require('../src/utils/response');
const app=express();app.use(express.json());app.post('/register',wrap(require('../src/controllers/auth').register));app.post('/staff',auth,adminOnly,wrap(require('../src/controllers/system').createStaff));app.use(require('../src/middlewares/errorHandler'));
let server;
before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});});
after(async()=>{await new Promise(r=>server.close(r));await prisma.$disconnect();dropIsolatedDb(file);});
const api=async(path,body,token)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
test('密码注册和员工创建同事务记录真实source，资料不进入事件',async()=>{
 const owner=await api('/register',{username:'newowner',password:'SECRET_PASSWORD',realName:'真实来源店'});assert.equal(owner.status,200);
 const event=await db.platformEvent.findUnique({where:{eventKey:`registration:${owner.data.user.id}`}});assert.ok(event);assert.equal(event.source,'password');assert.equal(event.kind,'registration');assert.equal(event.metadata,null);
 const staff=await api('/staff',{username:'newstaff',password:'SECRET_STAFF',realName:'员工',phone:'13800000099'},owner.data.token);assert.equal(staff.status,201);
 const staffEvent=await db.platformEvent.findUnique({where:{eventKey:`registration:${staff.data.id}`}});assert.equal(staffEvent.source,'staff');assert.equal(staffEvent.storeId,event.storeId);
 assert.ok(!JSON.stringify(await db.platformEvent.findMany()).includes('SECRET_'));
 const metrics=require('../src/services/platformMetrics');const result=await metrics.users({query:'newowner'});assert.equal(result.list[0].registrationSource,'password');const overview=await metrics.overview({});assert.equal(overview.registrationSources.password,1);assert.equal(overview.registrationSources.staff,1);
});
test('Apple新账号和SMS单次注册记录真实来源，重登不新增或覆盖来源',async()=>{
 const apple=require('../src/services/appleLogin').createService({db});const first=await apple.legacyLogin({sub:'SECRET_SUBJECT',name:'Apple店',email:'SECRET_EMAIL'});const again=await apple.legacyLogin({sub:'SECRET_SUBJECT',name:'Apple店',email:'SECRET_EMAIL'});assert.equal(first.user.id,again.user.id);
 const appleEvents=await db.platformEvent.findMany({where:{userId:first.user.id,kind:'registration'}});assert.equal(appleEvents.length,1);assert.equal(appleEvents[0].source,'apple');
 const registrationToken=crypto.randomBytes(32).toString('base64url');await db.smsChallenge.create({data:{phone:'13800000088',purpose:'login',state:'register',registrationHash:crypto.createHash('sha256').update(registrationToken).digest('hex'),expiresAt:new Date(Date.now()+60000)}});
 const sms=require('../src/services/sms/service').createService({db,provider:{}});const registered=await sms.register({registrationToken,realName:'SMS店'});
 const event=await db.platformEvent.findUnique({where:{eventKey:`registration:${registered.user.id}`}});assert.equal(event.source,'sms');assert.equal(event.metadata,null);
 await assert.rejects(sms.register({registrationToken,realName:'SMS店'}));assert.equal(await db.platformEvent.count({where:{userId:registered.user.id,kind:'registration'}}),1);
});
test('事件写入失败回滚建店和用户，不留下来源缺失的半注册',async()=>{
 const stores=await db.store.count(),users=await db.user.count();await db.$executeRawUnsafe("CREATE TRIGGER registration_fail BEFORE INSERT ON PlatformEvent WHEN NEW.kind='registration' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 try{const r=await api('/register',{username:'rollbackowner',password:'SECRET_PASSWORD',realName:'回滚店'});assert.equal(r.status,503);assert.equal(await db.store.count(),stores);assert.equal(await db.user.count(),users);}finally{await db.$executeRawUnsafe('DROP TRIGGER registration_fail');}
});
