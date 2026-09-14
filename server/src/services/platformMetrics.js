const { z } = require('zod');
const { Prisma } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { basePrisma: db } = require('../config/prisma');
const { httpError } = require('../utils/biz');
const { telemetryHealth } = require('./metricsContext');
const DAY = 86400000;
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });
const idSchema = z.coerce.number().int().positive();
function rangeOf(query = {}) {
  const date = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) throw httpError(400, '日期须为YYYY-MM-DD或UTC ISO时间');
    const result = new Date(value);
    if (!Number.isFinite(+result) || result.toISOString().slice(0, 10) !== value.slice(0, 10)) throw httpError(400, '日期无效');
    return result;
  };
  const to = query.to == null ? new Date() : date(query.to);
  const from = query.from == null ? new Date(+to - 30 * DAY) : date(query.from);
  if (from >= to || +to - +from > 366 * DAY) throw httpError(400, '查询范围须大于0且不超过366天');
  return { from, to };
}
const pagination = (page, pageSize, total) => ({ page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
const tokenKeys = ['promptTokens', 'completionTokens', 'cacheHitTokens', 'cacheMissTokens', 'totalTokens'];
function aiWhere(query, range) {
  return { createdAt: { gte: range.from, lt: range.to }, ...(query.userId == null ? {} : { userId: idSchema.parse(query.userId) }), ...(query.storeId == null ? {} : { storeId: idSchema.parse(query.storeId) }) };
}
async function summarizeAi(where) {
  const tokenSelect = Object.fromEntries(tokenKeys.map(k => [k, true]));
  const [aggregate, statuses, known, costs, logical] = await Promise.all([
    db.aiRequestRecord.aggregate({ where, _sum: tokenSelect, _count: { _all: true, ...tokenSelect } }),
    db.aiRequestRecord.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.aiRequestRecord.count({ where: { ...where, promptTokens: { not: null }, completionTokens: { not: null }, totalTokens: { not: null } } }),
    db.aiRequestRecord.groupBy({ by: ['currency'], where: { ...where, estimatedCost: { not: null }, currency: { not: null } }, _sum: { estimatedCost: true }, _count: { _all: true } }),
    db.$queryRaw(Prisma.sql`SELECT COUNT(DISTINCT requestId) AS n FROM AiRequestRecord WHERE createdAt >= ${where.createdAt.gte} AND createdAt < ${where.createdAt.lt}${where.userId ? Prisma.sql` AND userId = ${where.userId}` : Prisma.empty}${where.storeId ? Prisma.sql` AND storeId = ${where.storeId}` : Prisma.empty}`),
  ]);
  const attempts = aggregate._count._all;
  const countStatus = status => statuses.find(r => r.status === status)?._count._all || 0;
  const costKnownAttempts = costs.reduce((n, r) => n + r._count._all, 0);
  return {
    attempts, logicalRequests: Number(logical[0].n), success: countStatus('success'), failed: countStatus('failed'), parseFailed: countStatus('parse_failed'),
    ...aggregate._sum, usageKnownAttempts: known, usageUnknownAttempts: attempts - known,
    tokenCoverage: Object.fromEntries(tokenKeys.map(k => [k, { known: aggregate._count[k], unknown: attempts - aggregate._count[k] }])),
    estimatedCosts: costs.map(r => ({ currency: r.currency, amount: r._sum.estimatedCost })), costKnownAttempts, costUnknownAttempts: attempts - costKnownAttempts,
  };
}
const entitlementSelect = { storeId: true, source: true, status: true, plan: true, expiresAt: true, appleEnvironment: true, appleVerifiedAt: true, appleTransactionId: true, applePurchaseAt: true };
const verifiedApple = row => row.source === 'apple' && row.appleVerifiedAt != null && row.appleTransactionId && ['production', 'sandbox'].includes(row.appleEnvironment);
const activePro = row => row.plan === 'pro' && row.status === 'active' && (row.expiresAt == null || row.expiresAt > new Date());
async function entitlementSummary() {
  const [rows, eventStores, eventCounts] = await Promise.all([
    db.entitlement.findMany({ select: entitlementSelect }),
    db.platformEvent.groupBy({ by: ['source', 'storeId'], where: { kind: 'verified_purchase', source: { in: ['apple_production', 'apple_sandbox'] } } }),
    db.platformEvent.groupBy({ by: ['source'], where: { kind: 'verified_purchase', source: { in: ['apple_production', 'apple_sandbox'] } }, _count: { _all: true } }),
  ]);
  const countStores = predicate => new Set(rows.filter(predicate).map(r => r.storeId)).size;
  const transactionKeys = new Map();
  for (const r of rows.filter(verifiedApple)) {
    const key = `apple-verified:${r.appleEnvironment}:${createHash('sha256').update(r.appleTransactionId).digest('hex')}`;
    transactionKeys.set(key, r.appleEnvironment);
  }
  const alreadyObserved = new Set(), keys = [...transactionKeys.keys()];
  for (let i = 0; i < keys.length; i += 200) {
    const existing = await db.platformEvent.findMany({ where: { eventKey: { in: keys.slice(i, i + 200) } }, select: { eventKey: true } });
    existing.forEach(r => alreadyObserved.add(r.eventKey));
  }
  const verifiedStores = environment => new Set([...rows.filter(r => verifiedApple(r) && r.appleEnvironment === environment).map(r => r.storeId), ...eventStores.filter(r => r.source === `apple_${environment}`).map(r => r.storeId)]).size;
  const transactionCount = environment => (eventCounts.find(r => r.source === `apple_${environment}`)?._count._all || 0) + [...transactionKeys].filter(([key, env]) => env === environment && !alreadyObserved.has(key)).length;
  return {
    currentProStores: countStores(activePro), currentVerifiedProductionProStores: countStores(r => activePro(r) && verifiedApple(r) && r.appleEnvironment === 'production'), verifiedProductionStores: verifiedStores('production'), verifiedSandboxStores: verifiedStores('sandbox'),
    manualStores: countStores(r => r.source === 'manual'), promotionStores: countStores(r => r.source === 'promotion'), unknownAppleStores: countStores(r => r.source === 'apple' && !verifiedApple(r)),
    verifiedProductionTransactions: transactionCount('production'), verifiedSandboxTransactions: transactionCount('sandbox'),
    refundedAppleRecords: rows.filter(r => r.source === 'apple' && r.status === 'refunded').length, revenue: null,
    scope: 'cumulative_known_records; currentProStores is current; source store counts may overlap',
  };
}
async function overview(query) {
  const range = rangeOf(query);
  const [users, stores, admins, staff, disabledUsers, appleUsers, phoneUsers, overlapUsers, entitlements, ai] = await Promise.all([
    db.user.count(), db.store.count(), db.user.count({ where: { role: 'admin' } }), db.user.count({ where: { role: 'staff' } }), db.user.count({ where: { status: { not: 1 } } }),
    db.user.count({ where: { identities: { some: { provider: 'apple' } } } }), db.user.count({ where: { phoneIdentity: { isNot: null } } }), db.user.count({ where: { identities: { some: { provider: 'apple' } }, phoneIdentity: { isNot: null } } }),
    entitlementSummary(), summarizeAi(aiWhere(query, range)),
  ]);
  const sources = await db.$queryRaw(Prisma.sql`SELECT e.source, COUNT(DISTINCT u.id) AS n FROM User u JOIN PlatformEvent e ON e.eventKey = 'registration:' || u.id AND e.kind = 'registration' GROUP BY e.source`);
  const registrationSources = Object.fromEntries(['password','apple','sms','staff'].map(source => [source, Number(sources.find(r => r.source === source)?.n || 0)]));
  registrationSources.unknown = users - Object.values(registrationSources).reduce((sum, n) => sum + n, 0);
  return {
    range, registrationSources, registrations: { users, stores, admins, staff, disabledUsers, firstRegistrationSource: registrationSources.unknown === users ? 'unknown' : 'event_recorded_or_unknown' }, bindings: { appleUsers, phoneUsers, overlapUsers, interpretation: 'current' }, entitlements, ai,
    telemetry: telemetryHealth(), notes: [
      '注册与权益数量为当前留存的累计记录；AI汇总按所选时段。已硬删除用户无法从当前User表重建历史注册总数。',
      'Apple与手机号为当前绑定，可重叠；首次注册渠道只取服务端注册事件，无历史事件时显示未知。',
      '真实购买仅包含已验证Production Apple记录；Sandbox、人工、体验赠送独立。当前Pro不等于付费，不估算Apple实收或净收入。',
      '历史订阅链仅保留最新已验证交易；交易数量是已知下界，购买入口与真实付款人未知。',
      'AI成功表示provider回复JSON解析成功，不等于业务落单；历史逐用户token不补造，缺usage或模型价格保留未知。',
    ],
  };
}
const userSelect = { id: true, storeId: true, username: true, realName: true, role: true, status: true, createdAt: true, identities: { select: { provider: true } }, phoneIdentity: { select: { userId: true } } };
async function presentUsers(rows) {
  const [stores, events] = await Promise.all([
    db.store.findMany({ where: { id: { in: [...new Set(rows.map(r => r.storeId))] } }, select: { id: true, name: true } }),
    db.platformEvent.findMany({ where: { eventKey: { in: rows.map(r => `registration:${r.id}`) }, kind: 'registration', source: { in: ['password','apple','sms','staff'] } }, select: { userId: true, source: true } }),
  ]);
  return rows.map(({ identities, phoneIdentity, ...user }) => ({ ...user, store: stores.find(s => s.id === user.storeId) || { id: user.storeId, name: '已删除店铺' }, bindings: { apple: identities.some(i => i.provider === 'apple'), phone: !!phoneIdentity }, registrationSource: events.find(e => e.userId === user.id)?.source || 'unknown' }));
}
async function users(query) {
  const { page, pageSize } = pageSchema.parse(query);
  const term = z.string().max(100).default('').parse(query.query).trim();
  const where = term ? { OR: [{ username: { contains: term } }, { realName: { contains: term } }, ...(/^\d+$/.test(term) && Number.isSafeInteger(Number(term)) ? [{ id: Number(term) }, { storeId: Number(term) }] : [])] } : {};
  const [total, rows] = await Promise.all([db.user.count({ where }), db.user.findMany({ where, select: userSelect, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { list: await presentUsers(rows), pagination: pagination(page, pageSize, total) };
}
async function userDetail(rawId, query = {}) {
  const id = idSchema.parse(rawId), range = rangeOf(query);
  const row = await db.user.findUnique({ where: { id }, select: userSelect });
  if (!row) throw httpError(404, '用户不存在');
  const storeId = row.storeId;
  const [products, skus, orders, purchaseOrders, aiAttempts, ai, rights, firstOrder, firstAi, event] = await Promise.all([
    db.product.count({ where: { storeId, isDeleted: 0 } }), db.sku.count({ where: { storeId } }), db.order.count({ where: { storeId } }), db.purchaseOrder.count({ where: { storeId } }), db.aiRequestRecord.count({ where: { userId: id } }),
    summarizeAi(aiWhere({ userId: id }, range)), db.entitlement.findMany({ where: { storeId }, select: entitlementSelect }),
    db.order.findFirst({ where: { storeId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.aiRequestRecord.findFirst({ where: { storeId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    db.platformEvent.findFirst({ where: { storeId, kind: 'verified_purchase', source: 'apple_production' }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
  ]);
  const knownDates = [...rights.filter(r => verifiedApple(r) && r.appleEnvironment === 'production' && r.applePurchaseAt).map(r => r.applePurchaseAt), ...(event ? [event.occurredAt] : [])];
  const purchaseAt = knownDates.length ? new Date(Math.min(...knownDates.map(Number))) : null;
  return {
    user: (await presentUsers([row]))[0], range, counts: { products, skus, orders, purchaseOrders, aiAttempts }, countsScope: 'business=store; aiAttempts=user', ai,
    entitlements: rights.map(r => ({ source: r.source, status: r.status === 'active' && r.expiresAt != null && r.expiresAt <= new Date() ? 'expired' : r.status, plan: r.plan, environment: r.appleEnvironment, expiresAt: r.expiresAt, verified: !!verifiedApple(r) })),
    purchaseStage: { earliestKnownPurchaseAt: purchaseAt, registeredAt: row.createdAt, firstOrderAt: firstOrder?.createdAt || null, firstAiAt: firstAi?.createdAt || null, daysFromRegistration: purchaseAt && purchaseAt >= row.createdAt ? Math.floor((purchaseAt - row.createdAt) / DAY) : null, phase: purchaseAt && firstOrder ? purchaseAt < firstOrder.createdAt ? 'before_first_order' : 'after_first_order' : 'unknown', aiPhase: purchaseAt && firstAi ? purchaseAt < firstAi.createdAt ? 'before_first_known_ai' : 'after_first_known_ai' : 'unknown', entry: 'unknown', attribution: 'store', historyComplete: false },
  };
}
async function aiRequests(query) {
  const { page, pageSize } = pageSchema.parse(query), range = rangeOf(query), where = aiWhere(query, range);
  const [total, rows, summary] = await Promise.all([
    db.aiRequestRecord.count({ where }), db.aiRequestRecord.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }), summarizeAi(where),
  ]);
  return { list: rows.map(r => ({ ...r, pricingSnapshot: r.pricingSnapshot ? JSON.parse(r.pricingSnapshot) : null })), range, pagination: pagination(page, pageSize, total), summary };
}
module.exports = { overview, users, userDetail, aiRequests, rangeOf, summarizeAi };
