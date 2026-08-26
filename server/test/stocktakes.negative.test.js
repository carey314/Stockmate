// 盘点 × 负库存（2026-08-26 真人测试踩出的整单堵死 bug）：
// 账面为负的行（卖超没补录）没动过时，App 按账面数原样上送 actualQty=-1，
// 旧 schema 一刀切 nonnegative 把整张盘点单拒了，还报英文。
// 语义正确的规则：actual == 账面（哪怕是负数）= "这项没法盘，保持现状" → 盘平放行；
// actual 为负且 ≠ 账面 = 硬填负数 → 点名商品用人话拒。
process.env.TZ = 'Asia/Shanghai';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct } = require('./helpers/db');

const DB_FILE = useIsolatedDb('stocktakes-neg'); // 必须在 require prisma 之前
const prisma = require('../src/config/prisma');
const { runWithTenant } = prisma;
const stocktakes = require('../src/controllers/stocktakes');

const STORE = 1;
const ctx = {};

const callCreate = (body) =>
  new Promise((resolve, reject) => {
    let status = 200;
    const res = {
      status(c) { status = c; return this; },
      json(payload) { resolve({ status, ...payload }); return this; },
    };
    runWithTenant(STORE, () =>
      stocktakes.create({ body, user: { userId: ctx.user.id, storeId: STORE } }, res).catch(reject)
    );
  });

describe('盘点 × 负库存', () => {
  before(async () => {
    await runWithTenant(STORE, async () => {
      const { user, type } = await seedBase(prisma, { typeName: '酒水' });
      ctx.user = user;
      // 一个卖超成负数的（账面 -1），一个正常的（账面 10）
      ctx.neg = await seedProduct(prisma, { typeId: type.id, name: '轩尼诗VSOP', code: 'NEG1', price: 800, quantity: 0 });
      await prisma.inventory.update({ where: { skuId: ctx.neg.sku.id }, data: { quantity: -1 } });
      ctx.ok = await seedProduct(prisma, { typeId: type.id, name: '雪花啤酒', code: 'OK1', price: 3, quantity: 10 });
    });
  });

  after(async () => {
    await prisma.$disconnect();
    dropIsolatedDb(DB_FILE);
  });

  test('负账面行没动过（actual==账面）→ 整单放行，记盘平不动库存', async () => {
    const r = await callCreate({
      items: [
        { skuId: ctx.neg.sku.id, actualQty: -1 }, // 没动过，按账面原样上送——旧版在这里整单炸掉
        { skuId: ctx.ok.sku.id, actualQty: 13 },  // 真盘出了 +3
      ],
    });
    assert.equal(r.code, 201, `应该成功，实际：${r.message}`); // created() 返回 201
    assert.equal(r.data.diffItems, 1, '只有雪花一项有出入');

    await runWithTenant(STORE, async () => {
      const negInv = await prisma.inventory.findUnique({ where: { skuId: ctx.neg.sku.id } });
      assert.equal(negInv.quantity, -1, '负账面行保持现状，不被盘点改动');
      const okInv = await prisma.inventory.findUnique({ where: { skuId: ctx.ok.sku.id } });
      assert.equal(okInv.quantity, 13, '有出入的行按实盘调平');
    });
  });

  test('硬填负数（actual<0 且 ≠账面）→ 400 且报错点名商品、说人话', async () => {
    // 控制器对非法输入是 throw httpError，真实应用里由全局错误中间件转成响应；
    // 假 res 接不到 throw，所以这里接 rejection 断言错误对象本身
    const err = await callCreate({
      items: [{ skuId: ctx.neg.sku.id, actualQty: -5 }],
    }).then(
      (r) => new Error(`不该成功：${r.message}`),
      (e) => e
    );
    assert.equal(err.status, 400);
    assert.match(err.message, /轩尼诗VSOP/, '要点名是哪个商品');
    assert.match(err.message, /不能填负数/, '要说人话');
    assert.doesNotMatch(err.message, /Number must be/, '不许漏英文');
  });
});
