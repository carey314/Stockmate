const { z } = require('zod');
const prisma = require('../config/prisma');
const { getTenantId } = require('../config/prisma');
const { ok, created } = require('../utils/response');
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
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(), // 进价
      })
    )
    .min(1, '进货单至少一件商品'),
});

exports.create = async (req, res) => {
  const data = poSchema.parse(req.body);
  const operatorId = req.user.userId;

  const po = await prisma.$transaction(async (tx) => {
    const resolved = [];
    let total = 0;
    for (const item of data.items) {
      const sku = await tx.sku.findUnique({ where: { id: item.skuId }, include: { product: true, inventory: true } });
      if (!sku || sku.product.isDeleted) throw httpError(404, `规格 ${item.skuId} 不存在`);
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
    const paid = data.paidAmount ?? actual;

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
        paidAmount: paid,
        settlementAccount: data.settlementAccount ?? null,
        notes: data.notes ?? null,
        operatorId,
        items: {
          create: resolved.map((r) => ({
            storeId: getTenantId(), // 嵌套 create 不走扩展层注入，必须显式带
            skuId: r.sku.id,
            productName: r.sku.product.name,
            specText: r.sku.specText || null,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            subtotal: money(r.quantity * r.unitPrice),
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
      const after = before + r.quantity;
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
  });

  return created(res, { ...po, unpaidAmount: po.actualAmount - po.paidAmount }, '进货入库成功');
};

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, supplierId, startDate, endDate, unpaidOnly, keyword } = req.query;
  const where = {
    ...(supplierId ? { supplierId: Number(supplierId) } : {}),
    // 模糊查询：单号或供应商名（Web 列表搜索框用）
    ...(keyword ? { OR: [{ orderNo: { contains: keyword } }, { supplier: { name: { contains: keyword } } }] } : {}),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(`${endDate}T23:59:59`) } : {}),
          },
        }
      : {}),
  };
  // 只看欠供应商：下推进 where（对齐 orders.list），否则「取完当页再 filter」会让 total 和实际条数对不上
  if (unpaidOnly === '1') {
    where.status = 'completed';
    where.NOT = { paidAmount: { equals: prisma.purchaseOrder.fields.actualAmount } };
  }
  const [total, listRaw] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } }, _count: { select: { items: true } } },
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  const list = listRaw.map((o) => ({ ...o, unpaidAmount: Math.round((o.actualAmount - o.paidAmount) * 100) / 100 }));
  return ok(res, {
    list,
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};

exports.detail = async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: true, supplier: true, operator: { select: { id: true, realName: true } } },
  });
  if (!po) throw httpError(404, '进货单不存在');
  return ok(res, { ...po, unpaidAmount: Math.round((po.actualAmount - po.paidAmount) * 100) / 100 });
};

// 付款（补付欠供应商的款）
exports.pay = async (req, res) => {
  const id = Number(req.params.id);
  const { amount, settlementAccount } = z
    .object({ amount: z.number().positive(), settlementAccount: z.string().nullish() })
    .parse(req.body);
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw httpError(404, '进货单不存在');
  const unpaid = po.actualAmount - po.paidAmount;
  if (amount > unpaid + 0.001) throw httpError(400, `付款超出欠款（欠 ¥${unpaid.toFixed(2)}）`);
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { paidAmount: po.paidAmount + amount, ...(settlementAccount ? { settlementAccount } : {}) },
  });
  await prisma.paymentRecord.create({
    data: {
      direction: 'out',
      amount,
      account: settlementAccount ?? po.settlementAccount,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      note: `付欠款 ${po.orderNo}`,
      operatorId: req.user.userId,
    },
  });
  return ok(res, { ...updated, unpaidAmount: updated.actualAmount - updated.paidAmount }, '已付款');
};

