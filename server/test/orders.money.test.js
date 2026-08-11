// 开单这条路上所有"算错就亏钱"的地方：折扣、实收/欠款、成本快照、扣库存取整。
// 走真库 + 真控制器（造假的 req/res），因为这些数字是在事务里算完直接落库的，
// 脱离 DB 复刻一份公式来测等于测了个寂寞。
process.env.TZ = 'Asia/Shanghai';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct } = require('./helpers/db');

const DB_FILE = useIsolatedDb('orders'); // 必须在下面 require prisma 之前
const prisma = require('../src/config/prisma');
const { runWithTenant } = prisma;
const orders = require('../src/controllers/orders');

const STORE = 1;
const ctx = {};
let codeSeq = 0;

// 假 req/res：控制器只用到 req.body / req.user 和 res.status().json()
const callCreate = (body) =>
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
    Promise.resolve(orders.create({ body, user: { userId: ctx.user.id, role: 'admin' } }, res)).catch(reject);
  });

const newProduct = async (opts) => {
  codeSeq += 1;
  return seedProduct(prisma, { typeId: ctx.type.id, code: `SKU${codeSeq}`, name: `货${codeSeq}`, ...opts });
};

before(async () => {
  await runWithTenant(STORE, async () => {
    const { user, type } = await seedBase(prisma);
    ctx.user = user;
    ctx.type = type;
    ctx.customer = await prisma.customer.create({ data: { name: '老王' } });
  });
});

after(async () => {
  await prisma.$disconnect();
  dropIsolatedDb(DB_FILE);
});

describe('开单 · 折扣计算', () => {
  test('不打折时应收 = 数量 × 单价', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 2, unitPrice: 50 }],
      });
      assert.equal(r.status, 201);
      assert.equal(r.data.totalAmount, 100);
      assert.equal(r.data.discountAmount, 0);
      assert.equal(r.data.actualAmount, 100);
      assert.equal(r.data.unpaidAmount, 0);
    });
  });

  test('折扣率 95（95 折）= 让利 5%，不是收 95 元', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 95,
        items: [{ skuId: sku.id, quantity: 2, unitPrice: 50 }],
      });
      assert.equal(r.data.discountAmount, 5);
      assert.equal(r.data.actualAmount, 95);
    });
  });

  test('折扣产生的零头四舍五入到分：33.33 打 95 折让利 1.67', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 11.11, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 95,
        items: [{ skuId: sku.id, quantity: 3, unitPrice: 11.11 }],
      });
      assert.equal(r.data.totalAmount, 33.33);
      assert.equal(r.data.discountAmount, 1.67); // 33.33 × 5% = 1.6665
      assert.equal(r.data.actualAmount, 31.66);
    });
  });

  test('折扣率 100 = 原价，折扣率 0 = 全免', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const full = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 100,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(full.data.discountAmount, 0);
      assert.equal(full.data.actualAmount, 50);

      const free = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 0,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(free.data.discountAmount, 50);
      assert.equal(free.data.actualAmount, 0);
    });
  });

  test('同时给折扣金额和折扣率时以金额为准', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 95,
        discountAmount: 8,
        items: [{ skuId: sku.id, quantity: 2, unitPrice: 50 }],
      });
      assert.equal(r.data.discountAmount, 8);
      assert.equal(r.data.actualAmount, 92);
      assert.equal(r.data.discountRate, 95, '折扣率仍原样留痕');
    });
  });

  test('折扣金额超过总额时应收归零，绝不出现负应收', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        discountAmount: 999,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(r.data.actualAmount, 0);
    });
  });

  test('显式填「优惠 0 元」就是不优惠，不被折扣率顶掉', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 90,
        discountAmount: 0, // 用户的意思是"不打折"
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(r.data.discountAmount, 0, '金额优先于折扣率，0 也是有效金额');
      assert.equal(r.data.actualAmount, 50, '不打折就是原价');
    });
  });
});

