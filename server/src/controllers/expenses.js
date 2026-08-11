const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok, created, fail } = require('../utils/response');

const expenseSchema = z.object({
  category: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().nullish(),
  expenseDate: z.string().optional(), // "2026-08-03" 纯日期或完整 ISO 都收（与 incomes.incomeDate 口径统一）
});

exports.list = async (req, res) => {
  const { page = 1, pageSize = 20, category, startDate, endDate } = req.query;
  const where = {
    ...(category ? { category } : {}),
    ...(startDate || endDate
      ? {
          expenseDate: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(`${endDate}T23:59:59`) } : {}),
          },
        }
      : {}),
  };
  const [total, list] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
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
  const data = expenseSchema.parse(req.body);
  const expense = await prisma.expense.create({
    data: {
      category: data.category,
      amount: data.amount,
      note: data.note ?? null,
      // 纯日期补中午 12 点（与 incomes 一致），避免 UTC 边界把日期挪前一天
      ...(data.expenseDate ? { expenseDate: new Date(/^\d{4}-\d{2}-\d{2}$/.test(data.expenseDate) ? `${data.expenseDate}T12:00:00` : data.expenseDate) } : {}),
      operatorId: req.user.userId,
    },
  });
  return created(res, expense);
};

exports.remove = async (req, res) => {
  const owned = await prisma.expense.findFirst({ where: { id: Number(req.params.id) } }); // 本店归属校验
  if (!owned) return fail(res, 404, '支出记录不存在');
  await prisma.expense.delete({ where: { id: Number(req.params.id) } });
  return ok(res, null, '已删除');
};
