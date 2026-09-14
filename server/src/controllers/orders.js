const { settlePayment, reverseTrade } = require('../services/reversals');
const { confirmSale } = require('../services/saleConfirmation');
const { transaction } = require('../utils/transaction');
const prisma = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError, money } = require('../utils/biz');

exports.create = async (req, res) => {
  const { order, negatives, requestId, replayed } = await confirmSale(req.body, req.user.userId);
  return created(res, { ...order, ...(requestId ? { requestId, replayed } : {}), unpaidAmount: money(order.actualAmount - order.paidAmount), negativeStock: negatives }, negatives.length ? '开单成功，但库存变成负数，请补录进货' : '开单成功');
};

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, customerId, status, startDate, endDate, unpaidOnly, keyword } = req.query;
  const where = {
    ...(customerId ? { customerId: Number(customerId) } : {}),
    ...(status ? { status } : {}),
    // 模糊查询：单号或客户名（Web 列表搜索框 / Cmd+K 全局搜索用）
    ...(keyword ? { OR: [{ orderNo: { contains: keyword } }, { customer: { name: { contains: keyword } } }] } : {}),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(`${endDate}T23:59:59`) } : {}),
          },
        }
      : {}),
  };
  // 只看欠款：必须进 where 一起查，不能取完当页再过滤。
  // 原来是 take 之后 filter，等于「在这 20 条里挑欠款的」——
  // total 也是全量数，App 上的欠款合计和条数全是错的。
  if (unpaidOnly === '1') {
    where.status = 'completed';
    // SQLite/Prisma 不支持字段间比较，用原始条件表达 paidAmount < actualAmount
    where.NOT = { paidAmount: { equals: prisma.order.fields.actualAmount } };
  }
  const [total, listRaw] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { customer: { select: { id: true, name: true } }, _count: { select: { items: true } } },
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
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, customer: true, operator: { select: { id: true, realName: true } } },
  });
  if (!order) throw httpError(404, '订单不存在');
  return ok(res, { ...order, unpaidAmount: Math.round((order.actualAmount - order.paidAmount) * 100) / 100 });
};

// 收款（补收欠款）
exports.receivePayment = async (req, res) => ok(res, await transaction(tx => settlePayment(tx, 'sale', Number(req.params.id), req.body, req.user.userId)), '已收付款');

exports.returnItems = async (req, res) => ok(res, await transaction(tx => reverseTrade(tx, 'sale', Number(req.params.id), req.body, req.user.userId)), '退货成功');

exports.markPrinted = async (req, res) => {
  const id = Number(req.params.id);
  const owned = await prisma.order.findFirst({ where: { id } }); // 本店归属校验
  if (!owned) throw httpError(404, '订单不存在');
  const updated = await prisma.order.update({ where: { id }, data: { printedAt: new Date() } });
  return ok(res, updated);
};

// 取消订单：回退库存（SKU 维度）
exports.cancel = async (req, res) => ok(res, await transaction(tx => reverseTrade(tx, 'sale', Number(req.params.id), req.body, req.user.userId, true)), '单据已取消');
