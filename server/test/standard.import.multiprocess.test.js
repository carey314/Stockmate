const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { useIsolatedDb, dropIsolatedDb } = require('./helpers/db');
const file = useIsolatedDb(`standard-import-processes-${process.pid}`);
const prisma = require('../src/config/prisma');
after(async () => { await prisma.$disconnect(); dropIsolatedDb(file); });
const workerCode = `
const prisma = require('./src/config/prisma');
const { commit } = require('./src/services/standardImport');
process.once('message', async ({ input, actor, storeId }) => {
 try { const result = await prisma.runWithTenant(storeId, async () => await commit(input, actor)); process.send({type:'result',result}); }
 catch (e) { process.send({type:'error',code:e.code,status:e.status,message:e.message}); }
 finally { await prisma.$disconnect(); process.disconnect(); }
});
process.send({type:'ready'});
`;
function worker(t) {
  const child=spawn(process.execPath,['-e',workerCode],{cwd:path.join(__dirname,'..'),env:process.env,stdio:['ignore','ignore','pipe','ipc']});
  let readyResolve,readyReject,reply,stderr='';
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const done=new Promise((resolve,reject)=>{
    child.on('message',message=>{if(message.type==='ready')readyResolve();else reply=message;});
    child.stderr.on('data',data=>{stderr+=data;});
    child.once('error',error=>{readyReject(error);reject(error);});
    child.once('exit',code=>{if(code===0&&reply?.type==='result')resolve(reply.result);else{const error=new Error(JSON.stringify({code,reply,stderr}));readyReject(error);reject(error);}});
  });
  t.after(()=>{if(child.exitCode==null)child.kill();});
  return {ready,done,start:payload=>child.send(payload)};
}
test('独立进程同时导入与进程重启重试，只创建一次商品、规格与初始库存', {timeout:60000}, async t=>{
  const store=await prisma.basePrisma.store.create({data:{name:'并发导入店'}});
  await prisma.runWithTenant(store.id,async()=>{
    const user=await prisma.user.create({data:{username:'import-multiprocess',passwordHash:'unused',realName:'测试店主',role:'admin'}});
    const type=await prisma.productType.create({data:{name:'测试'}});
    const input={batchId:'multiprocess-standard-import',productTypeId:type.id,rows:[{rowId:'2',code:'P',skuCode:'P-A',name:'货',unit:'件',specText:'A',price:'12',costPrice:'',initQuantity:'1.5',barcode:'001'}],selectedRowIds:['2']};
    const payload={input,actor:{userId:user.id,role:'admin'},storeId:store.id};
    const workers=[worker(t),worker(t)];await Promise.all(workers.map(w=>w.ready));workers.forEach(w=>w.start(payload));
    const responses=await Promise.all(workers.map(w=>w.done));assert.deepEqual(responses[0],responses[1]);assert.equal(responses[0].results[0].status,'success');
    const restarted=worker(t);await restarted.ready;restarted.start(payload);assert.deepEqual(await restarted.done,responses[0]);
    assert.equal(await prisma.product.count(),1);assert.equal(await prisma.sku.count(),1);assert.equal(await prisma.inventoryRecord.count(),1);assert.equal((await prisma.inventory.findFirst()).quantity,1.5);assert.equal(await prisma.entryConfirmation.count(),2);
  });
});
