const { z } = require('zod');
const { ok } = require('../utils/response');
const { httpError } = require('../utils/biz');
const { basePrisma } = require('../config/prisma');
const { auth } = require('../middlewares/auth');
const { createProvider } = require('../services/sms/provider');
const { createService } = require('../services/sms/service');
const proof = z.object({ challengeId:z.string().uuid(), code:z.string().regex(/^\d{6}$/,'请输入六位验证码') }).strict();
const sendSchema=z.object({phone:z.string().min(1).max(24),purpose:z.enum(['login','bind','reset']),consent:z.literal(true),reauthId:z.string().uuid().optional()}).strict().superRefine((v,ctx)=>{if(v.purpose==='bind'&&!v.reauthId)ctx.addIssue({code:z.ZodIssueCode.custom,message:'请先重新验证当前身份',path:['reauthId']});});
const registerSchema=z.object({registrationToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),createStore:z.literal(true),consent:z.literal(true),realName:z.string().trim().min(1).max(30)}).strict();
const reauthSchema=z.object({reauthId:z.string().uuid(),password:z.string().min(1).max(128).optional(),identityToken:z.string().min(10).max(16384).optional()}).strict().refine(v=>!!v.password !== !!v.identityToken,'请选择一种身份验证方式');
function createController({db=basePrisma,provider=createProvider()}={}) {
  const service=createService({db,provider});
  const call=(schema,method,withActor=false)=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {return ok(res,await service[method](schema.parse(req.body),withActor?req.user:undefined,req.ip||req.socket.remoteAddress||'unknown'));}
    catch(e){if(e.status===429){res.set('Retry-After',String(e.retryAfter));return res.status(429).json({code:429,message:e.message,data:{retryAfter:e.retryAfter}});}if(e.status||e instanceof z.ZodError)throw e;throw httpError(500,'验证未完成，请重新获取验证码或稍后重试');}
  };
  return {
    capabilities:(_req,res)=>{res.set('Cache-Control','no-store');return ok(res,{enabled:provider.enabled(),registrationEnabled:process.env.ALLOW_REGISTRATION!=='false',countryCode:'86',codeLength:6,expiresIn:300,resendAfter:60,bindingEnabled:true,rebindingEnabled:false});},
    send:call(sendSchema,'send',true),login:call(proof,'login'),register:call(registerSchema,'register'),bind:call(proof,'bind',true),
    resetPassword:call(proof.extend({newPassword:z.string().min(6,'新密码至少六位').max(128)}),'resetPassword'),
    reauth:call(reauthSchema,'reauth',true),
    reauthChallenge:async(req,res)=>{z.object({}).strict().parse(req.body);res.set('Cache-Control','no-store');return ok(res,await service.reauthChallenge(req.user));},
  };
}
module.exports={...createController(),createController,sendAuth:(req,res,next)=>req.body?.purpose==='bind'?auth(req,res,next):next()};
