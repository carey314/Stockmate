const prisma = require('../config/prisma');
const { money } = require('../utils/biz');
const { allocateCents, cents, qty3 } = require('../utils/trade');

// 原始应收不可从已被退货/作废改写的 actualAmount 反推。
const originalAmount = doc => money(doc.originalAmount ?? Math.max(0,
  (doc.items?.length ? doc.items.reduce((sum, item) => sum + item.subtotal, 0) : doc.totalAmount) - doc.discountAmount));

// 新单读事件；旧单只补没有初始事件的成交，不能把已有退货事件的旧单漏掉。
// 历史退货没有逐行时间/成本记录时不伪造事件，用 historyIncomplete 明示。
async function projectTrades(documentType, start, end) {
  const dateRange = { gte: start, lte: end };
  const model = documentType === 'sale' ? prisma.order : prisma.purchaseOrder;
  const [events, documents] = await Promise.all([
    prisma.tradeEvent.findMany({ where: { documentType, occurredAt: dateRange } }),
    model.findMany({ where: { status: { in: ['completed', 'cancelled'] }, createdAt: dateRange }, include: { items: { orderBy: { id: 'asc' } } } }),
  ]);
  const initial = documents.length ? await prisma.tradeEvent.findMany({
    where: { documentType, kind: documentType, documentId: { in: documents.map(d => d.id) } }, select: { documentId: true },
  }) : [];
  const recorded = new Set(initial.map(e => e.documentId));
  const legacyIds = documentType === 'sale' ? documents.filter(d => !recorded.has(d.id)
    && d.items.some(i => i.costAmountCents == null)).map(d => d.id) : [];
  const recipeRecords = legacyIds.length ? await prisma.inventoryRecord.findMany({
    where: { relatedOrderId: { in: legacyIds }, type: 'outbound', reason: { startsWith: '配方扣料' } },
    select: { relatedOrderId: true },
  }) : [];
  // 旧配方单的 costSnapshot 错取成品价；旧流水只有单据ID，无法准确归属明细。
  // 整单的旧单位成本快照均不可作为原料成本，已明确锁定的成本总分仍可使用。
  const legacyRecipeDocs = new Set(recipeRecords.map(r => r.relatedOrderId));
  let historyIncomplete = false;
  const rows = [...events];
  for (const doc of documents) {
    if (recorded.has(doc.id)) continue;
    if (doc.status === 'cancelled' || doc.items.some(i => i.returnedQty > 0)) historyIncomplete = true;
    if (legacyRecipeDocs.has(doc.id)) historyIncomplete = true;
    const allocation = allocateCents(cents(originalAmount(doc)), doc.items.map(i => cents(i.subtotal)));
    doc.items.forEach((item, index) => rows.push({
      documentType, documentId: doc.id, itemId: item.id, kind: documentType, occurredAt: doc.createdAt,
      productId: item.productId, skuId: item.skuId, productName: item.productName, specText: item.specText,
      partnerId: documentType === 'sale' ? doc.customerId : doc.supplierId, operatorId: doc.operatorId,
      quantity: item.quantity, netAmount: (item.netAmountCents ?? allocation[index]) / 100,
      costAmount: documentType === 'sale' ? (item.costAmountCents != null ? item.costAmountCents / 100
        : legacyRecipeDocs.has(doc.id) || item.costSnapshot == null ? null : money(item.quantity * item.costSnapshot)) : null,
    }));
  }
  return { rows, historyIncomplete };
}

function costSummary(rows) {
  const unknown = new Map();
  let cogs = 0;
  for (const row of rows) {
    if (row.costAmount != null) { cogs += row.costAmount; continue; }
    const key = `${row.documentId}|${row.itemId}`;
    const entry = unknown.get(key) ?? { quantity: 0, sales: 0, name: row.productName };
    entry.quantity = qty3(entry.quantity + row.quantity);
    entry.sales += row.netAmount;
    unknown.set(key, entry);
  }
  const unresolved = [...unknown.values()].filter(x => x.quantity !== 0 || money(x.sales) !== 0);
  return { cogs: money(cogs), profitUnreliable: unresolved.length > 0,
    noCostSales: money(unresolved.reduce((sum, x) => sum + x.sales, 0)),
    noCostProductNames: [...new Set(unresolved.map(x => x.name))].slice(0, 3) };
}
const orderCount = (rows, kind) => new Set(rows.filter(r => r.kind === kind).map(r => r.documentId)).size;
module.exports = { projectTrades, originalAmount, costSummary, orderCount };
