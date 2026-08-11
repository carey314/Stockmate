// 口述记账「确认落库」这一步的账务后果，走真库真控制器。
// 重点是把清洗层的 null→0 缺陷跟它真正的破坏面连起来：
// sanitizeParseEntry 把"没说进价"变成 0，confirmEntry 就把这个 0 当成真进价写进 sku.costPrice。
process.env.TZ = 'Asia/Shanghai';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct } = require('./helpers/db');

const DB_FILE = useIsolatedDb('aiparse'); // 必须在下面 require prisma 之前
const prisma = require('../src/config/prisma');
const { runWithTenant } = prisma;
const aiParse = require('../src/controllers/aiParse');
const { sanitizeParseEntry } = require('../src/utils/aiGuard');

const STORE = 1;
const ctx = {};
let codeSeq = 0;

const callConfirm = (body) =>
  new Promise((resolve, reject) => {
    let status = 200;
    const res = {
      status(c) {
        status = c;
        return this;
      },
      json(payload) {
        resolve({ status, ...payload });
        return this;
      },
    };
    Promise.resolve(aiParse.confirmEntry({ body, user: { userId: ctx.user.id, role: 'admin' } }, res)).catch(reject);
  });

const newProduct = async (opts) => {
  codeSeq += 1;
  return seedProduct(prisma, { typeId: ctx.type.id, code: `AP${codeSeq}`, name: `货${codeSeq}`, ...opts });
};

before(async () => {
  await runWithTenant(STORE, async () => {
    const { user, type } = await seedBase(prisma);
    ctx.user = user;
    ctx.type = type;
  });
});

after(async () => {
  await prisma.$disconnect();
  dropIsolatedDb(DB_FILE);
});

describe('口述记账确认落库 · 进货', () => {
  test('进货入库并留一条含花费的入库流水', async () => {
    await runWithTenant(STORE, async () => {
      const { product, sku } = await newProduct({ price: 10, costPrice: 6, quantity: 20 });
      const r = await callConfirm({
        purchases: [{ productId: product.id, name: '面粉', quantity: 10, unit: '斤', totalCost: 35, unitCost: 3.5 }],
      });
      assert.equal(r.code, 200);
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 30);
      const rec = await prisma.inventoryRecord.findFirst({
        where: { skuId: sku.id, type: 'inbound' },
        orderBy: { id: 'desc' },
      });
      assert.equal(rec.beforeQuantity, 20);
      assert.equal(rec.afterQuantity, 30);
      assert.match(rec.reason, /口述记账·进货（花费¥35）/);
    });
  });

  test('说了进价就更新规格成本（这是"进价以最后一次为准"的正常路径）', async () => {
    await runWithTenant(STORE, async () => {
      const { product, sku } = await newProduct({ price: 10, costPrice: 6, quantity: 0 });
      await callConfirm({ purchases: [{ productId: product.id, name: '货', quantity: 1, unitCost: 7.2 }] });
      assert.equal((await prisma.sku.findUnique({ where: { id: sku.id } })).costPrice, 7.2);
    });
  });

  test('进货数量小数照收（散称半斤），不静默取整', async () => {
    await runWithTenant(STORE, async () => {
      const { product, sku } = await newProduct({ price: 10, quantity: 0 });
      await callConfirm({ purchases: [{ productId: product.id, name: '货', quantity: 0.5 }] });
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 0.5);
    });
  });

  test('数量非正数直接被校验拦下，一条流水都不留（宁可报错也不生成 ¥0 单据）', async () => {
    await runWithTenant(STORE, async () => {
      const { product, sku } = await newProduct({ price: 10, quantity: 0 });
      for (const quantity of [0, -1]) {
        await assert.rejects(
          () => callConfirm({ purchases: [{ productId: product.id, name: '货', quantity }] }),
          (e) => e.name === 'ZodError' && e.issues[0].path.join('.') === 'purchases.0.quantity'
        );
      }
      assert.equal(await prisma.inventoryRecord.count({ where: { skuId: sku.id } }), 0);
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 0);
    });
  });
});

