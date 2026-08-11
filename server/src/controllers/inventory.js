const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok } = require('../utils/response');
const { httpError } = require('../utils/biz');

const moveSchema = z.object({
  skuId: z.number().int().optional(),
  productId: z.number().int().optional(), // 兼容：不传 skuId 时落到该商品默认规格
  quantity: z.number().positive('数量须为正数'), // 支持散称 0.5 斤
  reason: z.string().nullish(),
});

// 解析目标 SKU
const resolveSku = async (tx, { skuId, productId }) => {
  if (skuId) {
    const sku = await tx.sku.findUnique({ where: { id: skuId } });
    if (!sku) throw httpError(404, '规格不存在');
    return sku;
  }
  if (productId) {
    const sku = await tx.sku.findFirst({ where: { productId, status: 1 }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
    if (!sku) throw httpError(404, '商品无可用规格');
    return sku;
  }
  throw httpError(400, '需提供 skuId 或 productId');
};

// 入库/出库共用事务（SKU 维度）
const move = async (type, input, operatorId) => {
  return prisma.$transaction(async (tx) => {
    const sku = await resolveSku(tx, input);
    let inv = await tx.inventory.findUnique({ where: { skuId: sku.id } });
    if (!inv) inv = await tx.inventory.create({ data: { productId: sku.productId, skuId: sku.id } });
    const before = inv.quantity;
    const after = type === 'inbound' ? before + input.quantity : before - input.quantity;
    if (after < 0) throw httpError(400, `库存不足：当前 ${before}，欲出 ${input.quantity}`);
    await tx.inventory.update({ where: { id: inv.id }, data: { quantity: after } });
    return tx.inventoryRecord.create({
      data: {
        productId: sku.productId,
        skuId: sku.id,
        type,
        quantity: input.quantity,
        beforeQuantity: before,
        afterQuantity: after,
        reason: input.reason ?? null,
        operatorId,
      },
    });
  });
};

exports.inbound = async (req, res) => {
  const data = moveSchema.parse(req.body);
  const record = await move('inbound', data, req.user.userId);
  return ok(res, record, '入库成功');
};

exports.outbound = async (req, res) => {
  const data = moveSchema.parse(req.body);
  const record = await move('outbound', data, req.user.userId);
  // 报损/过期这类出库是真金白银的损失，按成本自动记一笔「库存损耗」开销，
  // 否则利润永远虚高（货悄悄没了，账上却看不到成本）。
  let lossBooked = 0;
  if (data.reason && /报损|过期|损坏|丢失|被偷|变质|自用/.test(data.reason)) {
    const sku = await prisma.sku.findUnique({ where: { id: record.skuId }, include: { product: true } });
    const cost = sku?.costPrice ?? sku?.product?.costPrice ?? 0;
    if (cost > 0) {
      lossBooked = Math.round(data.quantity * cost * 100) / 100;
      await prisma.expense.create({
        data: {
          category: '库存损耗',
          amount: lossBooked,
          note: `${data.reason}·${sku.product.name}${sku.specText ? ` ${sku.specText}` : ''} ×${data.quantity}`,
          operatorId: req.user.userId,
        },
      });
    }
  }
  return ok(res, { ...record, lossBooked }, lossBooked > 0 ? `出库成功，已按成本记损耗 ¥${lossBooked}` : '出库成功');
};

// 库存调整（盘点/纠错）：直接设为目标数量，差额自动生成可审计的出入库流水
exports.adjust = async (req, res) => {
  const { skuId, quantity, reason } = z
    .object({ skuId: z.number().int(), quantity: z.number().nonnegative(), reason: z.string().nullish() })
    .parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const sku = await tx.sku.findUnique({ where: { id: skuId } });
    if (!sku) throw httpError(404, '规格不存在');
    let inv = await tx.inventory.findUnique({ where: { skuId } });
    if (!inv) inv = await tx.inventory.create({ data: { productId: sku.productId, skuId } });
    const before = inv.quantity;
    if (before === quantity) return { changed: false, quantity };
    await tx.inventory.update({ where: { id: inv.id }, data: { quantity } });
    await tx.inventoryRecord.create({
      data: {
        productId: sku.productId,
        skuId,
        type: quantity > before ? 'inbound' : 'outbound',
        quantity: Math.abs(quantity - before),
        beforeQuantity: before,
        afterQuantity: quantity,
        reason: reason ?? '手动调整库存',
        operatorId: req.user.userId,
      },
    });
    return { changed: true, before, quantity };
  });
  return ok(res, result, result.changed ? '库存已调整' : '库存无变化');
};

// 库存列表（SKU 行）
exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, productTypeId, lowStockOnly } = req.query;
  const where = {
    sku: { status: 1, product: { isDeleted: 0, ...(productTypeId ? { productTypeId: Number(productTypeId) } : {}) } },
  };
  const [total, listRaw] = await Promise.all([
    prisma.inventory.count({ where }),
    prisma.inventory.findMany({
      where,
      include: { sku: { include: { product: { include: { productType: true } } } } },
      orderBy: { updatedAt: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  let list = listRaw.map((i) => ({
    ...i,
    sku: i.sku ? { ...i.sku, specValues: JSON.parse(i.sku.specValues || '{}') } : null,
    isLow: i.quantity <= i.minQuantity && i.minQuantity > 0,
  }));
  if (lowStockOnly === '1') list = list.filter((i) => i.isLow);
  return ok(res, {
    list,
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};

// 库存预警
exports.alerts = async (_req, res) => {
  const all = await prisma.inventory.findMany({
    where: { minQuantity: { gt: 0 }, sku: { status: 1, product: { isDeleted: 0 } } },
    include: { sku: { include: { product: true } } },
  });
  const low = all
    .filter((i) => i.quantity <= i.minQuantity)
    .map((i) => ({ ...i, sku: i.sku ? { ...i.sku, specValues: JSON.parse(i.sku.specValues || '{}') } : null }));
  return ok(res, low);
};

// 出入库流水
exports.records = async (req, res) => {
  const { page = 1, pageSize = 20, productId, skuId, type } = req.query;
  const where = {
    ...(productId ? { productId: Number(productId) } : {}),
    ...(skuId ? { skuId: Number(skuId) } : {}),
    ...(type ? { type } : {}),
  };
  const [total, list] = await Promise.all([
    prisma.inventoryRecord.count({ where }),
    prisma.inventoryRecord.findMany({
      where,
      include: { product: true, sku: true, operator: { select: { id: true, realName: true } } },
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return ok(res, {
    list,
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};
