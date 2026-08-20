// 收益日历：按天看钱的进出。
//
// 口径 = **现金口径**（真金白银的进出），数据源只有三张表：
//   PaymentRecord（开单收款/收欠款/进货付款/退款……，排除 account='冲账' 的记账行）
//   Income（收摊总账/日结快录这类直接收入）
//   Expense（摊位费/水电/人工等开销）
// 不混入"销售额/毛利"这种权责口径——日历上老板想知道的是"今天进了多少钱、出了多少钱"，
// 毛利在报表中心有专门的地方。两种口径混在一格里，数字对不上就说不清了。
const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok } = require('../utils/response');
const { httpError, money, localDayKey } = require('../utils/biz');

// note 前缀 → 事件类型（与 orders.js / purchaseOrders.js 里的流水文案一一对应，改文案要同步这里）
const kindOf = (p) => {
  const n = p.note ?? '';
  if (n.startsWith('开单收款')) return 'sale';
  if (n.startsWith('收欠款')) return 'receive';
  if (n.startsWith('进货付款') || n.startsWith('付欠款')) return 'purchase';
  if (n.startsWith('销售退货退款') || n.startsWith('取消订单退款')) return 'refundOut';
  if (n.startsWith('进货退货退回款') || n.startsWith('取消进货单退款收回')) return 'refundIn';
  return p.direction === 'in' ? 'otherIn' : 'otherOut';
};

// PaymentRecord 查询条件：排除冲账，但必须显式放行 account=NULL
// （SQL 三值逻辑：NOT(account='冲账') 会连带排除 NULL 行——2026-08-08 的 Bug4，别再犯）
const realMoney = { OR: [{ account: null }, { NOT: { account: '冲账' } }] };

const rangeTotals = async (start, end) => {
  const [pays, incomes, expenses] = await Promise.all([
    prisma.paymentRecord.findMany({ where: { paidAt: { gte: start, lte: end }, ...realMoney }, select: { direction: true, amount: true } }),
    prisma.income.findMany({ where: { incomeDate: { gte: start, lte: end } }, select: { amount: true } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } }, select: { amount: true } }),
  ]);
  let income = 0;
  let expense = 0;
  for (const p of pays) (p.direction === 'in' ? (income += p.amount) : (expense += p.amount));
  for (const i of incomes) income += i.amount;
  for (const e of expenses) expense += e.amount;
  return { income: money(income), expense: money(expense), net: money(income - expense) };
};

// GET /calendar/month?month=YYYY-MM —— 月历格子：每天的收/支/净
exports.month = async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, '格式应为 YYYY-MM') }).parse(req.query);
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59, 999); // 当月最后一天（TZ 已钉 Asia/Shanghai）

  const [pays, incomes, expenses] = await Promise.all([
    prisma.paymentRecord.findMany({ where: { paidAt: { gte: start, lte: end }, ...realMoney }, select: { direction: true, amount: true, paidAt: true } }),
    prisma.income.findMany({ where: { incomeDate: { gte: start, lte: end } }, select: { amount: true, incomeDate: true } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } }, select: { amount: true, expenseDate: true } }),
  ]);

  const days = {};
  const bump = (d, field, v) => {
    const k = localDayKey(d);
    days[k] ??= { income: 0, expense: 0 };
    days[k][field] += v;
  };
  for (const p of pays) bump(p.paidAt, p.direction === 'in' ? 'income' : 'expense', p.amount);
  for (const i of incomes) bump(i.incomeDate, 'income', i.amount);
  for (const e of expenses) bump(e.expenseDate, 'expense', e.amount);
  for (const k of Object.keys(days)) {
    days[k].income = money(days[k].income);
    days[k].expense = money(days[k].expense);
    days[k].net = money(days[k].income - days[k].expense);
  }
  return ok(res, { month, days });
};

