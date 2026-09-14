const prisma = require('../config/prisma');
const { localDayKey, money, httpError } = require('../utils/biz');
const { ok } = require('../utils/response');
const { projectTrades, costSummary, orderCount } = require('../services/tradeProjection');

// 看板与经营报表使用相同发生期事件；旧单今天退货也冲减今天的销售和成本。
exports.overview = async (_req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setHours(23, 59, 59, 999);
  const [projection, productCount, inventories, expenses, incomes] = await Promise.all([
    projectTrades('sale', start, end),
    prisma.product.count({ where: { isDeleted: 0 } }),
    prisma.inventory.findMany({
      where: { minQuantity: { gt: 0 }, sku: { status: 1, product: { isDeleted: 0 } } },
      select: { quantity: true, minQuantity: true },
    }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } }, select: { amount: true } }),
    prisma.income.findMany({ where: { incomeDate: { gte: start, lte: end } }, select: { amount: true } }),
  ]);
  const todaySales = money(projection.rows.reduce((s, row) => s + row.netAmount, 0) + incomes.reduce((s, i) => s + i.amount, 0));
  const todayExpenses = money(expenses.reduce((s, e) => s + e.amount, 0));
  const costs = costSummary(projection.rows);
  return ok(res, {
    todaySales, todayOrderCount: orderCount(projection.rows, 'sale'), todayExpenses,
    todayCogs: costs.cogs, todayProfit: money(todaySales - costs.cogs - todayExpenses),
    profitUnreliable: costs.profitUnreliable, noCostSales: costs.noCostSales, noCostProductNames: costs.noCostProductNames,
    historyIncomplete: projection.historyIncomplete,
    lowStockCount: inventories.filter(i => i.quantity <= i.minQuantity).length, productCount,
  });
};

// 销售趋势仅汇总商品交易；不把额外收入混成订单销售。
exports.sales = async (req, res) => {
  const days = Math.min(Number(req.query.days || 7), 90);
  if (!Number.isInteger(days) || days < 1) throw httpError(400, 'days 必须为正整数');
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
  const projection = await projectTrades('sale', start, end);
  const byDay = {};
  const documentsByDay = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(start); day.setDate(day.getDate() + i);
    const key = localDayKey(day);
    byDay[key] = { date: key, sales: 0, orders: 0 };
    documentsByDay[key] = new Set();
  }
  for (const row of projection.rows) {
    const key = localDayKey(row.occurredAt);
    if (!byDay[key]) continue;
    byDay[key].sales += row.netAmount;
    if (row.kind === 'sale') documentsByDay[key].add(row.documentId);
  }
  return ok(res, Object.values(byDay).map(day => ({ ...day, sales: money(day.sales), orders: documentsByDay[day.date].size })));
};