describe('口述记账确认落库 · 卖出', () => {
  test('卖出扣库存 + 开单，散客当场结清', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 12, costPrice: 5, quantity: 10 });
      const r = await callConfirm({
        sales: [{ skuId: sku.id, name: '货', quantity: 2, unit: '件', unitPrice: 12, paid: true }],
      });
      assert.equal(r.data.orders.length, 1);
      assert.equal(r.data.orders[0].actualAmount, 24);
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 8);
      const order = await prisma.order.findUnique({ where: { id: r.data.orders[0].id } });
      assert.equal(order.paidAmount, 24, '散客默认现款收讫');
    });
  });

  test('记名客户没提收没收钱时默认挂账——这笔钱不能凭空记成已收', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 100, quantity: 10 });
      const cust = await prisma.customer.create({ data: { name: '老王' } });
      const r = await callConfirm({
        sales: [{ skuId: sku.id, customerId: cust.id, name: '货', quantity: 1, unitPrice: 100, paid: null }],
      });
      const order = await prisma.order.findUnique({ where: { id: r.data.orders[0].id } });
      assert.equal(order.actualAmount, 100);
      assert.equal(order.paidAmount, 0, '没提 = 挂账，不是现款');
    });
  });

  test('多个客户的卖出按客户分单，不会混成一张', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 10, quantity: 100 });
      const a = await prisma.customer.create({ data: { name: '甲' } });
      const b = await prisma.customer.create({ data: { name: '乙' } });
      const r = await callConfirm({
        sales: [
          { skuId: sku.id, customerId: a.id, name: '货', quantity: 1, unitPrice: 10, paid: true },
          { skuId: sku.id, customerId: b.id, name: '货', quantity: 2, unitPrice: 10, paid: true },
        ],
      });
      assert.equal(r.data.orders.length, 2);
      assert.deepEqual(r.data.orders.map((o) => o.actualAmount).sort((x, y) => x - y), [10, 20]);
    });
  });

  test('没建档的商品只记收入，不动库存', async () => {
    await runWithTenant(STORE, async () => {
      const r = await callConfirm({ sales: [{ name: '路边买的西瓜', quantity: 1, totalAmount: 30 }] });
      assert.equal(r.data.orders.length, 0);
      assert.equal(r.data.incomes.length, 1);
      assert.equal(r.data.incomes[0].amount, 30);
    });
  });
});

describe('口述记账确认落库 · 开销与汇总', () => {
  test('开销与汇总营业额各自落表', async () => {
    await runWithTenant(STORE, async () => {
      const r = await callConfirm({
        expenses: [{ category: '摊位费', amount: 30 }],
        aggregates: [{ label: '今日营业额', amount: 1280 }],
      });
      assert.equal(r.data.expenses[0].category, '摊位费');
      assert.equal(r.data.expenses[0].amount, 30);
      assert.equal(r.data.incomes.find((i) => i.source === '今日营业额').amount, 1280);
    });
  });
});

describe('全链路：口述没说进价，绝不能把商品成本抹成 0', () => {
  test('AI 填 null → 清洗保持 null → 落库不动原成本价', async () => {
    await runWithTenant(STORE, async () => {
      const { product, sku } = await newProduct({ price: 10, costPrice: 6, quantity: 0 });

      // 第一步：提示词明令"缺失填 null"，AI 照做（老板只说"进了10斤"，没说花多少钱）
      const aiRaw = { purchases: [{ name: '货', quantity: 10, unit: '斤', totalCost: null, unitCost: null }] };
      const cleaned = sanitizeParseEntry(aiRaw);
      assert.equal(cleaned.purchases[0].unitCost, null, '"不知道"必须还是"不知道"');

      // 第二步：这份草案原样进确认卡，用户点确认就落库
      await callConfirm({
        purchases: [{ productId: product.id, name: '货', quantity: cleaned.purchases[0].quantity, unitCost: cleaned.purchases[0].unitCost }],
      });

      // 原本 ¥6 的进价必须纹丝不动
      assert.equal((await prisma.sku.findUnique({ where: { id: sku.id } })).costPrice, 6);

      // 再往下：这个 0 会被卖出时的成本快照锁住，毛利虚高且报表察觉不到
      const orders = require('../src/controllers/orders');
      const r = await new Promise((resolve, reject) => {
        const res = { status() { return this; }, json(p) { resolve(p); return this; } };
        Promise.resolve(
          orders.create(
            { body: { items: [{ skuId: sku.id, quantity: 1, unitPrice: 10 }] }, user: { userId: ctx.user.id } },
            res
          )
        ).catch(reject);
      });
      assert.equal(r.data.items[0].costSnapshot, 6, '成本快照锁的是真实进价，毛利才算得对');
    });
  });

  test('对照组：键整个缺失时链路是正确的，成本价保持不动', async () => {
    await runWithTenant(STORE, async () => {
      const { product, sku } = await newProduct({ price: 10, costPrice: 6, quantity: 0 });
      const cleaned = sanitizeParseEntry({ purchases: [{ name: '货', quantity: 10 }] });
      assert.equal(cleaned.purchases[0].unitCost, null);
      await callConfirm({ purchases: [{ productId: product.id, name: '货', quantity: 10, unitCost: null }] });
      assert.equal((await prisma.sku.findUnique({ where: { id: sku.id } })).costPrice, 6, '原进价不该被动');
    });
  });

  test('新建商品路径同样中招：0 成本直接写进新商品档案', async () => {
    await runWithTenant(STORE, async () => {
      const r = await callConfirm({
        purchases: [
          { createProduct: true, productTypeId: ctx.type.id, name: '口述新商品', quantity: 5, unitCost: 0 },
        ],
      });
      const p = await prisma.product.findUnique({ where: { id: r.data.inbounded[0].productId } });
      assert.equal(p.costPrice, 0, '本该是 null=未知，落成了 0=白拿的');
    });
  });
});