describe('开单 · 实收与欠款', () => {
  test('不传 paidAmount 默认收全款', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 2, unitPrice: 50 }],
      });
      assert.equal(r.data.paidAmount, 100);
      assert.equal(r.data.unpaidAmount, 0);
    });
  });

  test('记名客户可以少付，差额落成欠款并取整到分', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 11.11, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        paidAmount: 20,
        items: [{ skuId: sku.id, quantity: 3, unitPrice: 11.11 }],
      });
      assert.equal(r.data.actualAmount, 33.33);
      assert.equal(r.data.unpaidAmount, 13.33);
    });
  });

  test('散客欠款直接拒单——没名没姓的欠款追无可追', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      await assert.rejects(
        () => callCreate({ paidAmount: 30, items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }] }),
        (e) => e.status === 400 && /散客订单需当场结清/.test(e.message)
      );
    });
  });

  test('散客付款差额在 1 厘容差内视为结清（浮点误差不该卡单）', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({ paidAmount: 49.9995, items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }] });
      assert.equal(r.status, 201);
    });
  });

  test('散客单挂到内置「散客」档案而不是报错要求先建客户', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({ items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }] });
      assert.equal(r.data.customer.name, '散客');
    });
  });

  test('多收的钱落成负欠款（预收），不会被截断成 0', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        paidAmount: 60,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(r.data.unpaidAmount, -10);
    });
  });

  test('收款金额 > 0 时落一条收款流水；为 0 时不落空流水', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 100 });
      const paidOrder = await callCreate({
        customerId: ctx.customer.id,
        settlementAccount: '微信',
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      const rec = await prisma.paymentRecord.findFirst({ where: { orderId: paidOrder.data.id } });
      assert.equal(rec.direction, 'in');
      assert.equal(rec.amount, 50);
      assert.equal(rec.account, '微信');

      const creditOrder = await callCreate({
        customerId: ctx.customer.id,
        paidAmount: 0,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(await prisma.paymentRecord.count({ where: { orderId: creditOrder.data.id } }), 0);
    });
  });
});

describe('开单 · 成本快照（改进价不许追溯改写历史利润）', () => {
  test('规格自己有成本时快照取规格成本', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, costPrice: 30, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(r.data.items[0].costSnapshot, 30);
    });
  });

  test('规格没成本时回落到商品成本', async () => {
    await runWithTenant(STORE, async () => {
      codeSeq += 1;
      const product = await prisma.product.create({
        data: { code: `C${codeSeq}`, name: `商品成本${codeSeq}`, productTypeId: ctx.type.id, defaultPrice: 50, costPrice: 20 },
      });
      const sku = await prisma.sku.create({
        data: { productId: product.id, code: `C${codeSeq}`, price: 50, costPrice: null, isDefault: 1 },
      });
      await prisma.inventory.create({ data: { productId: product.id, skuId: sku.id, quantity: 100 } });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(r.data.items[0].costSnapshot, 20);
    });
  });

  test('完全没有成本数据时快照是 null，不是 0（0 会让毛利虚高且报表发现不了）', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, costPrice: null, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      assert.equal(r.data.items[0].costSnapshot, null);
    });
  });

  test('开单之后再改进价，老订单的成本快照纹丝不动', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, costPrice: 30, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 1, unitPrice: 50 }],
      });
      await prisma.sku.update({ where: { id: sku.id }, data: { costPrice: 45 } });
      const item = await prisma.orderItem.findFirst({ where: { orderId: r.data.id } });
      assert.equal(item.costSnapshot, 30, '进价涨到 45 后，历史订单仍按卖出那一刻的 30 算利润');
    });
  });
});

