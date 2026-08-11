const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError } = require('../utils/biz');

const customerSchema = z.object({
  name: z.string().min(1, '客户名称不能为空'),
  contactPerson: z.string().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  notes: z.string().nullish(),
  productTypeId: z.number().int().nullish(), // 主营品类（null=不限）
});

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, keyword } = req.query;
  const where = {
    isDeleted: 0,
    ...(keyword ? { OR: [{ name: { contains: keyword } }, { phone: { contains: keyword } }] } : {}),
  };
  const [total, list, unpaidOrders] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
    // 每个客户当前欠多少：催账是客户列表最重要的用途，直接标在行上
    prisma.order.findMany({
      where: { status: 'completed', NOT: { paidAmount: { equals: prisma.order.fields.actualAmount } } },
      select: { customerId: true, actualAmount: true, paidAmount: true },
    }),
  ]);
  const owedMap = {};
  for (const o of unpaidOrders) {
    owedMap[o.customerId] = (owedMap[o.customerId] ?? 0) + (o.actualAmount - o.paidAmount);
  }
  return ok(res, {
    list: list.map((c) => ({
      ...c,
      owed: Math.round((owedMap[c.id] ?? 0) * 100) / 100,
      unpaidCount: unpaidOrders.filter((o) => o.customerId === c.id).length,
    })),
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};

exports.detail = async (req, res) => {
  const id = Number(req.params.id);
  const customer = await prisma.customer.findFirst({ where: { id, isDeleted: 0 } });
  if (!customer) throw httpError(404, '客户不存在');
  return ok(res, customer);
};

const assertTypeOwned = async (productTypeId) => {
  if (productTypeId == null) return;
  const owned = await prisma.productType.findFirst({ where: { id: productTypeId, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '品类不存在');
};

exports.create = async (req, res) => {
  const data = customerSchema.parse(req.body);
  await assertTypeOwned(data.productTypeId);
  const customer = await prisma.customer.create({ data });
  return created(res, customer);
};

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const data = customerSchema.partial().parse(req.body);
  const owned = await prisma.customer.findFirst({ where: { id, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '客户不存在');
  await assertTypeOwned(data.productTypeId);
  const customer = await prisma.customer.update({ where: { id }, data });
  return ok(res, customer);
};

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  const owned = await prisma.customer.findFirst({ where: { id, isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '客户不存在');
  await prisma.customer.update({ where: { id }, data: { isDeleted: 1 } });
  return ok(res, null, '已删除');
};

// 客户专属价格列表
exports.prices = async (req, res) => {
  const customerId = Number(req.params.id);
  const rules = await prisma.pricingRule.findMany({
    where: { customerId },
    include: { product: { select: { id: true, name: true, code: true, defaultPrice: true, unit: true } } },
  });
  return ok(res, rules);
};


// 该客户常买什么：近90天按数量排前8（开单时一键加购）
exports.frequent = async (req, res) => {
  const customerId = Number(req.params.id);
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const items = await prisma.orderItem.findMany({
    where: { order: { customerId, status: 'completed', createdAt: { gte: since } }, skuId: { not: null } },
    select: { skuId: true, productId: true, productName: true, specText: true, quantity: true, unitPrice: true, order: { select: { createdAt: true } } },
    orderBy: { id: 'desc' },
  });
  const agg = {};
  for (const it of items) {
    const a = (agg[it.skuId] ??= { skuId: it.skuId, productId: it.productId, productName: it.productName, specText: it.specText, totalQty: 0, lastPrice: it.unitPrice, lastAt: it.order.createdAt });
    a.totalQty += it.quantity;
    if (it.order.createdAt > a.lastAt) { a.lastPrice = it.unitPrice; a.lastAt = it.order.createdAt; }
  }
  const top = Object.values(agg).sort((a, b) => b.totalQty - a.totalQty).slice(0, 8);
  return ok(res, top);
};
