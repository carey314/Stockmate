const { z } = require('zod');
const { httpError, money } = require('../utils/biz');
const { cents, qty3, allocateCents, cumulativePart, moveStock, postTrade } = require('../utils/trade');
const returnSchema = z.object({ items: z.array(z.object({ itemId: z.number().int(), quantity: z.number().finite().positive().refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7, '数量最多三位小数') })).min(1), account: z.string().nullish() });
const realAccount = account => {
  if (account === '冲账' || account === '挂账') throw httpError(400, '收付款请选择真实账户');
  return account ?? null;
};
async function settlePayment(tx, type, id, input, operatorId) {
  const { amount: raw, settlementAccount } = z.object({ amount: z.number().positive(), settlementAccount: z.string().nullish() }).parse(input);
  const amount = money(raw);
  if (amount <= 0) throw httpError(400, '收付款至少0.01元');
  const sale = type === 'sale', model = sale ? tx.order : tx.purchaseOrder;
  const doc = await model.findUnique({ where: { id } });
  if (!doc) throw httpError(404, '单据不存在');
  if (doc.status !== 'completed') throw httpError(400, '作废单不能收付款');
  if (cents(amount) > cents(doc.actualAmount - doc.paidAmount)) throw httpError(400, '收付款超出欠款');
  const account = realAccount(settlementAccount ?? (doc.settlementAccount === '挂账' ? null : doc.settlementAccount));
  const updated = await model.update({ where: { id }, data: { paidAmount: money(doc.paidAmount + amount), settlementAccount: account } });
  await tx.paymentRecord.create({ data: { direction: sale ? 'in' : 'out', amount, account, [sale ? 'orderId' : 'purchaseOrderId']: id, [sale ? 'customerId' : 'supplierId']: doc[sale ? 'customerId' : 'supplierId'], note: `${sale ? '收欠款' : '付欠款'} ${doc.orderNo}`, operatorId } });
  return { ...updated, unpaidAmount: money(updated.actualAmount - updated.paidAmount) };
}
async function reverseTrade(tx, type, id, input, actorId, cancel = false) {
  const sale = type === 'sale', model = sale ? tx.order : tx.purchaseOrder, itemModel = sale ? tx.orderItem : tx.purchaseOrderItem;
  const parsed = cancel ? { account: input.account } : returnSchema.parse(input);
  if (parsed.account != null) realAccount(parsed.account);
  const doc = await model.findUnique({ where: { id }, include: { items: true } });
  if (!doc) throw httpError(404, '单据不存在');
  if (doc.status !== 'completed') throw httpError(400, '只有已完成单据可以退货或取消');
  const requested = cancel ? doc.items.filter(i => i.quantity > i.returnedQty).map(i => ({ itemId: i.id, quantity: qty3(i.quantity - i.returnedQty) })) : parsed.items;
  if (new Set(requested.map(i => i.itemId)).size !== requested.length) throw httpError(400, '退货明细重复，请合并数量');
  const original = doc.originalAmount ?? money(Math.max(0, doc.totalAmount - doc.discountAmount));
  const allocation = allocateCents(cents(original), doc.items.map(i => cents(i.subtotal)));
  const occurredAt = new Date(), details = [];
  let refundCents = 0;
  for (const r of requested) {
    const index = doc.items.findIndex(i => i.id === r.itemId), item = doc.items[index];
    if (!item) throw httpError(404, '明细不属于该单据');
    const before = item.returnedQty, after = qty3(before + r.quantity);
    if (after > item.quantity || qty3(r.quantity) <= 0) throw httpError(400, `「${item.productName}」退货数量超出可退数量`);
    // 旧单已部分退货的折扣/扣料无法可靠复原，保留原账，交人工核对。
    if (item.netAmountCents == null && before > 0) throw httpError(409, '旧单已有退货但缺少成交分摊快照，请先核对原始单据');
    const netCents = item.netAmountCents ?? allocation[index];
    const amount = cumulativePart(netCents, before, after, item.quantity);
    let targets;
    if (sale && item.stockSnapshot) {
      targets = JSON.parse(item.stockSnapshot).map(t => ({ ...t, quantity: cumulativePart(Math.round(t.quantity * 1000), before, after, item.quantity) / 1000 }));
    } else {
      const recipeRecords = sale ? await tx.inventoryRecord.count({ where: { relatedOrderId: id, reason: { startsWith: '配方扣料' } } }) : 0;
      if (recipeRecords || !item.skuId) throw httpError(409, '旧单缺少原始扣料快照，请先核对原料后处理');
      const sku = await tx.sku.findUnique({ where: { id: item.skuId } });
      if (!sku) throw httpError(409, '原规格已不存在，请核对库存');
      targets = [{ skuId: item.skuId, productId: sku.productId, name: item.productName, quantity: qty3(r.quantity) }];
    }
    await moveStock(tx, targets, sale ? 1 : -1, { operatorId: actorId, [sale ? 'orderId' : 'purchaseOrderId']: id, reason: `${cancel ? '取消' : '退货'} ${doc.orderNo}`, allowNegative: sale });
    const costTotal = item.costAmountCents ?? (item.costSnapshot == null ? null : cents(item.costSnapshot * item.quantity));
    await postTrade(tx, type, doc, item, { kind: cancel ? 'cancel' : 'return', quantity: -qty3(r.quantity), netAmount: -amount / 100, costAmount: costTotal == null ? null : -cumulativePart(costTotal, before, after, item.quantity) / 100, actorId, occurredAt });
    await itemModel.update({ where: { id: item.id }, data: { returnedQty: after, netAmountCents: netCents } });
    refundCents += amount;
    details.push({ productName: item.productName, quantity: r.quantity, amount: amount / 100 });
  }
  const returnValue = refundCents / 100;
  const newActual = cancel ? 0 : money(doc.actualAmount - returnValue);
  if (newActual < 0) throw httpError(409, '历史单据金额与退货快照不一致，请先核对');
  const refund = money(Math.max(0, doc.paidAmount - newActual)), newPaid = money(doc.paidAmount - refund);
  const links = { [sale ? 'orderId' : 'purchaseOrderId']: id, [sale ? 'customerId' : 'supplierId']: doc[sale ? 'customerId' : 'supplierId'], operatorId: actorId, paidAt: occurredAt };
  if (returnValue > 0) await tx.paymentRecord.create({ data: { ...links, direction: sale ? 'in' : 'out', amount: returnValue, account: '冲账', note: `${cancel ? '取消' : '退货'}冲减 ${doc.orderNo}` } });
  if (refund > 0) await tx.paymentRecord.create({ data: { ...links, direction: sale ? 'out' : 'in', amount: refund, account: realAccount(parsed.account ?? (doc.settlementAccount === '挂账' ? null : doc.settlementAccount)), note: `${sale ? (cancel ? '取消订单退款' : '销售退货退款') : (cancel ? '取消进货单退款收回' : '进货退货退回款')} ${doc.orderNo}` } });
  const updated = await model.update({ where: { id }, data: { actualAmount: newActual, paidAmount: newPaid, ...(cancel ? { status: 'cancelled' } : {}) } });
  return cancel ? updated : { returnValue, [sale ? 'refundCash' : 'refundIn']: refund, newActual, newPaid, details };
}
module.exports = { settlePayment, reverseTrade };