describe('开单 · 扣库存', () => {
  test('库存按数量扣减并留一条出库流水（前后数量都对得上）', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 10 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 3, unitPrice: 50 }],
      });
      const inv = await prisma.inventory.findUnique({ where: { skuId: sku.id } });
      assert.equal(inv.quantity, 7);
      const rec = await prisma.inventoryRecord.findFirst({ where: { relatedOrderId: r.data.id } });
      assert.equal(rec.type, 'outbound');
      assert.equal(rec.quantity, 3);
      assert.equal(rec.beforeQuantity, 10);
      assert.equal(rec.afterQuantity, 7);
      assert.match(rec.reason, /^销售单 SO/);
    });
  });

  test('散称小数扣减不产生浮点垃圾（10 − 0.1 − 0.2 = 9.7，不是 9.700000000000001）', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 10 });
      await callCreate({ customerId: ctx.customer.id, items: [{ skuId: sku.id, quantity: 0.1, unitPrice: 50 }] });
      await callCreate({ customerId: ctx.customer.id, items: [{ skuId: sku.id, quantity: 0.2, unitPrice: 50 }] });
      const inv = await prisma.inventory.findUnique({ where: { skuId: sku.id } });
      assert.equal(inv.quantity, 9.7);
    });
  });

  test('默认允许卖成负库存，并把变负的规格回给前端提示补录', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 50, quantity: 1 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 5, unitPrice: 50 }],
      });
      assert.equal(r.status, 201);
      assert.equal(r.data.negativeStock.length, 1);
      assert.match(r.data.negativeStock[0], /→ -4$/);
      assert.match(r.message, /库存变成负数/);
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, -4);
    });
  });

  test('店铺关掉负库存后卖超直接拒单，且整单事务回滚（库存不动、单不落）', async () => {
    await runWithTenant(STORE, async () => {
      await prisma.setting.create({ data: { key: 'allowNegativeStock', value: '0' } });
      const { sku } = await newProduct({ price: 50, quantity: 1 });
      const before = await prisma.order.count();
      await assert.rejects(
        () => callCreate({ customerId: ctx.customer.id, items: [{ skuId: sku.id, quantity: 5, unitPrice: 50 }] }),
        (e) => e.status === 400 && /库存不足：仅剩 1/.test(e.message)
      );
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: sku.id } })).quantity, 1, '库存必须原样');
      assert.equal(await prisma.order.count(), before, '订单不能留半张');
      await prisma.setting.deleteMany({ where: { key: 'allowNegativeStock' } });
    });
  });

  test('有配方的成品：卖 1 份扣的是原料，成品自身库存不动', async () => {
    await runWithTenant(STORE, async () => {
      const milk = await newProduct({ price: 0, quantity: 100 }); // 原料：牛奶
      const cup = await newProduct({ price: 0, quantity: 50 }); // 原料：杯子
      const tea = await newProduct({ price: 12, quantity: 0 }); // 成品：奶茶
      await prisma.recipe.createMany({
        data: [
          { ownerSkuId: tea.sku.id, componentSkuId: milk.sku.id, qty: 0.2 },
          { ownerSkuId: tea.sku.id, componentSkuId: cup.sku.id, qty: 1 },
        ],
      });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: tea.sku.id, quantity: 3, unitPrice: 12 }],
      });
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: milk.sku.id } })).quantity, 99.4);
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: cup.sku.id } })).quantity, 47);
      assert.equal((await prisma.inventory.findUnique({ where: { skuId: tea.sku.id } })).quantity, 0, '成品不追库存');
      const rec = await prisma.inventoryRecord.findFirst({
        where: { relatedOrderId: r.data.id, skuId: milk.sku.id },
      });
      assert.match(rec.reason, /^配方扣料 销售单 SO/);
    });
  });
});

describe('开单 · 金额精度（钱必须逐步取整，不能靠存储层碰巧抹平）', () => {
  // totalAmount / actualAmount / subtotal 都是裸浮点直接算直接写，全程没有 Math.round(x*100)/100，
  // 只有响应里的 unpaidAmount 做了取整。下面两条把「现状」钉死。
  test('浮点小计写库时被存储层归整掉了（SQLite 侧目前看不出脏值）', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 3, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        items: [{ skuId: sku.id, quantity: 0.7, unitPrice: 3 }],
      });
      assert.equal(0.7 * 3, 2.0999999999999996, '应用层算出来的是脏值');
      // Prisma 的 SQLite 写入按约 16 位有效数字序列化，脏值恰好被抹平成 2.1。
      // 这是存储层的巧合而不是业务代码的保证——生产计划切 MySQL，那边不保证同样的归整。
      assert.equal(r.data.totalAmount, 2.1);
      assert.equal(r.data.actualAmount, 2.1);
      assert.equal(r.data.items[0].subtotal, 2.1);
    });
  });

  test('参与折扣计算的 total 已取整，让利额等于数学期望', async () => {
    await runWithTenant(STORE, async () => {
      const { sku } = await newProduct({ price: 3, quantity: 100 });
      const r = await callCreate({
        customerId: ctx.customer.id,
        discountRate: 95,
        items: [{ skuId: sku.id, quantity: 0.7, unitPrice: 3 }],
      });
      // 2.10 × 5% = 0.105 → 0.11。修复前 total 是脏值 2.0999999999999996，算出来会少 1 分
      assert.equal(r.data.discountAmount, 0.11);
      assert.equal(r.data.actualAmount, 1.99);
    });
  });
});