// 进货退货：退给供应商（库存扣减 + 应付冲减 + 多付部分记退回款）
exports.returnItems = async (req, res) => {
  const id = Number(req.params.id);
  const { items, account } = z
    .object({
      items: z.array(z.object({ itemId: z.number().int(), quantity: z.number().positive() })).min(1),
      account: z.string().nullish(),
    })
    .parse(req.body);
  const operatorId = req.user.userId;

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw httpError(404, '进货单不存在');
    if (po.status !== 'completed') throw httpError(400, '只有已完成进货单可以退货');

    let returnValue = 0;
    for (const r of items) {
      const item = po.items.find((x) => x.id === r.itemId);
      if (!item) throw httpError(404, `明细 ${r.itemId} 不属于该进货单`);
      const returnable = item.quantity - item.returnedQty;
      if (r.quantity > returnable) throw httpError(400, `「${item.productName}」最多可退 ${returnable} 件`);

      const inv = await tx.inventory.findUnique({ where: { skuId: item.skuId } });
      const stock = inv?.quantity ?? 0;
      if (stock < r.quantity) throw httpError(400, `「${item.productName}」库存仅剩 ${stock}，不够退给供应商`);
      await tx.inventory.update({ where: { skuId: item.skuId }, data: { quantity: stock - r.quantity } });
      const sku = await tx.sku.findUnique({ where: { id: item.skuId }, select: { productId: true } });
      await tx.inventoryRecord.create({
        data: {
          productId: sku.productId,
          skuId: item.skuId,
          type: 'outbound',
          quantity: r.quantity,
          beforeQuantity: stock,
          afterQuantity: stock - r.quantity,
          reason: `进货退货（${po.orderNo}）`,
          relatedPurchaseOrderId: po.id,
          operatorId,
        },
      });
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { returnedQty: item.returnedQty + r.quantity } });
      returnValue += r.quantity * item.unitPrice;
    }

    returnValue = Math.round(returnValue * 100) / 100;
    // 镜像销售退货：给供应商的退货也留冲减记录（供应商对账单据此显示往来行）
    await tx.paymentRecord.create({
      data: {
        direction: 'out', // 冲减我欠供应商的应付
        amount: returnValue,
        account: '冲账',
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        note: `退货冲减 ${po.orderNo}`,
        operatorId,
      },
    });
    const newActual = Math.round((po.actualAmount - returnValue) * 100) / 100;
    const refundIn = Math.max(0, Math.round((po.paidAmount - newActual) * 100) / 100);
    const newPaid = Math.round((po.paidAmount - refundIn) * 100) / 100;
    await tx.purchaseOrder.update({ where: { id }, data: { actualAmount: newActual, paidAmount: newPaid } });

    if (refundIn > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'in',
          amount: refundIn,
          account: account ?? po.settlementAccount,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          note: `进货退货退回款 ${po.orderNo}`,
          operatorId,
        },
      });
    }
    return { returnValue, refundIn, newActual, newPaid };
  });

  return ok(res, result, `已退货给供应商：冲减应付 ¥${result.returnValue}${result.refundIn > 0 ? `，收回退款 ¥${result.refundIn}` : ''}`);
};

exports.markPrinted = async (req, res) => {
  const owned = await prisma.purchaseOrder.findFirst({ where: { id: Number(req.params.id) } }); // 本店归属校验
  if (!owned) throw httpError(404, '进货单不存在');
  const updated = await prisma.purchaseOrder.update({ where: { id: Number(req.params.id) }, data: { printedAt: new Date() } });
  return ok(res, updated);
};

// 取消进货单：库存回退
exports.cancel = async (req, res) => {
  const id = Number(req.params.id);
  const operatorId = req.user.userId;
  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw httpError(404, '进货单不存在');
    if (po.status !== 'completed') throw httpError(400, '只有已完成进货单可以取消');
    for (const item of po.items) {
      // 只扣回「还在库里」的净数量：已退货给供应商的部分在退货时就扣过库存，
      // 这里再按原始 quantity 扣会把退货过的货重复扣掉（先退货再作废时库存扣穿）。
      const netQty = item.quantity - (item.returnedQty ?? 0);
      if (netQty <= 0) continue;
      const inv = await tx.inventory.findUnique({ where: { skuId: item.skuId } });
      const before = inv?.quantity ?? 0;
      const after = before - netQty;
      if (after < 0) throw httpError(400, `「${item.productName}」库存已被消耗，无法取消`);
      const sku = await tx.sku.findUnique({ where: { id: item.skuId }, select: { productId: true } });
      await tx.inventory.update({ where: { skuId: item.skuId }, data: { quantity: after } });
      await tx.inventoryRecord.create({
        data: {
          productId: sku.productId,
          skuId: item.skuId,
          type: 'outbound',
          quantity: netQty,
          beforeQuantity: before,
          afterQuantity: after,
          reason: `取消进货单 ${po.orderNo} 回退`,
          relatedPurchaseOrderId: po.id,
          operatorId,
        },
      });
    }
    // 付过钱的进货单取消：生成收回流水（direction=in），账实一致
    if (po.paidAmount > 0) {
      await tx.paymentRecord.create({
        data: {
          direction: 'in',
          amount: po.paidAmount,
          account: po.settlementAccount ?? null,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          note: `取消进货单退款收回 ${po.orderNo ?? po.poNo ?? id}`,
          operatorId,
        },
      });
    }
    return tx.purchaseOrder.update({ where: { id }, data: { status: 'cancelled' } });
  });
  return ok(res, result, '进货单已取消，库存已回退');
};
