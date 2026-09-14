// 第二批专用本地联验，不读.env、不接生产、不调用付费模型。保持运行至App确认联验结束。
process.env.TZ='Asia/Shanghai';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
delete process.env.DEEPSEEK_API_KEY;delete process.env.APPLE_SHARED_SECRET;
for(const key of Object.keys(process.env))if(key.startsWith('PNVS_'))delete process.env[key];
process.env.FREE_AI_DAILY_CORE='8';process.env.FREE_AI_DAILY_OTHER='5';process.env.PRO_AI_DAILY_CORE='100';process.env.PRO_AI_DAILY_OTHER='50';
const {useIsolatedDb}=require('../test/helpers/db');
const resume=process.argv.includes('--resume')?JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs/quality/2026-09-08-web/integration-local.json'),'utf8')):null;
if(resume&&!/^\/tmp\/unit-stockmate-integration-batch2-\d+\.db$/.test(resume.db))throw new Error('Resume restricted to this integration database');
const dbFile=resume?resume.db:useIsolatedDb(`stockmate-integration-batch2-${process.pid}`);
if(resume){if(!fs.existsSync(dbFile))throw new Error('Integration database missing');process.env.DATABASE_URL=`file:${dbFile}`;}
const prisma=require('../src/config/prisma'),bcrypt=require('bcryptjs'),express=require('express');
async function main(){
 const password=resume?resume.fixtures[0].password:`Qa-${crypto.randomBytes(6).toString('hex')}`;const fixtures=resume?resume.fixtures:[];
 for(const letter of resume?[]:['a','b']){
  const store=await prisma.basePrisma.store.create({data:{name:`联验店${letter.toUpperCase()}`}});
  await prisma.runWithTenant(store.id,async()=>{
   const user=await prisma.user.create({data:{username:`integration_${letter}`,passwordHash:await bcrypt.hash(password,10),realName:`联验老板${letter.toUpperCase()}`,role:'admin'}});
   const type=await prisma.productType.create({data:{name:'联验商品'}});
   const product=await prisma.product.create({data:{name:'联验饮料',code:`QA-${letter}`,productTypeId:type.id,unit:'瓶',defaultPrice:10,costPrice:6}});
   const skus=[];for(const [suffix,price,cost] of [['单瓶',10,6],['整箱',100,60]]){
    const sku=await prisma.sku.create({data:{productId:product.id,code:`QA-${letter}-${suffix}`,specText:suffix,price,costPrice:cost,isDefault:suffix==='单瓶'?1:0}});skus.push({id:sku.id,spec:suffix});await prisma.inventory.create({data:{productId:product.id,skuId:sku.id,quantity:100}});
   }
   const customer=await prisma.customer.create({data:{name:`客户${letter.toUpperCase()}`}});const supplier=await prisma.supplier.create({data:{name:`供应商${letter.toUpperCase()}`}});
   await prisma.setting.create({data:{key:'shopName',value:`联验店${letter.toUpperCase()}`}});
   if(letter==='b')await require('../src/utils/entitlement').grantEntitlement({storeId:store.id,plan:'pro',source:'manual',note:'仅本轮合成联验'});
   fixtures.push({storeId:store.id,userId:user.id,username:user.username,password,customerId:customer.id,supplierId:supplier.id,typeId:type.id,productId:product.id,skus,plan:letter==='b'?'pro':'free'});
  });
 }
 const app=express();app.use(require('cors')());app.use(express.json());app.use('/api/v1',require('../src/routes'));app.use(require('../src/middlewares/errorHandler'));
 const server=app.listen(resume?Number(new URL(resume.api).port):0,'127.0.0.1',()=>{
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const details={api:base,pid:process.pid,db:dbFile,fixtures};
  const target=path.resolve(__dirname,'../../docs/quality/2026-09-08-web');
  fs.writeFileSync(path.join(target,'integration-local.json'),JSON.stringify(details,null,2));
  if(!resume)fs.writeFileSync(path.join(target,'INTEGRATION.md'),`# 第二批专用联验后端\n\n状态：运行中，保持至App完成联验并确认清理。\n\n- API：${base}\n- Web：待主窗口补专用Vite地址。\n- 进程：${process.pid}；独立数据库：${dbFile}\n- Schema：当前第二批schema，由独立空库db push构建，不是生产迁移验证。\n- 只监听127.0.0.1，模拟器可直连；真机需要另行提供可达地址。\n- 不加载.env；没有真实Apple共享密钥/AI密钥，付费模型调用不启用。B的Pro为人工合成，不是真实Apple购买证据。\n\n## 两端共用合成账号（仅本机临时库）\n\n${fixtures.map(f=>`- ${f.username} / ${password}；storeId=${f.storeId}，${f.plan}；客户=${f.customerId}，供应商=${f.supplierId}，品类=${f.typeId}；SKU ${f.skus.map(s=>`${s.spec}=${s.id}`).join('、')}`).join('\n')}\n\n## 联验场景\n\n1. 店A采购挂账100→补付40→欠60；只1笔真实支出40。\n2. 单瓶成本6售价10，卖2退1→净销售10、净成本6、利润4。\n3. App配置字段→Web整体保存→App回读unit/showInList/isCore/affectsStock。\n4. A/B切换，旧草稿/聊天/迟到响应不跨店；B为Pro、A为Free验证权益刷新。\n5. 同requestId重复确认只落1单。\n\n## 生命周期与证据边界\n\n本服务由Web窗口创建，不连接任何已有数据库；App可使用上述账号造数、清理仅限本库。主窗口不会在App未确认完成时删除数据库或停止服务。若需要重启必须先协调并保存本库，不能重新初始化覆盖联验数据。\n\n支付归属/通知/登录桥的合成签名故障回归在独立测试库运行；此服务不放验签旁路。真实Apple沙盒/原生重新认证需要实际Apple配置和设备，不能拿B人工Pro替代。\n`);
  console.log(JSON.stringify({api:base,pid:process.pid,db:dbFile,accounts:fixtures.map(f=>f.username)}));
 });
}
main().catch(e=>{console.error(e);process.exitCode=1;});
