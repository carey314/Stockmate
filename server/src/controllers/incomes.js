const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok, created, fail } = require('../utils/response');

// 收入流水：日结营业额 / 口述未建档卖出 都落这里
const incomeSchema = z.object({
  source: z.string().min(1), // 如"日结营业额"
  amount: z.number().positive(),
  note: z.string().nullish(),
  incomeDate: z.string().optional(), // "2026-08-01"，不传=现在
});

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, startDate, endDate } = req.query;
  const where = {
    ...(startDate || endDate
      ? {
          incomeDate: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(`${endDate}T23:59:59`) } : {}),
          },
        }
      : {}),
  };
  const [total, list] = await Promise.all([
    prisma.income.count({ where }),
    prisma.income.findMany({
      where,
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

exports.create = async (req, res) => {
  const data = incomeSchema.parse(req.body);
  const income = await prisma.income.create({
    data: {
      source: data.source,
      amount: data.amount,
      note: data.note ?? null,
      ...(data.incomeDate ? { incomeDate: new Date(`${data.incomeDate}T12:00:00`) } : {}),
      operatorId: req.user.userId,
    },
  });
  return created(res, income);
};

exports.remove = async (req, res) => {
  const owned = await prisma.income.findFirst({ where: { id: Number(req.params.id) } }); // 本店归属校验
  if (!owned) return fail(res, 404, '收入记录不存在');
  await prisma.income.delete({ where: { id: Number(req.params.id) } });
  return ok(res, null, '已删除');
};
