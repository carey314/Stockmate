process.env.JWT_SECRET='sk2-isolated';process.env.APPLE_APP_ID='1234';delete process.env.APPLE_SHARED_SECRET;
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stockmate-sk2-certs-'));
const openssl=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
for(const name of ['root','intermediate','leaf'])openssl('ecparam','-name','prime256v1','-genkey','-noout','-out',`${name}.key`);
openssl('req','-new','-x509','-key','root.key','-out','root.pem','-days','2','-subj','/CN=Stockmate Synthetic Root');
fs.writeFileSync(path.join(dir,'intermediate.ext'),'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=DER:05:00\n');
fs.writeFileSync(path.join(dir,'leaf.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=DER:05:00\n');
for(const [name,parent] of [['intermediate','root'],['leaf','intermediate']]){
 openssl('req','-new','-key',`${name}.key`,'-out',`${name}.csr`,'-subj',`/CN=Stockmate Synthetic ${name}`);
 openssl('x509','-req','-in',`${name}.csr`,'-CA',`${parent}.pem`,'-CAkey',`${parent}.key`,'-CAcreateserial','-out',`${name}.pem`,'-days','2','-extfile',`${name}.ext`);
}
for(const name of ['root','intermediate','leaf'])openssl('x509','-in',`${name}.pem`,'-outform','DER','-out',`${name}.der`);
const root=fs.readFileSync(path.join(dir,'root.der'));
const jwt=require('jsonwebtoken');
const x5c=['leaf','intermediate','root'].map(name=>fs.readFileSync(path.join(dir,`${name}.der`)).toString('base64'));
const key=fs.readFileSync(path.join(dir,'leaf.key'));
const signed=require('../src/utils/appleSignedData');
const pinnedVerify=signed.verifyAppleSignedTransaction;
const syntheticVerifier=signed.createSignedVerifier({roots:[root],onlineChecks:false});
signed.verifyAppleSignedTransaction=value=>syntheticVerifier(value,(verifier,payload)=>verifier.verifyAndDecodeTransaction(payload));
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');const file=useIsolatedDb(`sk2-http-${process.pid}`);
const {basePrisma:db}=require('../src/config/prisma');const express=require('express');
const app=express();app.use(express.json());app.use('/api/v1',require('../src/routes'));app.use(require('../src/middlewares/errorHandler'));let server,seq=0;
before(async()=>server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}));
after(async()=>{await new Promise(resolve=>server.close(resolve));await db.$disconnect();dropIsolatedDb(file);fs.rmSync(dir,{recursive:true,force:true});});
const product='com.carey.stockmate.pro.monthly';
const payload=(patch={})=>({bundleId:'com.carey.stockmate',environment:'Production',transactionId:'sk2-1',originalTransactionId:'sk2-chain',productId:product,purchaseDate:Date.now()-1000,expiresDate:Date.now()+86400000,signedDate:Date.now(),type:'Auto-Renewable Subscription',...patch});
const sign=info=>jwt.sign(info,key,{algorithm:'ES256',noTimestamp:true,header:{x5c}});
async function account(){const store=await db.store.create({data:{name:'SK2合成店'}});const user=await db.user.create({data:{storeId:store.id,username:`sk2-${++seq}`,realName:'测试',passwordHash:'unused',role:'admin'}});return {...user,token:jwt.sign({userId:user.id,sessionVersion:0},process.env.JWT_SECRET)};}
async function redeem(who,receipt,transactionId='sk2-1',productId=product){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/me/entitlement/apple`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${who.token}`},body:JSON.stringify({receipt,transactionId,productId})});return {status:r.status,...await r.json()};}
test('SK2真实合成ES256证书链通过HTTP绑定/恢复/跨店拒绝，独立于legacy共享密钥',async()=>{
 const a=await account(),b=await account(),receipt=sign(payload());
 const first=await redeem(a,receipt);assert.equal(first.status,200,first.message);assert.equal(first.data.transaction.storeId,a.storeId);assert.equal(first.data.transaction.status,'active');
 assert.equal((await redeem(a,receipt)).data.transaction.ownership,'restored');
 assert.equal((await redeem(b,receipt)).status,409);assert.equal(await db.entitlement.count({where:{externalId:'sk2-chain'}}),1);
 const renewed=await redeem(a,sign(payload({transactionId:'sk2-2',purchaseDate:Date.now()+1000,expiresDate:Date.now()+172800000})),'sk2-2');assert.equal(renewed.data.transaction.latestTransactionId,'sk2-2');
});
test('SK2篡改/错误应用环境商品选择器被真实验签或业务核验拒绝，官方根拒绝合成链',async()=>{
 const a=await account(),receipt=sign(payload({originalTransactionId:'invalid-chain'}));
 const parts=receipt.split('.');parts[1]=Buffer.from(JSON.stringify(payload({productId:'fake'}))).toString('base64url');
 assert.equal((await redeem(a,parts.join('.'))).status,400);
 for(const patch of [{bundleId:'another.app'},{environment:'Xcode'},{productId:'other.product'},{expiresDate:1e100}])assert.equal((await redeem(a,sign(payload(patch)))).status,400);
 assert.equal((await redeem(a,receipt,'wrong-id')).status,400);
 await assert.rejects(()=>pinnedVerify(receipt),e=>e.status===400);
 assert.equal(await db.entitlement.count({where:{storeId:a.storeId}}),0);
});
test('SK2签名中的退款和到期为失效状态，缺正式App ID明确503',async()=>{
 const a=await account();
 const r=await redeem(a,sign(payload({originalTransactionId:'refunded-sk2',revocationDate:Date.now()-100})));assert.equal(r.status,200);assert.equal(r.data.transaction.status,'refunded');assert.equal(r.data.plan,'free');
 const expired=await redeem(a,sign(payload({originalTransactionId:'expired-sk2',expiresDate:Date.now()-100})));assert.equal(expired.data.transaction.status,'expired');
 delete process.env.APPLE_APP_ID;try{assert.equal((await redeem(a,sign(payload()))).status,503);}finally{process.env.APPLE_APP_ID='1234';}
});
