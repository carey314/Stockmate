// 价格三级解析：客户专属价 > 该客户上次成交价 > SKU 标价。
// "按上次价"是批发行业的默认心智，解析错一级就是直接卖错钱，所以走真库真数据。
process.env.TZ = 'Asia/Shanghai';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedBase, seedProduct } = require('./helpers/db');

const DB_FILE = useIsolatedDb('pricing'); // 必须在下面 require prisma 之前
const prisma = require('../src/config/prisma');
const { runWithTenant } = prisma;
const { resolvePriceForCustomer } = require('../src/controllers/pricing');

const STORE = 1;
const OTHER_STORE = 2;
const ctx = {}; // 建好的基础数据

// 造一张已完成的销售单，用来制造"上次成交价"
const placeOrder = async (tx, { customerId, sku, unitPrice, quantity = 1, status = 'completed' }) =>
  tx.order.create({
    data: {
      orderNo: `SO${Date.now()}${Math.floor(Math.random() * 1000)}`,
      customerId,
      status,
      totalAmount: unitPrice * quantity,
      actualAmount: unitPrice * quantity,
      paidAmount: unitPrice * quantity,
      operatorId: ctx.user.id,
      items: {
        create: [
          {
            storeId: STORE,
            productId: sku.productId,
            skuId: sku.id,
            productName: '货',
            quantity,
            unitPrice,
            subtotal: unitPrice * quantity,
          },
        ],
      },
    },
  });

before(async () => {
  await runWithTenant(STORE, async () => {
    const { user, type } = await seedBase(prisma);
    ctx.user = user;
    ctx.type = type;
    // 标价 100 的商品，外加同商品的第二个规格（验证不串规格）
    const { product, sku } = await seedProduct(prisma, { typeId: type.id, name: '飞天', code: 'P001', price: 100 });
    ctx.product = product;
    ctx.sku = sku;
    ctx.sku2 = await prisma.sku.create({
      data: { productId: product.id, code: 'P001-2', price: 555, specText: '整箱' },
    });
    ctx.laowang = await prisma.customer.create({ data: { name: '老王' } });
    ctx.laoli = await prisma.customer.create({ data: { name: '老李' } });
  });
});

after(async () => {
  await prisma.$disconnect();
  dropIsolatedDb(DB_FILE);
});

describe('resolvePriceForCustomer · 三级价格解析', () => {
  test('三级都没有 → 落 SKU 标价，source=default', async () => {
    await runWithTenant(STORE, async () => {
      const r = await resolvePriceForCustomer(ctx.sku.id, ctx.laowang.id);
      assert.deepEqual(r, { skuId: ctx.sku.id, price: 100, source: 'default' });
    });
  });

  test('有成交历史无专属价 → 落上次成交价，source=last', async () => {
    await runWithTenant(STORE, async () => {
      await placeOrder(prisma, { customerId: ctx.laowang.id, sku: ctx.sku, unitPrice: 92 });
      const r = await resolvePriceForCustomer(ctx.sku.id, ctx.laowang.id);
      assert.equal(r.price, 92);
      assert.equal(r.source, 'last');
    });
  });

  test('上次成交价取最近一单，不是第一单', async () => {
    await runWithTenant(STORE, async () => {
      await placeOrder(prisma, { customerId: ctx.laowang.id, sku: ctx.sku, unitPrice: 88 });
      const r = await resolvePriceForCustomer(ctx.sku.id, ctx.laowang.id);
      assert.equal(r.price, 88);
    });
  });

  test('别的客户的成交价不串（老李查到的还是标价）', async () => {
    await runWithTenant(STORE, async () => {
      const r = await resolvePriceForCustomer(ctx.sku.id, ctx.laoli.id);
      assert.equal(r.price, 100);
      assert.equal(r.source, 'default');
    });
  });

  test('同商品别的规格不串（整箱规格查到的是自己的标价 555）', async () => {
    await runWithTenant(STORE, async () => {
      const r = await resolvePriceForCustomer(ctx.sku2.id, ctx.laowang.id);
      assert.equal(r.price, 555);
      assert.equal(r.source, 'default');
    });
  });

  test('专属价压过上次成交价，source=customer', async () => {
    await runWithTenant(STORE, async () => {
      await prisma.pricingRule.create({
        data: { productId: ctx.product.id, skuId: ctx.sku.id, customerId: ctx.laowang.id, price: 80 },
      });
      const r = await resolvePriceForCustomer(ctx.sku.id, ctx.laowang.id);
      assert.deepEqual(r, { skuId: ctx.sku.id, price: 80, source: 'customer' });
    });
  });

  test('专属价改了立刻生效（改价不需要重新开单）', async () => {
    await runWithTenant(STORE, async () => {
      await prisma.pricingRule.update({
        where: { skuId_customerId: { skuId: ctx.sku.id, customerId: ctx.laowang.id } },
        data: { price: 75 },
      });
      assert.equal((await resolvePriceForCustomer(ctx.sku.id, ctx.laowang.id)).price, 75);
    });
  });

  test('专属价删掉后回落到上次成交价，而不是直接跳回标价', async () => {
    await runWithTenant(STORE, async () => {
      await prisma.pricingRule.delete({
        where: { skuId_customerId: { skuId: ctx.sku.id, customerId: ctx.laowang.id } },
      });
      const r = await resolvePriceForCustomer(ctx.sku.id, ctx.laowang.id);
      assert.equal(r.price, 88);
      assert.equal(r.source, 'last');
    });
  });
});

