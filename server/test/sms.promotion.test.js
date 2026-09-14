const {test}=require('node:test');const assert=require('node:assert/strict');const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');
test('resend cannot be undone by a late post-PASS registration-ticket promotion',async t=>{
 const file=useIsolatedDb(`sms-promotion-${process.pid}`);const{PrismaClient}=require('@prisma/client');const db=new PrismaClient();t.after(async()=>{await db.$disconnect();dropIsolatedDb(file);});
 const{createService}=require('../src/services/sms/service');const provider={enabled:()=>true,send:async()=>{},check:async()=>true};
 const svc=createService({db,provider});const first=await svc.send({phone:'13800000000',purpose:'login'},null,'198.51.100.1');
 let entered,release;const arrived=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const delayed=new Proxy(db,{get(target,key){if(key!=='phoneIdentity')return Reflect.get(target,key);return new Proxy(target.phoneIdentity,{get(delegate,method){if(method!=='findUnique')return Reflect.get(delegate,method);return async args=>{const result=await delegate.findUnique(args);entered();await gate;return result;};}});}});
 const pending=createService({db:delayed,provider}).login({challengeId:first.challengeId,code:'123456'});const outcome=pending.then(value=>({value}),error=>({error}));
 await arrived;await db.smsRateBucket.updateMany({data:{nextAt:new Date(0)}});await svc.send({phone:'13800000000',purpose:'login'},null,'198.51.100.1');release();
 const result=await outcome;assert.equal(result.error?.status,401,'Late PASS cannot recreate a revoked registration grant');
 assert.equal((await db.smsChallenge.findUnique({where:{id:first.challengeId}})).state,'consumed');
});
