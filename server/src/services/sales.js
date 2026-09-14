const { z } = require('zod');
const { getTenantId } = require('../config/prisma');
const { httpError, genOrderNo, getWalkInCustomer, isNegativeStockAllowed, money } = require('../utils/biz');

// 销售单：完整单据（明细按 SKU + 折扣 + 实收/欠款 + 结算账户）
const orderSchema = z.object({
  // 不传 = 散客（服务端兜底挂到内置「散客」档案）。
  // 强制选客户会把小店的第一单就卡死——他们绝大多数是一手交钱一手交货。
  customerId: z.number().int().nullish(),
  notes: z.string().nullish(),
  discountRate: z.number().min(0).max(100).nullish(), // 95 = 95折
  discountAmount: z.number().nonnegative().optional(), // 直接给折扣金额（与折扣率二选一，都给以金额为准）
  paidAmount: z.number().nonnegative().optional(), // 已收款（默认=实收全款；少于实收即挂账）
  settlementAccount: z.string().nullish(), // 现金/微信/支付宝/银行卡/挂账
  items: z
    .array(
      z.object({
        skuId: z.number().int().optional(),
        productId: z.number().int().optional(), // 兼容：无 skuId 用默认规格
        quantity: z.number().finite().positive().refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7, '数量最多三位小数'), // 支持散称 0.5 斤
        unitPrice: z.number().nonnegative(),
      })
    )
    .min(1, '订单至少一件商品'),
});

const resolveSkuWithProduct = async (tx, item) => {
  if (item.skuId) {
    const sku = await tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true, inventory: true } });
    if (!sku || sku.product.isDeleted) throw httpError(404, `规格 ${item.skuId} 不存在`);
    return sku;
  }
  if (item.productId) {
    const sku = await tx.sku.findFirst({
      where: { productId: item.productId, status: 1 },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      include: { product: true, inventory: true },
    });
    if (!sku) throw httpError(404, `商品 ${item.productId} 无可用规格`);
    return sku;
  }
  throw httpError(400, '明细需提供 skuId 或 productId');
};

const { stockPlan, moveStock, postTrade, cents, allocateCents, settlement } = require('../utils/trade');
const createSale = async (tx, input, operatorId) => {
  const data = orderSchema.parse(input);
  const allowNegative = await isNegativeStockAllowed();
    // 没指定客户 → 挂内置散客；指定了客户 → 本店归属校验（防跨店挂靠+客户资料回显泄露）
    if (data.customerId) {
      const owned = await tx.customer.findFirst({ where: { id: data.customerId, isDeleted: 0 } });
      if (!owned) throw httpError(404, '客户不存在');
    }
    const customerId = data.customerId ?? (await getWalkInCustomer(tx)).id;

    const resolved = [];
    let total = 0;
    for (const item of data.items) {
      const sku = await resolveSkuWithProduct(tx, item);
      total += money(item.quantity * item.unitPrice); // 逐行取整再累加，脏浮点不进总额
      resolved.push({ sku, quantity: item.quantity, unitPrice: item.unitPrice, plan: await stockPlan(tx, sku, item.quantity) });
    }
    const negatives = []; // 扣库存时收集（含配方原料），落库后提示老板补录

    // 折扣：金额优先；否则按折扣率算
    // 金额优先于折扣率。注意用 == null 判断而不是取真假——
    // 老板显式填「优惠 0 元」就是不优惠，不该被折扣率顶掉
    let discountAmount = money(data.discountAmount ?? 0);
    if (data.discountAmount == null && data.discountRate != null) {
      discountAmount = money((total * (100 - data.discountRate)) / 100);
    }
    const actual = money(Math.max(0, total - discountAmount));
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    const paid = settlement(data, actual, { named: customer.name !== '散客' });
    const allocated = allocateCents(cents(actual), resolved.map(r => cents(r.quantity * r.unitPrice)));

    const orderNo = await genOrderNo(tx);
    const order = await tx.order.create({
      data: {
        orderNo,
        customerId,
        status: 'completed',
        totalAmount: total,
        discountRate: data.discountRate ?? null,
        discountAmount,
        actualAmount: actual,
        originalAmount: actual,
        paidAmount: paid,
        settlementAccount: data.settlementAccount ?? null,
        notes: data.notes ?? null,
        operatorId,
        items: {
          create: resolved.map((r, index) => ({
            storeId: getTenantId(), // 嵌套 create 不走扩展层注入，必须显式带
            productId: r.sku.productId,
            skuId: r.sku.id,
            productName: r.sku.product.name,
            specText: r.sku.specText || null,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            // 锁住卖出那一刻的成本，之后改进价不影响这单的利润
            costSnapshot: r.plan.costSnapshot,
            costAmountCents: r.plan.costAmountCents,
            netAmountCents: allocated[index],
            stockSnapshot: JSON.stringify(r.plan.snapshot),
            subtotal: money(r.quantity * r.unitPrice),
          })),
        },
      },
      include: { items: true, customer: true },
    });

    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      negatives.push(...await moveStock(tx, r.plan.snapshot, -1, { operatorId, orderId: order.id, allowNegative, reason: `${r.plan.recipe ? '配方扣料 ' : ''}销售单 ${orderNo}` }));
      await postTrade(tx, 'sale', order, order.items[i]);
    }
    // 开单收款留流水（资金报表/对账单的数据源）
    if (paid > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'in',
          amount: paid,
          account: data.settlementAccount ?? null,
          orderId: order.id,
          customerId,
          note: `开单收款 ${orderNo}`,
          operatorId,
        },
      });
    }
    return { order, negatives };
};
module.exports = { createSale };
