const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok, created } = require('../utils/response');
const { httpError } = require('../utils/biz');

const supplierSchema = z.object({
  name: z.string().min(1, '供应商名称不能为空'),
  contactPerson: z.string().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  notes: z.string().nullish(),
});

exports.list = async (req, res) => {
  const { page = 1, pageSize = 50, keyword } = req.query;
  const where = {
    isDeleted: 0,
    ...(keyword ? { OR: [{ name: { contains: keyword } }, { phone: { contains: keyword } }] } : {}),
  };
  const [total, list, unpaidPos] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
    }),
    // 每个供应商当前欠多少（应付）：口径同客户列表——完成的进货单 actualAmount 未付满的部分
    prisma.purchaseOrder.findMany({
      where: { status: 'completed', supplierId: { not: null }, NOT: { paidAmount: { equals: prisma.purchaseOrder.fields.actualAmount } } },
      select: { supplierId: true, actualAmount: true, paidAmount: true },
    }),
  ]);
  const owedMap = {};
  const cntMap = {};
  for (const po of unpaidPos) {
    owedMap[po.supplierId] = (owedMap[po.supplierId] ?? 0) + (po.actualAmount - po.paidAmount);
    cntMap[po.supplierId] = (cntMap[po.supplierId] ?? 0) + 1;
  }
  return ok(res, {
    // owed=欠供应商多少（新增字段，App 不依赖）
    list: list.map((s) => ({ ...s, owed: Math.round((owedMap[s.id] ?? 0) * 100) / 100, unpaidCount: cntMap[s.id] ?? 0 })),
    pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
  });
};

exports.detail = async (req, res) => {
  const supplier = await prisma.supplier.findFirst({ where: { id: Number(req.params.id), isDeleted: 0 } });
  if (!supplier) throw httpError(404, '供应商不存在');
  return ok(res, supplier);
};

exports.create = async (req, res) => {
  const data = supplierSchema.parse(req.body);
  return created(res, await prisma.supplier.create({ data }));
};

exports.update = async (req, res) => {
  const data = supplierSchema.partial().parse(req.body);
  const owned = await prisma.supplier.findFirst({ where: { id: Number(req.params.id), isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '供应商不存在');
  return ok(res, await prisma.supplier.update({ where: { id: Number(req.params.id) }, data }));
};

exports.remove = async (req, res) => {
  const owned = await prisma.supplier.findFirst({ where: { id: Number(req.params.id), isDeleted: 0 } }); // 本店归属校验
  if (!owned) throw httpError(404, '供应商不存在');
  await prisma.supplier.update({ where: { id: Number(req.params.id) }, data: { isDeleted: 1 } });
  return ok(res, null, '已删除');
};
