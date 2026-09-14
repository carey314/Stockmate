const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID, createHash } = require('node:crypto');
const { basePrisma } = require('../config/prisma');
const context = new AsyncLocalStorage();
const health = { startedAt: new Date().toISOString(), writeFailures: 0, missingContext: 0, lastFailureAt: null };
let lastLog = 0;
function reportFailure(kind, code) {
  health[kind]++; health.lastFailureAt = new Date().toISOString();
  if (Date.now() - lastLog >= 60000) {
    lastLog = Date.now();
    // Do not log exception messages: provider/parser errors can include prompt or response fragments.
    console.warn(`[platform-metrics] ${kind}; count=${health[kind]}; code=${/^P\d{4}$/.test(code || '') ? code : 'UNAVAILABLE'}`);
  }
}
const telemetryHealth = () => ({ ...health });
const runAiContext = (actor, work) => context.run({ requestId: randomUUID(), userId: actor.userId, storeId: actor.storeId, endpoint: actor.endpoint, attempt: 0 }, work);
function nextAttempt() {
  const current = context.getStore();
  if (!current || !Number.isInteger(current.userId) || !Number.isInteger(current.storeId)) { reportFailure('missingContext'); return null; }
  return { requestId: current.requestId, userId: current.userId, storeId: current.storeId, endpoint: current.endpoint, attempt: ++current.attempt };
}
const token = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647 ? value : null;
function usageFields(usage) {
  return {
    promptTokens: token(usage?.prompt_tokens), completionTokens: token(usage?.completion_tokens),
    cacheHitTokens: token(usage?.prompt_cache_hit_tokens), cacheMissTokens: token(usage?.prompt_cache_miss_tokens), totalTokens: token(usage?.total_tokens),
  };
}
function estimate(model, usage) {
  const unknown = { estimatedCost: null, currency: null, pricingSnapshot: null };
  let price;
  try { price = JSON.parse(process.env.AI_MODEL_PRICING || '{}')[model]; } catch { return unknown; }
  const rate = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!price || price.unit !== 'per_million_tokens' || !/^[A-Z]{3}$/.test(price.currency || '') || !rate(price.input) || !rate(price.output) || (price.cacheHit != null && !rate(price.cacheHit))) return unknown;
  const snapshot = { model, unit: price.unit, currency: price.currency, input: price.input, output: price.output, cacheHit: price.cacheHit ?? null };
  const result = { ...unknown, currency: price.currency, pricingSnapshot: JSON.stringify(snapshot) };
  if (usage.promptTokens == null || usage.completionTokens == null) return result;
  const hit = usage.cacheHitTokens ?? (usage.cacheMissTokens == null ? null : usage.promptTokens - usage.cacheMissTokens);
  const miss = usage.cacheMissTokens ?? (hit == null ? null : usage.promptTokens - hit);
  if (hit == null || miss == null || hit < 0 || miss < 0 || hit + miss !== usage.promptTokens || (hit > 0 && price.cacheHit == null)) return result;
  const amount = (miss * price.input + hit * (price.cacheHit ?? 0) + usage.completionTokens * price.output) / 1000000;
  if (!Number.isFinite(amount)) return result;
  return { ...result, estimatedCost: Number(amount.toFixed(12)) };
}
async function recordAttempt(attempt, { model, status, durationMs, usage, errorCode }) {
  if (!attempt) return;
  try {
    const tokens = usageFields(usage);
    await basePrisma.aiRequestRecord.create({ data: { ...attempt, model, status, durationMs: Math.min(2147483647, Math.max(0, Math.round(durationMs))), ...tokens, ...estimate(model, tokens), errorCode: errorCode ?? null } });
  } catch (error) { reportFailure('writeFailures', error.code); }
}
async function recordVerifiedPurchase(userId, storeId, verified) {
  try {
    if (verified.revokedAt || ['refunded', 'canceled'].includes(verified.status)) return;
    if (!['production', 'sandbox'].includes(verified.environment) || !verified.latestTransactionId || !(verified.purchasedAt instanceof Date)) return;
    const eventKey = `apple-verified:${verified.environment}:${createHash('sha256').update(verified.latestTransactionId).digest('hex')}`;
    await basePrisma.platformEvent.upsert({ where: { eventKey }, create: {
      eventKey, userId, storeId, kind: 'verified_purchase', source: `apple_${verified.environment}`, occurredAt: verified.purchasedAt,
      metadata: JSON.stringify({ productId: verified.latestProductId, environment: verified.environment, observedStatus: verified.status, attribution: 'receipt_verifier_not_proven_payer', entry: 'unknown' }),
    }, update: {} });
  } catch (error) { reportFailure('writeFailures', error.code); }
}
async function observeVerifiedNotification(event) {
  // A verified notification can describe a refund or settings change; neither is a new purchase.
  if (!['SUBSCRIBED', 'DID_RENEW', 'OFFER_REDEEMED'].includes(event.notificationType)) return;
  const info = event.transaction;
  if (!info || info.revocationDate || !['Production', 'Sandbox'].includes(info.environment)) return;
  try {
    const owner = await basePrisma.entitlement.findUnique({ where: { source_externalId: { source: 'apple', externalId: info.originalTransactionId } }, select: { storeId: true } });
    if (!owner) return;
    await recordVerifiedPurchase(null, owner.storeId, { environment: info.environment.toLowerCase(), latestTransactionId: info.transactionId, latestProductId: info.productId, purchasedAt: new Date(info.purchaseDate), status: 'verified' });
  } catch (error) { reportFailure('writeFailures', error.code); }
}
async function recordRegistration(tx, user, source) {
  if (!['password', 'apple', 'sms', 'staff'].includes(source)) throw new Error('Invalid registration source');
  // Same transaction as account creation. No phone, email, Apple subject, or registration payload.
  try {
    await tx.platformEvent.create({ data: { eventKey: `registration:${user.id}`, userId: user.id, storeId: user.storeId, kind: 'registration', source, occurredAt: user.createdAt || new Date() } });
  } catch (error) {
    reportFailure('writeFailures', error.code);
    throw Object.assign(new Error('注册暂未完成，请稍后重试'), { status: 503, ...(/^P\d{4}$/.test(error.code || '') ? { code: error.code } : {}) });
  }
}
module.exports = { recordRegistration, observeVerifiedNotification, runAiContext, nextAttempt, recordAttempt, usageFields, estimate, telemetryHealth, recordVerifiedPurchase };
