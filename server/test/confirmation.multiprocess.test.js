// 两个独立Node进程共享隔离SQLite库；进程内transaction队列不能替数据库幂等兜底。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct } = require('./helpers/db');
const file = useIsolatedDb(`confirmation-processes-${process.pid}`);
const prisma = require('../src/config/prisma');
let user, sku;
before(async () => prisma.runWithTenant(1, async () => {
  const base = await seedBase(prisma); user = base.user;
  ({ sku } = await seedProduct(prisma, { typeId: base.type.id, code: 'PROCESS', name: '并发货', price: 10, costPrice: 6, quantity: 20 }));
}));
after(async () => { await prisma.$disconnect(); dropIsolatedDb(file); });

const workerCode = `
const prisma = require('./src/config/prisma');
const { confirmEntry } = require('./src/services/confirmEntry');
process.once('message', async ({ input, actorId }) => {
  try {
    const result = await prisma.runWithTenant(1, () => confirmEntry(input, actorId));
    process.send({ type: 'result', result });
  } catch (error) {
    process.send({ type: 'error', code: error.code, status: error.status, message: error.message });
  } finally { await prisma.$disconnect(); process.disconnect(); }
});
process.send({ type: 'ready' });
`;
function worker(t) {
  const child = spawn(process.execPath, ['-e', workerCode], {
    cwd: path.join(__dirname, '..'), env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let readyResolve, rejectReady, reply, stderr = '';
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; rejectReady = reject; });
  const done = new Promise((resolve, reject) => {
    child.on('message', msg => { if (msg.type === 'ready') readyResolve(); else reply = msg; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { rejectReady(error); reject(error); });
    child.once('exit', code => {
      if (code === 0 && reply?.type === 'result') resolve(reply.result);
      else { const error = new Error(JSON.stringify({ code, reply, stderr })); rejectReady(error); reject(error); }
    });
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });
  return { ready, done, start: input => child.send({ input, actorId: user.id }) };
}

test('跨进程同确认ID并发与重启重试只生成一单、一笔收款和一次库存扣减', { timeout: 60000 }, async t => {
  const input = { requestId: 'multiprocess-confirmation', sales: [{ skuId: sku.id, name: '并发货', quantity: 2, unitPrice: 10, paid: true }] };
  const workers = [worker(t), worker(t)];
  // 两边模块全部就绪后同时放行，确保使用独立进程队列竞争同一数据库。
  await Promise.all(workers.map(w => w.ready));
  workers.forEach(w => w.start(input));
  const results = await Promise.all(workers.map(w => w.done));
  assert.deepEqual(results.map(r => r.replayed).sort(), [false, true]);
  assert.equal(results[0].orders[0].id, results[1].orders[0].id);
  // 新进程不能依赖前两个进程的内存状态。
  const restarted = worker(t); await restarted.ready; restarted.start(input);
  const replay = await restarted.done;
  assert.equal(replay.replayed, true); assert.equal(replay.orders[0].id, results[0].orders[0].id);
  await prisma.runWithTenant(1, async () => {
    assert.equal(await prisma.entryConfirmation.count(), 1);
    assert.equal(await prisma.order.count(), 1);
    assert.equal(await prisma.paymentRecord.count(), 1);
    assert.equal(await prisma.inventoryRecord.count(), 1);
    assert.equal(await prisma.tradeEvent.count(), 1);
    assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 18);
  });
});
