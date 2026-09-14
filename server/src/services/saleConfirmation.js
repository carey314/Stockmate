const crypto = require('node:crypto');
const { z } = require('zod');
const { transaction } = require('../utils/transaction');
const { getTenantId } = require('../config/prisma');
const { createSale } = require('./sales');
const { httpError } = require('../utils/biz');

// Only the fields understood by createSale participate; object key order and
// omitted nullable display fields cannot change a retry's identity.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const payloadOf = input => ({
  customerId: input.customerId ?? null,
  notes: input.notes ?? null,
  discountRate: input.discountRate ?? null,
  discountAmount: input.discountAmount,
  paidAmount: input.paidAmount,
  settlementAccount: input.settlementAccount ?? null,
  items: Array.isArray(input.items) ? input.items.map(item => item && typeof item === 'object' ? { skuId: item.skuId, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice } : item) : input.items,
});

async function confirmSale(input, actorId) {
  // Preserve the existing App/client behavior when no request ID is supplied.
  if (input.requestId === undefined) return transaction(tx => createSale(tx, input, actorId));
  const requestId = z.string().trim().min(8).max(128).parse(input.requestId);
  const storeId = getTenantId();
  if (!storeId || !Number.isInteger(actorId)) throw httpError(401, '缺少有效店铺身份');
  const content = payloadOf(input);
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
  const requestKey = `manual-sale:${actorId}:${requestId}`;
  return transaction(async tx => {
    // The first statement is a write: SQLite serializes processes before any
    // reads or accounting work. The unique key and result commit together.
    // Explicit storeId is required because raw SQL has no tenant extension.
    await tx.$executeRaw`INSERT INTO "EntryConfirmation" ("storeId", "requestKey", "actorId", "contentHash", "response", "createdAt") VALUES (${storeId}, ${requestKey}, ${actorId}, ${contentHash}, '', ${new Date()}) ON CONFLICT ("storeId", "requestKey") DO NOTHING`;
    const row = await tx.entryConfirmation.findFirst({ where: { storeId, requestKey, actorId } });
    if (!row || row.contentHash !== contentHash) throw httpError(409, '确认编号已用于另一份销售草稿，请重试原请求');
    if (row.response) return { ...JSON.parse(row.response), replayed: true };
    const result = { ...await createSale(tx, content, actorId), requestId, replayed: false };
    await tx.entryConfirmation.updateMany({ where: { id: row.id, storeId, actorId, contentHash }, data: { response: JSON.stringify(result) } });
    return result;
  });
}
module.exports = { confirmSale };
