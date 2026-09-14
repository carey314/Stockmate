const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { httpError } = require('../../utils/biz');
const { issueJwt, sessionMatches, clearGrants } = require('../session');
const { verifyAppleToken } = require('../../utils/appleAuth');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stale = () => httpError(401, '验证已失效，请重新获取验证码');
const unavailable = () => httpError(503, '短信服务暂不可用，请稍后重试或使用原登录方式');
const mask = phone => phone ? `${phone.slice(0,3)}****${phone.slice(-4)}` : null;
function normalizePhone(value) {
  let phone = value.trim().replace(/[ -]/g, '');
  if (phone.startsWith('+86')) phone = phone.slice(3);
  else if (phone.length === 13 && phone.startsWith('86')) phone = phone.slice(2);
  if (!/^1[3-9]\d{9}$/.test(phone)) throw httpError(400, '目前仅支持中国大陆手机号');
  return phone;
}
const publicUser = user => ({ id: user.id, storeId: user.storeId, username: user.username, realName: user.realName, role: user.role });
function createService({ db, provider, env = process.env }) {
  async function active(tx, userId, version, storeId) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 1) throw httpError(403, '账号已被停用或注销');
    if ((version !== undefined && version !== null && user.sessionVersion !== version) || (storeId && user.storeId !== storeId)) throw stale();
    if (!await tx.store.findUnique({ where: { id: user.storeId } })) throw stale();
    return user;
  }
  async function cleanup() {
    const now = new Date();
    await db.smsChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
    await db.smsReauth.deleteMany({ where: { expiresAt: { lt: now } } });
    await db.smsRateBucket.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime()-60000) } } });
  }
  function limit(key, fallback) { const n=Number(env[key]); return Number.isInteger(n)&&n>0 ? Math.min(n,fallback) : fallback; }
  async function quota(tx, phone, purpose, ip, now) {
    const day=now.toISOString().slice(0,10), end=new Date(`${day}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
    const definitions=[
      ['phone',phone,60,limit('PNVS_PHONE_DAY_LIMIT',10)],
      [`phone:${purpose}`,phone,60,limit('PNVS_PHONE_PURPOSE_DAY_LIMIT',5)],
      ['ip',ip,2,limit('PNVS_IP_DAY_LIMIT',100)],
      [`ip:${purpose}`,ip,2,limit('PNVS_IP_PURPOSE_DAY_LIMIT',50)],
    ];
    for(const [scope,value,cooldown,max] of definitions) {
      const key=hash(`${scope}:${value}`);
      // First transaction statement writes: serializes cross-process reservations.
      const row=await tx.smsRateBucket.upsert({where:{key},create:{key,count:0,nextAt:new Date(0),expiresAt:end},update:{count:{increment:0}}});
      const count=row.expiresAt<=now?0:row.count;
      const wait=count>=max ? end.getTime()-now.getTime() : row.nextAt.getTime()-now.getTime();
      if(wait>0) throw Object.assign(httpError(429,'验证码请求过于频繁，请稍后重试'),{retryAfter:Math.max(1,Math.ceil(wait/1000))});
      await tx.smsRateBucket.update({where:{key},data:{count:count+1,nextAt:new Date(now.getTime()+cooldown*1000),expiresAt:end}});
    }
  }
  async function send({ phone:raw, purpose, reauthId }, actor, ip) {
    if(!provider.enabled()) throw unavailable();
    const phone=normalizePhone(raw);await cleanup();const now=new Date();
    const row=await db.$transaction(async tx=>{
      await quota(tx,phone,purpose,ip,now);
      let userId=null,sessionVersion=null,storeId=null,identityId=null;
      if(purpose==='bind') {
        if(!actor) throw stale();
        const user=await active(tx,actor.userId,actor.sessionVersion ?? 0,actor.storeId);
        const proof=await tx.smsReauth.updateMany({where:{id:reauthId,userId:user.id,sessionVersion:user.sessionVersion,storeId:user.storeId,verifiedAt:{not:null},usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
        if(proof.count!==1) throw stale();
        if(await tx.phoneIdentity.findUnique({where:{userId:user.id}})) throw httpError(409,'账号已绑定手机号，暂不支持换绑');
        userId=user.id;sessionVersion=user.sessionVersion;storeId=user.storeId;
      } else {
        const identity=await tx.phoneIdentity.findUnique({where:{phone},include:{user:true}});
        if(purpose==='reset'&&!identity) throw httpError(400,'请使用已绑定账号的手机号，或先用原方式登录并绑定');
        if(identity) { const user=await active(tx,identity.userId);userId=user.id;sessionVersion=user.sessionVersion;storeId=user.storeId;identityId=identity.id; }
      }
      await tx.smsChallenge.updateMany({where:{phone,purpose,state:{not:'consumed'}},data:{state:'consumed',registrationHash:null}});
      return tx.smsChallenge.create({data:{phone,purpose,userId,sessionVersion,storeId,identityId,state:'sending',expiresAt:new Date(now.getTime()+300000)}});
    });
    try { await provider.send({phone,purpose,id:row.id}); }
    catch { await db.smsChallenge.updateMany({where:{id:row.id},data:{state:'consumed'}});throw unavailable(); }
    const accepted=await db.smsChallenge.updateMany({where:{id:row.id,state:'sending',expiresAt:{gt:new Date()}},data:{state:'sent'}});
    if(accepted.count!==1) throw stale();
    return {challengeId:row.id,expiresAt:row.expiresAt,resendAfter:60,phoneMasked:mask(phone)};
  }
  async function verify(challengeId, code, purpose, actor) {
    const row=await db.smsChallenge.findUnique({where:{id:challengeId}});
    if(!row||row.purpose!==purpose||row.state!=='sent'||row.expiresAt<=new Date()||row.attempts>=5) throw stale();
    if(purpose==='bind'&&(!actor||row.userId!==actor.userId||row.storeId!==actor.storeId||row.sessionVersion!==(actor.sessionVersion??0))) throw stale();
    const claim=await db.smsChallenge.updateMany({where:{id:row.id,state:'sent',attempts:{lt:5},expiresAt:{gt:new Date()}},data:{state:'checking',attempts:{increment:1}}});
    if(claim.count!==1) throw stale();
    let pass;
    try {pass=await provider.check({phone:row.phone,purpose,code});}
    catch {await db.smsChallenge.updateMany({where:{id:row.id,state:'checking'},data:{state:'consumed'}});throw unavailable();}
    const finished=await db.smsChallenge.updateMany({where:{id:row.id,state:'checking',expiresAt:{gt:new Date()}},data:{state:pass?'verified':'sent'}});
    if(finished.count!==1) throw stale();
    if(!pass) throw httpError(400,'验证码错误或已失效');
    return row; // PASS leaves a terminal verified state; only a conditional business claim may promote it, never another provider check.
  }
  async function consumeVerified(tx,row) {
    const claim=await tx.smsChallenge.updateMany({where:{id:row.id,state:'verified',expiresAt:{gt:new Date()}},data:{state:'consumed'}});
    if(claim.count!==1)throw stale();
  }
  async function matchedIdentity(tx,row) {
    const identity=await tx.phoneIdentity.findUnique({where:{phone:row.phone}});
    if(!identity||identity.id!==row.identityId||identity.userId!==row.userId) throw stale();
    return active(tx,row.userId,row.sessionVersion,row.storeId);
  }
  async function login({challengeId,code}) {
    const row=await verify(challengeId,code,'login');
    if(row.userId) {
      const user=await db.$transaction(async tx=>{await consumeVerified(tx,row);return matchedIdentity(tx,row);});
      return {token:issueJwt(user),user:publicUser(user)};
    }
    if(await db.phoneIdentity.findUnique({where:{phone:row.phone}})) throw stale();
    const token=crypto.randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+300000);
    const promoted=await db.smsChallenge.updateMany({where:{id:row.id,state:'verified',expiresAt:{gt:new Date()}},data:{state:'register',registrationHash:hash(token),expiresAt}});
    if(promoted.count!==1)throw stale();
    return {registrationRequired:true,registrationToken:token,expiresAt};
  }
  async function register({registrationToken,realName}) {
    if(env.ALLOW_REGISTRATION==='false') throw httpError(403,'注册暂未开放');
    const passwordHash=await bcrypt.hash(crypto.randomBytes(32).toString('hex'),10);
    try {
      const user=await db.$transaction(async tx=>{
        const now=new Date(); const claimed=await tx.smsChallenge.updateMany({where:{registrationHash:hash(registrationToken),state:'register',purpose:'login',expiresAt:{gt:now}},data:{state:'consumed'}});
        if(claimed.count!==1) throw stale();
        const row=await tx.smsChallenge.findUnique({where:{registrationHash:hash(registrationToken)}});
        if(await tx.phoneIdentity.findUnique({where:{phone:row.phone}})) throw httpError(409,'手机号已绑定账号，请重新登录');
        const store=await tx.store.create({data:{name:realName}});
        const u=await tx.user.create({data:{storeId:store.id,username:`phone_${crypto.randomBytes(12).toString('hex')}`,passwordHash,realName,role:'admin'}});
        await tx.phoneIdentity.create({data:{userId:u.id,phone:row.phone}});
        await require('../metricsContext').recordRegistration(tx,u,'sms');
        await tx.smsChallenge.delete({where:{id:row.id}});
        return u;
      });
      return {token:issueJwt(user),user:publicUser(user)};
    } catch(e) {if(e.code==='P2002')throw httpError(409,'手机号已绑定账号，请重新登录');throw e;}
  }
  async function bind(data,actor) {
    const row=await verify(data.challengeId,data.code,'bind',actor);
    try {await db.$transaction(async tx=>{
      await consumeVerified(tx,row);
      // Obtain write lock before identity checks, serialize delete/disable/other binds.
      const lock=await tx.user.updateMany({where:{id:row.userId,status:1,sessionVersion:row.sessionVersion,storeId:row.storeId},data:{sessionVersion:{increment:0}}});
      if(lock.count!==1)throw stale();
      await active(tx,row.userId,row.sessionVersion,row.storeId);
      if(await tx.phoneIdentity.findFirst({where:{OR:[{phone:row.phone},{userId:row.userId}]}}))throw httpError(409,'手机号或账号已绑定，不能合并或换绑');
      await tx.phoneIdentity.create({data:{phone:row.phone,userId:row.userId}});
    });}catch(e){if(e.code==='P2002')throw httpError(409,'手机号已被绑定');throw e;}
    return {phoneBound:true,phoneMasked:mask(row.phone)};
  }
  async function resetPassword({challengeId,code,newPassword}) {
    const passwordHash=await bcrypt.hash(newPassword,10);
    const row=await verify(challengeId,code,'reset');
    await db.$transaction(async tx=>{
      await consumeVerified(tx,row);
      const claim=await tx.user.updateMany({where:{id:row.userId,storeId:row.storeId,status:1,sessionVersion:row.sessionVersion},data:{passwordHash,sessionVersion:{increment:1}}});
      if(claim.count!==1)throw stale();
      await matchedIdentity(tx,{...row,sessionVersion:row.sessionVersion+1});
      await clearGrants(tx,[row.userId]);
    });
    return {reset:true,reauthenticate:true};
  }
  async function reauthChallenge(actor) {
    const user=await active(db,actor.userId,actor.sessionVersion??0,actor.storeId);
    const nonce=crypto.randomBytes(32).toString('base64url'), expiresAt=new Date(Date.now()+300000);
    await db.smsReauth.deleteMany({where:{userId:user.id}});
    const row=await db.smsReauth.create({data:{userId:user.id,storeId:user.storeId,sessionVersion:user.sessionVersion,nonceHash:hash(nonce),expiresAt}});
    return {reauthId:row.id,nonce,expiresAt};
  }
  async function reauth({reauthId,password,identityToken},actor) {
    const row=await db.smsReauth.findUnique({where:{id:reauthId}});
    if(!row||row.userId!==actor.userId||row.storeId!==actor.storeId||row.sessionVersion!==(actor.sessionVersion??0)||row.expiresAt<=new Date()||row.verifiedAt||row.usedAt||row.attempts>=5)throw stale();
    const claim=await db.smsReauth.updateMany({where:{id:row.id,attempts:row.attempts,verifiedAt:null,usedAt:null,expiresAt:{gt:new Date()}},data:{attempts:{increment:1}}});
    if(claim.count!==1)throw stale();
    const user=await active(db,row.userId,row.sessionVersion,row.storeId);
    if(password!==undefined) {if(!await bcrypt.compare(password,user.passwordHash))throw httpError(401,'当前密码错误');}
    else {
      const {sub}=await verifyAppleToken(identityToken,{nonceHash:row.nonceHash,maxAgeSeconds:300});
      if(!await db.authIdentity.findFirst({where:{userId:user.id,provider:'apple',openId:sub}}))throw httpError(401,'Apple 身份与当前账号不符');
    }
    await db.$transaction(async tx=>{
      const done=await tx.smsReauth.updateMany({where:{id:row.id,verifiedAt:null,usedAt:null,expiresAt:{gt:new Date()}},data:{verifiedAt:new Date()}});
      if(done.count!==1)throw stale();await active(tx,user.id,row.sessionVersion,row.storeId);
    });
    return {reauthId:row.id,expiresAt:row.expiresAt};
  }
  return {send,login,register,bind,resetPassword,reauthChallenge,reauth};
}
module.exports={createService,normalizePhone,mask};
