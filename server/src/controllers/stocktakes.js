const { z } = require('zod');
const prisma = require('../config/prisma');
const { getTenantId } = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError } = require('../utils/biz');

const genStocktakeNo = async (tx) => {
  const d = new Date();
  const p = `PD${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const count = await tx.stocktake.count({ where: { orderNo: { startsWith: p } } });
  return `${p}${String(count + 1).padStart(3, '0')}`;
};

const createSchema = z.object({
  productTypeId: z.number().int().nullish(),
  notes: z.string().max(200).nullish(),
  items: z
    .array(z.object({ skuId: z.number().int(), actualQty: z.number().nonnegative() }))
    .min(1, '至少要盘一个商品'),
});

// 提交盘点：账面数以提交那一刻的库存为准（防止盘点中间有开单导致错账），差异直接落库存
exports.create = async (req, res) => {
  const data = createSchema.parse(req.body);

  const result = await prisma.$transaction(async (tx) => {
    const skuIds = data.items.map((i) => i.skuId);
    const skus = await tx.sku.findMany({ where: { id: { in: skuIds } }, include: { product: true, inventory: true } });
    const skuById = new Map(skus.map((s) => [s.id, s]));
    for (const it of data.items) {
      if (!skuById.has(it.skuId)) throw httpError(404, `规格 #${it.skuId} 不存在`);
    }

    const rows = data.items.map((it) => {
      const sku = skuById.get(it.skuId);
      const systemQty = sku.inventory?.quantity ?? 0;
      return { sku, systemQty, actualQty: it.actualQty, diff: it.actualQty - systemQty };
    });
    const diffRows = rows.filter((r) => r.diff !== 0);

    const st = await tx.stocktake.create({
      data: {
        orderNo: await genStocktakeNo(tx),
        productTypeId: data.productTypeId ?? null,
        totalItems: rows.length,
        diffItems: diffRows.length,
        gainQty: diffRows.filter((r) => r.diff > 0).reduce((s, r) => s + r.diff, 0),
        lossQty: diffRows.filter((r) => r.diff < 0).reduce((s, r) => s - r.diff, 0),
        notes: data.notes ?? null,
        operatorId: req.user.userId,
        items: {
          create: rows.map((r) => ({
            storeId: getTenantId(), // 嵌套 create 不走扩展层注入，必须显式带
            skuId: r.sku.id,
            productName: r.sku.product.name,
            specText: r.sku.specText || null,
            systemQty: r.systemQty,
            actualQty: r.actualQty,
            diff: r.diff,
          })),
        },
      },
    });

    // 差异落库存 + 出入库流水（盘盈=inbound 盘亏=outbound）
    for (const r of diffRows) {
      if (r.sku.inventory) {
        await tx.inventory.update({ where: { id: r.sku.inventory.id }, data: { quantity: r.actualQty } });
      } else {
        await tx.inventory.create({ data: { productId: r.sku.productId, skuId: r.sku.id, quantity: r.actualQty } });
      }
      await tx.inventoryRecord.create({
        data: {
          productId: r.sku.productId,
          skuId: r.sku.id,
          type: r.diff > 0 ? 'inbound' : 'outbound',
          quantity: Math.abs(r.diff),
          beforeQuantity: r.systemQty,
          afterQuantity: r.actualQty,
          reason: `盘点${r.diff > 0 ? '盘盈' : '盘亏'}（${st.orderNo}）`,
          operatorId: req.user.userId,
        },
      });
    }

    return st;
  });

  return created(res, result, result.diffItems === 0 ? '盘点完成，账实相符' : `盘点完成，${result.diffItems} 项有出入，库存已更新`);
};

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20 } = req.query;
  const [total, list] = await Promise.all([
    prisma.stocktake.count(),
    prisma.stocktake.findMany({
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
  ]);
  return ok(res, { total, list });
};

exports.detail = async (req, res) => {
  const st = await prisma.stocktake.findUnique({
    where: { id: Number(req.params.id) },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  if (!st) throw httpError(404, '盘点单不存在');
  const operator = await prisma.user.findUnique({ where: { id: st.operatorId }, select: { realName: true } });
  return ok(res, { ...st, operator });
};
