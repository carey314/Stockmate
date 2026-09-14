const { settlePayment, reverseTrade } = require('../services/reversals');
const { confirmedPurchase } = require('../services/purchaseConfirmation');
const { transaction } = require('../utils/transaction');
const prisma = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError, money } = require('../utils/biz');

exports.create = async (req, res) => {
  const po = await confirmedPurchase(req.body, req.user.userId);
  return created(res, { ...po, unpaidAmount: money(po.actualAmount - po.paidAmount) }, '进货入库成功');
};

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, supplierId, startDate, endDate, unpaidOnly, keyword, status } = req.query;
  const where = {
    ...(status ? { status } : {}),
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
exports.pay = async (req, res) => ok(res, await transaction(tx => settlePayment(tx, 'purchase', Number(req.params.id), req.body, req.user.userId)), '已收付款');

exports.returnItems = async (req, res) => ok(res, await transaction(tx => reverseTrade(tx, 'purchase', Number(req.params.id), req.body, req.user.userId)), '退货成功');

exports.markPrinted = async (req, res) => {
  const owned = await prisma.purchaseOrder.findFirst({ where: { id: Number(req.params.id) } }); // 本店归属校验
  if (!owned) throw httpError(404, '进货单不存在');
  const updated = await prisma.purchaseOrder.update({ where: { id: Number(req.params.id) }, data: { printedAt: new Date() } });
  return ok(res, updated);
};

// 取消进货单：库存回退
exports.cancel = async (req, res) => ok(res, await transaction(tx => reverseTrade(tx, 'purchase', Number(req.params.id), req.body, req.user.userId, true)), '单据已取消');
