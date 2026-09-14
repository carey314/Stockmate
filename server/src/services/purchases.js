const { z } = require('zod');
const { getTenantId } = require('../config/prisma');
const { httpError, genPurchaseNo, money } = require('../utils/biz');

// 进货单：供应商 + 明细(SKU/数量/进价) + 折扣 + 实付/欠款 + 结算账户
// 提交即入库 + 更新 SKU 成本价
const poSchema = z.object({
  supplierId: z.number().int().nullish(),
  notes: z.string().nullish(),
  discountRate: z.number().min(0).max(100).nullish(),
  discountAmount: z.number().nonnegative().optional(),
  paidAmount: z.number().nonnegative().optional(),
  settlementAccount: z.string().nullish(),
  items: z
    .array(
      z.object({
        skuId: z.number().int(),
        quantity: z.number().finite().positive().refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7, '数量最多三位小数'),
        unitPrice: z.number().nonnegative(), // 进价
      })
    )
    .min(1, '进货单至少一件商品'),
});

const { allocateCents, cents, postTrade, settlement } = require('../utils/trade');
const createPurchase = async (tx, input, operatorId) => {
  const data = poSchema.parse(input);
    const resolved = [];
    let total = 0;
    for (const item of data.items) {
      const sku = await tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true, inventory: true } });
      if (!sku || sku.status !== 1 || sku.product.isDeleted) throw httpError(404, `规格 ${item.skuId} 不存在`);
      total += money(item.quantity * item.unitPrice); // 逐行取整再累加，脏浮点不进总额
      resolved.push({ sku, ...item });
    }

    // 金额优先于折扣率。注意用 == null 判断而不是取真假——
    // 老板显式填「优惠 0 元」就是不优惠，不该被折扣率顶掉
    let discountAmount = money(data.discountAmount ?? 0);
    if (data.discountAmount == null && data.discountRate != null) {
      discountAmount = money((total * (100 - data.discountRate)) / 100);
    }
    const actual = money(Math.max(0, total - discountAmount));
    const paid = settlement(data, actual, { purchase: true, named: !!data.supplierId });
    const allocated = allocateCents(cents(actual), resolved.map(r => cents(r.quantity * r.unitPrice)));

    // 本店归属校验：指定了供应商必须是本店的
    if (data.supplierId) {
      const owned = await tx.supplier.findFirst({ where: { id: data.supplierId, isDeleted: 0 } });
      if (!owned) throw httpError(404, '供应商不存在');
    }
    const orderNo = await genPurchaseNo(tx);
    const po = await tx.purchaseOrder.create({
      data: {
        orderNo,
        supplierId: data.supplierId ?? null,
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
            skuId: r.sku.id,
            productName: r.sku.product.name,
            specText: r.sku.specText || null,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            subtotal: money(r.quantity * r.unitPrice),
            netAmountCents: allocated[index],
          })),
        },
      },
      include: { items: true, supplier: true },
    });

    // 入库 + 更新成本价（最新进价）
    for (const r of resolved) {
      let inv = await tx.inventory.findUnique({ where: { skuId: r.sku.id } });
      if (!inv) inv = await tx.inventory.create({ data: { productId: r.sku.productId, skuId: r.sku.id } });
      const before = inv.quantity;
      const after = Math.round((before + r.quantity) * 1000) / 1000;
      await tx.inventory.update({ where: { id: inv.id }, data: { quantity: after } });
      await tx.inventoryRecord.create({
        data: {
          productId: r.sku.productId,
          skuId: r.sku.id,
          type: 'inbound',
          quantity: r.quantity,
          beforeQuantity: before,
          afterQuantity: after,
          reason: `进货单 ${orderNo}`,
          relatedPurchaseOrderId: po.id,
          operatorId,
        },
      });
      await tx.sku.update({ where: { id: r.sku.id }, data: { costPrice: r.unitPrice } });
    }
    for (const item of po.items) await postTrade(tx, 'purchase', po, item);
    // 进货付款留流水
    if (paid > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'out',
          amount: paid,
          account: data.settlementAccount ?? null,
          purchaseOrderId: po.id,
          supplierId: data.supplierId ?? null,
          note: `进货付款 ${orderNo}`,
          operatorId,
        },
      });
    }
    return po;
};
module.exports = { createPurchase };
