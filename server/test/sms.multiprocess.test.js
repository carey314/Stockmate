const {test}=require('node:test');const assert=require('node:assert/strict');const {fork}=require('node:child_process');const path=require('node:path');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');
test('SMS send and verification reservations survive two HTTP processes and process restart',async t=>{
 const file=useIsolatedDb(`sms-multi-${process.pid}`);const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();const workers=[];let sends=0,checks=0;
 async function start(){const child=fork(path.join(__dirname,'helpers/sms-worker.cjs'),[],{env:{...process.env,NODE_OPTIONS:'',JWT_SECRET:'sms-cross-process'},stdio:['ignore','ignore','inherit','ipc']});workers.push(child);const port=await new Promise((resolve,reject)=>{child.on('message',m=>{if(m.event==='send')sends++;if(m.event==='check')checks++;if(m.event==='ready')resolve(m.port);});child.on('error',reject);child.on('exit',code=>{if(code)reject(Error(`worker exited ${code}`));});});return{child,port};}
 const stop=child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.send('stop');});
 t.after(async()=>{await Promise.all(workers.map(stop));await db.$disconnect();dropIsolatedDb(file);});
 const a=await start(),b=await start();
 const api=async(worker,route,body,ip='198.51.100.10')=>{const r=await fetch(`http://127.0.0.1:${worker.port}/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify(body)});return{status:r.status,...await r.json()};};
 const send={phone:'13800000000',purpose:'login',consent:true};
 const results=await Promise.all([api(a,'send',send),api(b,'send',send)]);assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.status===429).length,1);assert.equal(sends,1);
 const challengeId=results.find(r=>r.status===200).data.challengeId;
 const verify={challengeId,code:'000000'};const checked=await Promise.all([api(a,'login',verify),api(b,'login',verify)]);assert.equal(checked.filter(r=>r.status===400).length,1);assert.equal(checked.filter(r=>r.status===401).length,1);assert.equal(checks,1);
 await stop(a.child);const restarted=await start();assert.equal((await api(restarted,'send',send)).status,429);assert.equal(sends,1);
 for(let i=0;i<4;i++)assert.equal((await api(restarted,'login',verify)).status,400);assert.equal((await api(b,'login',verify)).status,401);assert.equal(checks,5);
 // Real proxy interpretation: separate clients do not share the IP cooldown;
 // prepending forged identities to the real client does not reset its bucket.
 assert.equal((await api(b,'send',{...send,phone:'13800000001'},'198.51.100.11')).status,200);
 assert.equal((await api(restarted,'send',{...send,phone:'13800000002'},'203.0.113.9, 198.51.100.11')).status,429);
 // Remove cooldown only to exercise persisted daily ceilings without waiting.
 for(let i=0;i<4;i++){await db.smsRateBucket.updateMany({data:{nextAt:new Date(0)}});assert.equal((await api(b,'send',send)).status,200);}
 await db.smsRateBucket.updateMany({data:{nextAt:new Date(0)}});const capped=await api(restarted,'send',send);assert.equal(capped.status,429);assert.ok(capped.data.retryAfter>60);
});