describe('resolvePriceForCustomer · 只认已完成的单', () => {
  test('草稿单/已取消单不算成交价', async () => {
    await runWithTenant(STORE, async () => {
      const c = await prisma.customer.create({ data: { name: '草稿客户' } });
      await placeOrder(prisma, { customerId: c.id, sku: ctx.sku, unitPrice: 11, status: 'draft' });
      await placeOrder(prisma, { customerId: c.id, sku: ctx.sku, unitPrice: 22, status: 'cancelled' });
      const r = await resolvePriceForCustomer(ctx.sku.id, c.id);
      assert.equal(r.source, 'default', '草稿/取消的单不该被当成交价');
      assert.equal(r.price, 100);
    });
  });

  test('已完成单夹在草稿单之后，取的仍是已完成那单的价', async () => {
    await runWithTenant(STORE, async () => {
      const c = await prisma.customer.create({ data: { name: '混合客户' } });
      await placeOrder(prisma, { customerId: c.id, sku: ctx.sku, unitPrice: 60 });
      await placeOrder(prisma, { customerId: c.id, sku: ctx.sku, unitPrice: 999, status: 'draft' });
      const r = await resolvePriceForCustomer(ctx.sku.id, c.id);
      assert.equal(r.price, 60);
      assert.equal(r.source, 'last');
    });
  });
});

describe('resolvePriceForCustomer · 边界与跨店隔离', () => {
  test('SKU 不存在时返回 0 而不是崩（下游会当成 0 元单，见报告）', async () => {
    await runWithTenant(STORE, async () => {
      const r = await resolvePriceForCustomer(99999, ctx.laowang.id);
      assert.deepEqual(r, { skuId: 99999, price: 0, source: 'default' });
    });
  });

  test('专属价为 0（送样/赠品）依然生效，不会因为 0 是假值被跳过', async () => {
    await runWithTenant(STORE, async () => {
      const c = await prisma.customer.create({ data: { name: '零元客户' } });
      await prisma.pricingRule.create({
        data: { productId: ctx.product.id, skuId: ctx.sku.id, customerId: c.id, price: 0 },
      });
      const r = await resolvePriceForCustomer(ctx.sku.id, c.id);
      assert.equal(r.price, 0);
      assert.equal(r.source, 'customer');
    });
  });

  test('别的店的专属价绝不串过来（租户隔离）', async () => {
    const other = {};
    await runWithTenant(OTHER_STORE, async () => {
      const { user, type } = await seedBase(prisma, { username: 'other', typeName: '啤酒' });
      other.user = user;
      const { sku } = await seedProduct(prisma, { typeId: type.id, name: '别店货', code: 'X001', price: 200 });
      other.sku = sku;
      other.customer = await prisma.customer.create({ data: { name: '别店客户' } });
      await prisma.pricingRule.create({
        data: { productId: sku.productId, skuId: sku.id, customerId: other.customer.id, price: 1 },
      });
      // 别的店自己查是查得到的
      assert.equal((await resolvePriceForCustomer(sku.id, other.customer.id)).price, 1);
    });

    await runWithTenant(STORE, async () => {
      // 本店拿别店的 skuId/customerId 去查：专属价查不到，SKU 也查不到 → 落 0
      const r = await resolvePriceForCustomer(other.sku.id, other.customer.id);
      assert.equal(r.source, 'default');
      assert.equal(r.price, 0, '别店 SKU 的标价 200 不该泄露到本店');
    });
  });
});
