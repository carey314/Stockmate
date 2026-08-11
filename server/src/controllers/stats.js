const prisma = require('../config/prisma');
const { localDayKey } = require('../utils/biz');
const { ok } = require('../utils/response');

const r2 = (n) => Math.round(n * 100) / 100;

// 首页看板：今日销售/成本/毛利/订单数/库存预警数/商品总数
// 毛利口径（小摊场景）：今日销售 - 今日销货成本(卖出数量×商品成本价) - 今日经营支出
exports.overview = async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayOrders, productCount, inventories, todayExpenses, todaySoldItems, todayIncomes] = await Promise.all([
    prisma.order.findMany({
      where: { status: 'completed', createdAt: { gte: todayStart } },
      select: { actualAmount: true },
    }),
    prisma.product.count({ where: { isDeleted: 0 } }),
    prisma.inventory.findMany({
      where: { minQuantity: { gt: 0 }, sku: { status: 1, product: { isDeleted: 0 } } },
      select: { quantity: true, minQuantity: true },
    }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: todayStart } },
      select: { amount: true },
    }),
    prisma.orderItem.findMany({
      where: { order: { status: 'completed', createdAt: { gte: todayStart } } },
      select: {
        quantity: true,
        subtotal: true,
        costSnapshot: true,
        productName: true,
        sku: { select: { costPrice: true } },
        product: { select: { costPrice: true } },
      },
    }),
    prisma.income.findMany({
      where: { incomeDate: { gte: todayStart } },
      select: { amount: true },
    }),
  ]);

  // 今日销售 = 订单实收 + 无库存关联的收入流水（口述卖出未建档商品）
  const todaySales =
    todayOrders.reduce((s, o) => s + o.actualAmount, 0) + todayIncomes.reduce((s, i) => s + i.amount, 0);
  const todayExpenseTotal = todayExpenses.reduce((s, e) => s + e.amount, 0);
  // 销货成本：卖出时的成本快照优先，回退当前档案价
  const costOf = (i) => i.costSnapshot ?? i.sku?.costPrice ?? i.product.costPrice ?? null;
  const todayCogs = todaySoldItems.reduce((s, i) => s + i.quantity * (costOf(i) ?? 0), 0);

  // 没有成本数据的部分要如实报出来，否则毛利看着精确其实虚高。
  // 「今天赚了 500」和「今天赚了 500，但其中 300 的货没填进价」是两回事。
  const noCostItems = todaySoldItems.filter((i) => costOf(i) == null);
  const noCostSales = r2(noCostItems.reduce((s, i) => s + i.subtotal, 0));
  const noCostNames = [...new Set(noCostItems.map((i) => i.productName))].slice(0, 3);

  return ok(res, {
    todaySales,
    todayOrderCount: todayOrders.length,
    todayExpenses: todayExpenseTotal,
    todayCogs, // 销货成本
    todayProfit: todaySales - todayCogs - todayExpenseTotal, // 今天到底赚没赚
    // 毛利可信度：这部分销售额没有成本数据，算出来的毛利偏高
    profitUnreliable: noCostItems.length > 0,
    noCostSales,
    noCostProductNames: noCostNames,
    lowStockCount: inventories.filter((i) => i.quantity <= i.minQuantity).length,
    productCount,
  });
};

// 销售统计：按日汇总（近 N 天）
exports.sales = async (req, res) => {
  const days = Math.min(Number(req.query.days || 7), 90);
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: { status: 'completed', createdAt: { gte: start } },
    select: { actualAmount: true, createdAt: true },
  });

  const byDay = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const k = localDayKey(d);
    byDay[k] = { date: k, sales: 0, orders: 0 };
  }
  for (const o of orders) {
    const key = localDayKey(o.createdAt);
    if (byDay[key]) {
      byDay[key].sales += o.actualAmount;
      byDay[key].orders += 1;
    }
  }
  return ok(res, Object.values(byDay));
};
