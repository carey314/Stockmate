process.env.JWT_SECRET='metrics-ai-isolated';process.env.DEEPSEEK_API_KEY='synthetic-provider-key';
process.env.FREE_AI_DAILY_CORE='0';process.env.FREE_AI_DAILY_OTHER='0';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {useIsolatedDb,dropIsolatedDb}=require('./helpers/db');const file=useIsolatedDb(`platform-ai-${process.pid}`);
const prisma=require('../src/config/prisma'),{basePrisma,runWithTenant}=prisma;
const express=require('express'),jwt=require('jsonwebtoken');const {auth}=require('../src/middlewares/auth');
const {aiMeter}=require('../src/middlewares/aiMeter');const {callDeepSeek}=require('../src/utils/deepseek');
let provider,server,users=[],counts=new Map();
const providerApp=express();providerApp.use(express.json());providerApp.post('/chat/completions',async(req,res)=>{
 const input=req.body.messages.at(-1).content;const count=(counts.get(input)||0)+1;counts.set(input,count);
 if(input.includes('NETWORK')){req.socket.destroy();return;}
 if(input.includes('HTTP'))return res.status(429).json({usage:{prompt_tokens:7},error:{message:'SECRET_PROVIDER_ERROR'}});
 if(input.includes('SLOW'))await new Promise(r=>setTimeout(r,20));
 const usage=input.includes('MISSING')?undefined:{prompt_tokens:100,completion_tokens:20,prompt_cache_hit_tokens:60,prompt_cache_miss_tokens:40,total_tokens:120};
 const content=input.includes('PARSE')&&count===1?'SECRET_BAD_REPLY':'{"ok":true}';res.json({usage,choices:[{message:{content}}]});
});
const app=express();app.use(express.json());app.post('/ask',auth,aiMeter('ask'),async(req,res,next)=>{try{res.json(await callDeepSeek('SECRET_PROMPT',req.body.text));}catch(e){next(e);}});app.use(require('../src/middlewares/errorHandler'));
const listen=app=>new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
before(async()=>{
 provider=await listen(providerApp);process.env.DEEPSEEK_BASE_URL=`http://127.0.0.1:${provider.address().port}`;server=await listen(app);
 for(let i=0;i<2;i++){const store=await basePrisma.store.create({data:{name:`指标隔离店${i}`}});users.push(await runWithTenant(store.id,async()=>await prisma.user.create({data:{username:`metrics-user-${i}`,passwordHash:'unused',realName:'测试',role:'admin'}})));}
});
after(async()=>{await Promise.all([new Promise(r=>provider.close(r)),new Promise(r=>server.close(r))]);await prisma.$disconnect();dropIsolatedDb(file);});
const ask=async(index,text)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/ask`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:users[index].id,role:'admin'},process.env.JWT_SECRET)}`},body:JSON.stringify({text})});return {status:response.status,body:await response.json()};};
test('并发用户隔离，每次真实provider尝试记账，无usage为null且不记录正文',async()=>{
 const output=await Promise.all([ask(0,'SECRET_INPUT_SLOW'),ask(1,'SECRET_INPUT_MISSING')]);assert.ok(output.every(r=>r.status===200));
 const rows=await basePrisma.aiRequestRecord.findMany({orderBy:{userId:'asc'}});assert.equal(rows.length,2);
 assert.equal(rows[0].userId,users[0].id);assert.equal(rows[0].storeId,users[0].storeId);assert.equal(rows[1].storeId,users[1].storeId);
 assert.equal(rows[0].promptTokens,100);assert.equal(rows[0].cacheHitTokens,60);assert.equal(rows[0].totalTokens,120);assert.equal(rows[0].estimatedCost,null);
 assert.equal(rows[1].promptTokens,null);assert.equal(rows[1].totalTokens,null);assert.equal(rows[1].status,'success');assert.notEqual(rows[0].requestId,rows[1].requestId);
 assert.ok(!JSON.stringify(rows).includes('SECRET_'));
});
test('解析失败与retry有独立attempt且同逻辑requestId，失败usage照实记录',async()=>{
 const before=await basePrisma.aiRequestRecord.count();assert.equal((await ask(0,'SECRET_PARSE')).status,200);
 const rows=await basePrisma.aiRequestRecord.findMany({orderBy:{createdAt:'asc'},skip:before});assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.status),['parse_failed','success']);assert.deepEqual(rows.map(r=>r.attempt),[1,2]);assert.equal(rows[0].requestId,rows[1].requestId);assert.equal(rows[0].promptTokens,100);assert.equal(rows[0].errorCode,'INVALID_PROVIDER_JSON');
 assert.equal((await ask(1,'SECRET_HTTP')).status,502);const fail=await basePrisma.aiRequestRecord.findFirst({where:{errorCode:'HTTP_429'}});assert.ok(fail);assert.equal(fail.promptTokens,7);assert.equal(fail.completionTokens,null);
});
test('明确模型价格才估算且cache hit/miss不重复计入输入；网络失败重试不假造usage',async()=>{
 process.env.AI_MODEL_PRICING=JSON.stringify({'deepseek-chat':{currency:'CNY',unit:'per_million_tokens',input:2,cacheHit:0.2,output:3}});
 const response=await ask(0,'SECRET_PRICED');assert.equal(response.status,200);const priced=await basePrisma.aiRequestRecord.findFirst({where:{estimatedCost:{not:null}}});assert.ok(priced);assert.equal(priced.estimatedCost,0.000152);assert.equal(priced.currency,'CNY');assert.equal(JSON.parse(priced.pricingSnapshot).unit,'per_million_tokens');delete process.env.AI_MODEL_PRICING;
 const before=await basePrisma.aiRequestRecord.count();assert.equal((await ask(0,'SECRET_NETWORK')).status,503);const rows=await basePrisma.aiRequestRecord.findMany({orderBy:{createdAt:'asc'},skip:before});assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='failed'&&r.totalTokens===null));assert.equal(new Set(rows.map(r=>r.requestId)).size,1);
});
test('指标落库故障不阻断业务，受控错误计数可见且日志不含正文',async()=>{
 await basePrisma.$executeRawUnsafe("CREATE TRIGGER metrics_fail BEFORE INSERT ON AiRequestRecord BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 try{assert.equal((await ask(0,'SECRET_LOG_FAILURE')).status,200);const context=require('../src/services/metricsContext');assert.ok(context.telemetryHealth().writeFailures>=1);}finally{await basePrisma.$executeRawUnsafe('DROP TRIGGER metrics_fail');}
});
test('缓存价格缺失不当成普通输入价，无法分清缓存token时成本未知',()=>{
 const {estimate}=require('../src/services/metricsContext');
 process.env.AI_MODEL_PRICING=JSON.stringify({'deepseek-chat':{currency:'CNY',unit:'per_million_tokens',input:2,output:3}});
 assert.equal(estimate('deepseek-chat',{promptTokens:100,completionTokens:20,cacheHitTokens:60,cacheMissTokens:40}).estimatedCost,null);
 delete process.env.AI_MODEL_PRICING;
});
test('重试不重复扣日额度，失败不扣额度，未配置provider不生成尝试',async()=>{
 const count=async()=>Number((await basePrisma.aiUsage.aggregate({where:{storeId:users[0].storeId},_sum:{calls:true}}))._sum.calls||0);
 const before=await count();assert.equal((await ask(0,'SECRET_PARSE_QUOTA')).status,200);
 for(let i=0;i<20&&(await count())===before;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(await count(),before+1);
 assert.equal((await ask(0,'SECRET_HTTP_QUOTA')).status,502);assert.equal(await count(),before+1);
 const attempts=await basePrisma.aiRequestRecord.count();delete process.env.DEEPSEEK_API_KEY;
 try{assert.equal((await ask(0,'NO_PROVIDER')).status,503);assert.equal(await basePrisma.aiRequestRecord.count(),attempts);}finally{process.env.DEEPSEEK_API_KEY='synthetic-provider-key';}
});
