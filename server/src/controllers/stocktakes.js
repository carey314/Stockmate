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
    // actualQty 不在 schema 层卡非负：账面为负的行（卖超未补录）没动过时会按账面原样上送，
    // 一刀切拒掉会把整张盘点单堵死（真人测试踩到：轩尼诗账面 -1，提交整单报英文参数错误）。
    // 负数的合法性在下面按行判——那里拿得到商品名，报错能说人话。
    .array(z.object({ skuId: z.number().int(), actualQty: z.number() }))
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
    // 实盘数不能是负数——货架上数不出 -1 瓶。唯一放行：账面本来就是负的且没动过
    // （actual == 账面，diff=0），语义是"这项没法盘，保持现状"，记为盘平不动库存。
    // 卖超的负库存应该走「进货单/出入库」补录修正，不允许在盘点里硬填负数。
    const badNeg = rows.find((r) => r.actualQty < 0 && r.diff !== 0);
    if (badNeg) {
      const label = `${badNeg.sku.product.name}${badNeg.sku.specText ? ` ${badNeg.sku.specText}` : ''}`;
      throw httpError(400, `「${label}」的实盘数不能填负数。它账面是 ${badNeg.systemQty}，先在这行保持不动，用进货单把欠的货补录进来再盘`);
    }
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
