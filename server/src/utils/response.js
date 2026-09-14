// 员工仍可操作采购进价；经营推导值和销售成本快照仅老板可见。
const protectedFields = new Set(['costSnapshot', 'costAmountCents', 'stockSnapshot', 'costAmount', 'profit', 'cogs', 'todayCogs', 'todayProfit', 'profitUnreliable', 'noCostCount', 'noCostAmount', 'noCostItems', 'totalValue']);
const staffView = (value, inventory = false) => {
  if (Array.isArray(value)) return value.map(v => staffView(v, inventory));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !protectedFields.has(k) && !k.startsWith('noCost') && !(inventory && k === 'value')).map(([k,v]) => [k, staffView(v, inventory)]));
};
const visible = (res, data) => res.req?.user?.role === 'staff' ? staffView(data, res.req.path.toLowerCase().replace(/\/+$/, '') === '/reports/inventory') : data;
// 统一响应格式
const ok = (res, data = null, message = 'success') =>
  res.json({ code: 200, message, data: visible(res, data) });

const created = (res, data = null, message = 'created') =>
  res.status(201).json({ code: 201, message, data: visible(res, data) });

const fail = (res, code, message, errors) =>
  res.status(code).json({ code, message, ...(errors ? { errors } : {}) });

// 包装 async 处理器，自动 catch 传给 errorHandler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ok, created, fail, wrap };
