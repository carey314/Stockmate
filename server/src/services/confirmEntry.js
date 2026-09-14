const { z } = require('zod');
const crypto = require('node:crypto');
const { transaction } = require('../utils/transaction');
const { createSale } = require('./sales');
const { createPurchase } = require('./purchases');
const { httpError, money, genProductCode } = require('../utils/biz');
const { resolvePriceForCustomer } = require('../controllers/pricing');
const amount = z.number().finite().nonnegative().nullish();
const id = z.number().int().positive().nullish();
const base = { name: z.string().trim().min(1), quantity: z.number().finite().positive().refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7, '数量最多三位小数'), unit: z.string().default('件'), createProduct: z.boolean().default(false), productTypeId: id };
const schema = z.object({
  requestId: z.string().trim().min(8).max(128).optional(),
  purchases: z.array(z.object({ ...base, skuId: id, productId: id, supplierId: id, expenseOnly: z.boolean().default(false), unitCost: amount, totalCost: amount, paidAmount: amount, settlementAccount: z.string().nullish() })).default([]),
  sales: z.array(z.object({ ...base, skuId: id, customerId: id, paid: z.boolean().nullish(), unitPrice: amount, totalAmount: amount, settlementAccount: z.string().nullish() })).default([]),
  expenses: z.array(z.object({ category: z.string().min(1), amount: z.number().positive(), note: z.string().nullish() })).default([]),
  aggregates: z.array(z.object({ label: z.string().min(1), amount: z.number().positive(), note: z.string().nullish(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() })).default([]),
});
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function priceOf(item, unit, total) {
  const price = item[unit], sum = item[total];
  if (price != null && sum != null && Math.round(price * item.quantity * 100) !== Math.round(sum * 100)) throw httpError(400, `「${item.name}」单价、数量与总额不一致，请重新核对`);
  if (price != null) return price;
  if (sum != null) return sum / item.quantity; // 保留除法精度，单据小计再统一取分
  return null;
}
async function createDraftProduct(tx, item, sale, unitPrice) {
  if (!item.productTypeId) throw httpError(400, `「${item.name}」建档请先选择品类`);
  if (!await tx.productType.findFirst({ where: { id: item.productTypeId, isDeleted: 0 } })) throw httpError(404, '品类不存在');
  const code = await genProductCode(tx);
  const product = await tx.product.create({ data: { code, name: item.name, productTypeId: item.productTypeId, unit: item.unit, defaultPrice: sale ? unitPrice ?? 0 : 0, costPrice: sale ? null : unitPrice, customFields: '{}' } });
  const sku = await tx.sku.create({ data: { productId: product.id, code, isDefault: 1, price: sale ? unitPrice ?? 0 : 0, costPrice: sale ? null : unitPrice } });
  await tx.inventory.create({ data: { productId: product.id, skuId: sku.id, quantity: 0 } });
  return sku;
}
async function saveEntry(tx, data, actorId) {
  const result = { inbounded: [], purchaseOrders: [], orders: [], incomes: [], expenses: [], negativeStock: [] };
  for (const item of data.purchases) {
    const unitCost = priceOf(item, 'unitCost', 'totalCost');
    if (unitCost == null) throw httpError(400, `「${item.name}」缺少真实进价或总花费，请补充后确认`);
    if (item.expenseOnly) {
      if (item.createProduct || item.skuId || item.productId) throw httpError(400, '仅记支出不能同时选择入库商品');
      if (item.settlementAccount === '挂账' || (item.paidAmount != null && money(item.paidAmount) !== money(unitCost * item.quantity))) throw httpError(400, '仅记支出只支持已付款；挂账请匹配或建档并选择供应商');
      const value = money(unitCost * item.quantity);
      if (value <= 0) throw httpError(400, '仅记支出的金额必须大于0');
      result.expenses.push(await tx.expense.create({ data: { category: '进货', amount: value, note: `仅记支出·${item.name} ${item.quantity}${item.unit}`, operatorId: actorId } }));
      continue;
    }
    let skuId = item.skuId;
    if (!skuId && item.productId) {
      const skus = await tx.sku.findMany({ where: { productId: item.productId, status: 1, product: { isDeleted: 0 } } });
      if (!skus.length) throw httpError(404, '商品不存在');
      if (skus.length > 1) throw httpError(400, `「${item.name}」有多个规格，请选择本次进货规格`);
      skuId = skus[0].id;
    }
    if (!skuId && item.createProduct) skuId = (await createDraftProduct(tx, item, false, unitCost)).id;
    if (!skuId) throw httpError(400, `「${item.name}」请匹配商品、新建档案或选择仅记支出`);
    const sku = await tx.sku.findUnique({ where: { id: skuId } });
    if (!sku || (item.productId && item.productId !== sku.productId)) throw httpError(404, '所选规格不属于该商品');
    const po = await createPurchase(tx, { supplierId: item.supplierId, paidAmount: item.paidAmount ?? undefined, settlementAccount: item.settlementAccount ?? '现金', notes: 'AI记账', items: [{ skuId, quantity: item.quantity, unitPrice: unitCost }] }, actorId);
    result.purchaseOrders.push({ ...po, unpaidAmount: money(po.actualAmount - po.paidAmount) });
    result.inbounded.push({ productId: sku.productId, skuId, name: item.name, quantity: item.quantity, purchaseOrderId: po.id });
  }
  const groups = new Map();
  for (const item of data.sales) {
    let unitPrice = priceOf(item, 'unitPrice', 'totalAmount');
    let customer = null;
    if (item.customerId) {
      customer = await tx.customer.findFirst({ where: { id: item.customerId, isDeleted: 0 } });
      if (!customer) throw httpError(404, '客户不存在');
    }
    const named = customer && customer.name !== '散客';
    const paid = item.paid ?? (item.settlementAccount === '挂账' ? false : !named);
    if (paid && item.settlementAccount === '挂账') throw httpError(400, '已收款不能选择挂账账户');
    let skuId = item.skuId;
    if (!skuId && item.createProduct) {
      if (unitPrice == null) throw httpError(400, `「${item.name}」新建销售档案请补充真实卖价`);
      skuId = (await createDraftProduct(tx, item, true, unitPrice)).id;
    }
    if (!skuId) {
      if (!paid) throw httpError(400, `「${item.name}」未建档不能赊销，请匹配或建档以保留客户欠款`);
      if (unitPrice == null) throw httpError(400, `「${item.name}」缺少卖价`);
      result.incomes.push(await tx.income.create({ data: { source: `口述卖出·${item.name}`, amount: money(unitPrice * item.quantity), note: `${item.quantity}${item.unit}`, operatorId: actorId } }));
      continue;
    }
    const sku = await tx.sku.findUnique({ where: { id: skuId }, include: { product: true } });
    if (!sku || sku.status !== 1 || sku.product.isDeleted) throw httpError(404, '规格不存在');
    if (unitPrice == null) unitPrice = customer ? (await resolvePriceForCustomer(skuId, customer.id)).price : sku.price;
    const account = paid ? item.settlementAccount ?? '现金' : '挂账';
    const key = `${customer?.id ?? 0}|${paid}|${account}`;
    if (!groups.has(key)) groups.set(key, { customerId: customer?.id, paid, account, items: [] });
    groups.get(key).items.push({ skuId, quantity: item.quantity, unitPrice });
  }
  for (const group of groups.values()) {
    const { order, negatives } = await createSale(tx, { customerId: group.customerId, paidAmount: group.paid ? undefined : 0, settlementAccount: group.account, notes: 'AI记账', items: group.items }, actorId);
    result.orders.push({ id: order.id, orderNo: order.orderNo, customerId: order.customerId, actualAmount: order.actualAmount, paidAmount: order.paidAmount, unpaidAmount: money(order.actualAmount - order.paidAmount) });
    result.negativeStock.push(...negatives);
  }
  for (const e of data.expenses) result.expenses.push(await tx.expense.create({ data: { ...e, operatorId: actorId } }));
  for (const a of data.aggregates) result.incomes.push(await tx.income.create({ data: { source: a.label, amount: a.amount, note: a.note ?? null, ...(a.date ? { incomeDate: new Date(`${a.date}T12:00:00`) } : {}), operatorId: actorId } }));
  return result;
}
async function confirmEntry(input, actorId) {
  const data = schema.parse(input);
  if (!data.purchases.length && !data.sales.length && !data.expenses.length && !data.aggregates.length) throw httpError(400, '没有可确认的记录');
  const { requestId, ...content } = data;
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
  const requestKey = requestId ? `id:${requestId}` : `legacy:${actorId}:${hash}`;
  return transaction(async tx => {
    const previous = await tx.entryConfirmation.findFirst({ where: { requestKey } });
    const active = previous && (requestId || Date.now() - previous.createdAt.getTime() < 10 * 60 * 1000);
    if (active) {
      if (previous.actorId !== actorId || previous.contentHash !== hash) throw httpError(409, '确认编号已用于另一份草案，请核对后重新确认');
      return { ...JSON.parse(previous.response), replayed: true };
    }
    // 先取得数据库写锁/唯一键，再做任何账务写入；同一事务提交最终响应。
    const row = previous
      ? await tx.entryConfirmation.update({ where: { id: previous.id }, data: { createdAt: new Date(), response: '', contentHash: hash } })
      : await tx.entryConfirmation.create({ data: { requestKey, actorId, contentHash: hash, response: '' } });
    const result = { ...await saveEntry(tx, data, actorId), requestId: requestId ?? requestKey, replayed: false };
    await tx.entryConfirmation.update({ where: { id: row.id }, data: { response: JSON.stringify(result) } });
    return result;
  });
}
module.exports = { confirmEntry };
