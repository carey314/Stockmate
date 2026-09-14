const { httpError, money } = require('./biz');
const cents = n => Math.round(n * 100);
const qty3 = n => Math.round(n * 1000) / 1000;
// 最大余数分摊：每行整数分之和严格等于单据净额。
function allocateCents(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map(w => total * w / sum);
  const out = raw.map(Math.floor);
  const order = raw.map((n, i) => ({ i, remainder: n - out[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let left = total - out.reduce((a, b) => a + b, 0), i = 0; i < left; i++) out[order[i].i]++;
  return out;
}
const cumulativePart = (total, before, after, quantity) => Math.round(total * after / quantity) - Math.round(total * before / quantity);

async function stockPlan(tx, sku, quantity) {
  const recipe = await tx.recipe.findMany({ where: { ownerSkuId: sku.id } });
  const targets = recipe.length ? await Promise.all(recipe.map(async r => ({ sku: await tx.sku.findUnique({ where: { id: r.componentSkuId }, include: { product: true } }), quantity: qty3(r.qty * quantity) }))) : [{ sku, quantity: qty3(quantity) }];
  if (targets.some(t => !t.sku || t.sku.status !== 1 || t.sku.product.isDeleted)) throw httpError(400, '配方原料不可用，请核对后重试');
  const snapshot = targets.map(t => ({ skuId: t.sku.id, productId: t.sku.productId, name: t.sku.product.name, quantity: t.quantity, cost: t.sku.costPrice ?? t.sku.product.costPrice ?? null }));
  const costAmountCents = snapshot.some(s => s.cost == null) ? null : cents(snapshot.reduce((n, s) => n + s.quantity * s.cost, 0));
  return { snapshot, costAmountCents, costSnapshot: costAmountCents == null ? null : costAmountCents / 100 / quantity, recipe: recipe.length > 0 };
}

async function moveStock(tx, targets, sign, { operatorId, orderId, purchaseOrderId, reason, allowNegative = true }) {
  const negatives = [];
  for (const t of targets) {
    if (!t.quantity) continue;
    let inv = await tx.inventory.findUnique({ where: { skuId: t.skuId } });
    if (!inv) inv = await tx.inventory.create({ data: { skuId: t.skuId, productId: t.productId } });
    const after = qty3(inv.quantity + sign * t.quantity);
    if (after < 0) {
      if (!allowNegative) throw httpError(400, `「${t.name ?? ''}」库存不足：仅剩 ${inv.quantity}`);
      negatives.push(`${t.name ?? ''} → ${after}`);
    }
    await tx.inventory.update({ where: { id: inv.id }, data: { quantity: after } });
    await tx.inventoryRecord.create({ data: { skuId: t.skuId, productId: t.productId, type: sign > 0 ? 'inbound' : 'outbound', quantity: t.quantity, beforeQuantity: inv.quantity, afterQuantity: after, reason, relatedOrderId: orderId ?? null, relatedPurchaseOrderId: purchaseOrderId ?? null, operatorId } });
  }
  return negatives;
}

async function postTrade(tx, documentType, doc, item, { kind = documentType, quantity = item.quantity, netAmount = item.netAmountCents / 100, costAmount = item.costAmountCents == null ? null : item.costAmountCents / 100, actorId = doc.operatorId, occurredAt = doc.createdAt } = {}) {
  return tx.tradeEvent.create({ data: { documentType, documentId: doc.id, itemId: item.id, kind, quantity, netAmount: money(netAmount), costAmount: costAmount == null ? null : money(costAmount), occurredAt, productId: item.productId ?? (await tx.sku.findUnique({ where: { id: item.skuId } })).productId, skuId: item.skuId, productName: item.productName, specText: item.specText, partnerId: documentType === 'sale' ? doc.customerId : doc.supplierId, operatorId: doc.operatorId, actorId } });
}

function settlement(data, actual, { purchase = false, named = true } = {}) {
  if (data.settlementAccount === '冲账') throw httpError(400, '冲账是系统专用标记，请选择真实结算账户');
  const credit = data.settlementAccount === '挂账';
  const paid = money(data.paidAmount ?? (credit ? 0 : actual));
  if (credit && paid > 0) throw httpError(400, '挂账不能同时记录已付款，请选择真实付款账户');
  if (purchase && paid > actual) throw httpError(400, '付款超出应付金额');
  if (!named && paid < actual) throw httpError(400, purchase ? '采购挂账请先选择供应商' : `散客订单需当场结清（应收 ¥${actual}，实收 ¥${paid}）。要赊账请先选择客户`);
  return paid;
}
module.exports = { cents, qty3, allocateCents, cumulativePart, stockPlan, moveStock, postTrade, settlement };