// GET /calendar/day?date=YYYY-MM-DD —— 选中某天：当日/当月/当年三级汇总 + 逐笔事件（todolist 视图的数据）
exports.day = async (req, res) => {
  const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '格式应为 YYYY-MM-DD') }).parse(req.query);
  const [y, m, d] = date.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(dayStart.getTime())) throw httpError(400, '日期无效');

  const [dayT, monthT, yearT, pays, incomes, expenses] = await Promise.all([
    rangeTotals(dayStart, dayEnd),
    rangeTotals(new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59, 999)),
    rangeTotals(new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59, 999)),
    prisma.paymentRecord.findMany({ where: { paidAt: { gte: dayStart, lte: dayEnd }, ...realMoney }, orderBy: { paidAt: 'asc' } }),
    prisma.income.findMany({ where: { incomeDate: { gte: dayStart, lte: dayEnd } }, orderBy: { incomeDate: 'asc' } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: dayStart, lte: dayEnd } }, orderBy: { expenseDate: 'asc' } }),
  ]);

  const events = [
    ...pays.map((p) => ({
      at: p.paidAt,
      kind: kindOf(p),
      direction: p.direction,
      amount: money(p.amount),
      title: p.note ?? (p.direction === 'in' ? '收款' : '付款'),
      account: p.account,
      orderId: p.orderId,
      purchaseOrderId: p.purchaseOrderId,
    })),
    ...incomes.map((i) => ({
      at: i.incomeDate,
      kind: 'dailyIncome',
      direction: 'in',
      amount: money(i.amount),
      title: i.source + (i.note ? `（${i.note}）` : ''),
    })),
    ...expenses.map((e) => ({
      at: e.expenseDate,
      kind: 'expense',
      direction: 'out',
      amount: money(e.amount),
      title: e.category + (e.note ? `（${e.note}）` : ''),
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at)); // 从早到晚，像日程表

  return ok(res, { date, day: dayT, month: monthT, year: yearT, events });
};

// GET /calendar/week?start=YYYY-MM-DD —— 周视图：从 start 起 7 天，每天的净额 + 逐笔事件
// （参考 Todoist 周历：事件小卡直接铺在每天的列里，打开就能看，不用逐日点）
exports.week = async (req, res) => {
  const { start } = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '格式应为 YYYY-MM-DD') }).parse(req.query);
  const [y, m, d] = start.split('-').map(Number);
  const from = new Date(y, m - 1, d);
  if (Number.isNaN(from.getTime())) throw httpError(400, '日期无效');
  const to = new Date(y, m - 1, d + 6, 23, 59, 59, 999);

  const [pays, incomes, expenses] = await Promise.all([
    prisma.paymentRecord.findMany({ where: { paidAt: { gte: from, lte: to }, ...realMoney }, orderBy: { paidAt: 'asc' } }),
    prisma.income.findMany({ where: { incomeDate: { gte: from, lte: to } }, orderBy: { incomeDate: 'asc' } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: from, lte: to } }, orderBy: { expenseDate: 'asc' } }),
  ]);

  const days = {};
  const dayOf = (dt) => {
    const k = localDayKey(dt);
    days[k] ??= { income: 0, expense: 0, events: [] };
    return days[k];
  };
  for (const p of pays) {
    const slot = dayOf(p.paidAt);
    slot[p.direction === 'in' ? 'income' : 'expense'] += p.amount;
    slot.events.push({
      at: p.paidAt, kind: kindOf(p), direction: p.direction, amount: money(p.amount),
      title: p.note ?? (p.direction === 'in' ? '收款' : '付款'), account: p.account,
      orderId: p.orderId, purchaseOrderId: p.purchaseOrderId,
    });
  }
  for (const i of incomes) {
    const slot = dayOf(i.incomeDate);
    slot.income += i.amount;
    slot.events.push({ at: i.incomeDate, kind: 'dailyIncome', direction: 'in', amount: money(i.amount), title: i.source + (i.note ? `（${i.note}）` : '') });
  }
  for (const e of expenses) {
    const slot = dayOf(e.expenseDate);
    slot.expense += e.amount;
    slot.events.push({ at: e.expenseDate, kind: 'expense', direction: 'out', amount: money(e.amount), title: e.category + (e.note ? `（${e.note}）` : '') });
  }
  for (const k of Object.keys(days)) {
    days[k].income = money(days[k].income);
    days[k].expense = money(days[k].expense);
    days[k].net = money(days[k].income - days[k].expense);
    days[k].events.sort((a, b) => new Date(a.at) - new Date(b.at));
    // 周看板一列只铺得下 8 张卡。生意好的店一天几百笔，7 天全量传就是几百 KB 的浪费——
    // 这里只带前 8 笔 + 总笔数（算折叠"+n"用），逐笔明细走 /calendar/day
    days[k].count = days[k].events.length;
    days[k].events = days[k].events.slice(0, 8);
  }
  return ok(res, { start, days });
};

