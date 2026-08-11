const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError } = require('../utils/biz');

const ruleSchema = z.object({
  skuId: z.number().int().optional(),
  productId: z.number().int().optional(), // 兼容：无 skuId 落默认规格
  customerId: z.number().int(),
  price: z.number().nonnegative(),
});

const resolveSkuId = async ({ skuId, productId }) => {
  if (skuId) return skuId;
  if (productId) {
    const sku = await prisma.sku.findFirst({ where: { productId, status: 1 }, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
    if (!sku) throw httpError(404, '商品无可用规格');
    return sku.id;
  }
  throw httpError(400, '需提供 skuId 或 productId');
};

exports.list = async (req, res) => {
  const { customerId, productId, skuId } = req.query;
  const rules = await prisma.pricingRule.findMany({
    where: {
      ...(customerId ? { customerId: Number(customerId) } : {}),
      ...(productId ? { productId: Number(productId) } : {}),
      ...(skuId ? { skuId: Number(skuId) } : {}),
    },
    include: {
      product: { select: { id: true, name: true, code: true } },
      sku: { select: { id: true, specText: true, price: true } },
      customer: { select: { id: true, name: true } },
    },
  });
  return ok(res, rules);
};

// 设置专属价（SKU 级 upsert）
exports.upsert = async (req, res) => {
  const data = ruleSchema.parse(req.body);
  const skuId = await resolveSkuId(data);
  // 本店归属校验：sku 和 customer 都必须是本店的（findFirst 自动并 storeId）
  const sku = await prisma.sku.findFirst({ where: { id: skuId }, select: { id: true, productId: true } });
  if (!sku) throw httpError(404, '规格不存在');
  const customer = await prisma.customer.findFirst({ where: { id: data.customerId, isDeleted: 0 } });
  if (!customer) throw httpError(404, '客户不存在');
  const rule = await prisma.pricingRule.upsert({
    where: { skuId_customerId: { skuId, customerId: data.customerId } },
    create: { skuId, productId: sku.productId, customerId: data.customerId, price: data.price },
    update: { price: data.price },
  });
  return created(res, rule);
};

exports.remove = async (req, res) => {
  const owned = await prisma.pricingRule.findFirst({ where: { id: Number(req.params.id) } }); // 本店归属校验
  if (!owned) throw httpError(404, '规则不存在');
  await prisma.pricingRule.delete({ where: { id: Number(req.params.id) } });
  return ok(res, null, '已删除');
};

// 价格解析三级：客户专属价 > 该客户上次成交价 > SKU 标价
// （"按上次价"是批发行业的默认心智——同一客户同一规格自动记住上次卖多少）
const resolvePriceForCustomer = async (skuId, customerId) => {
  const [rule, lastItem, sku] = await Promise.all([
    prisma.pricingRule.findUnique({ where: { skuId_customerId: { skuId, customerId } } }),
    prisma.orderItem.findFirst({
      where: { skuId, order: { customerId, status: 'completed' } },
      orderBy: { id: 'desc' },
      select: { unitPrice: true },
    }),
    prisma.sku.findUnique({ where: { id: skuId }, select: { price: true } }),
  ]);
  if (rule) return { skuId, price: rule.price, source: 'customer' };
  if (lastItem) return { skuId, price: lastItem.unitPrice, source: 'last' };
  return { skuId, price: sku?.price ?? 0, source: 'default' };
};
exports.resolvePriceForCustomer = resolvePriceForCustomer;

exports.resolve = async (req, res) => {
  const q = z
    .object({
      customerId: z.coerce.number().int(),
      skuId: z.coerce.number().int().optional(),
      productId: z.coerce.number().int().optional(),
    })
    .parse(req.query);
  const skuId = await resolveSkuId(q);
  return ok(res, await resolvePriceForCustomer(skuId, q.customerId));
};
