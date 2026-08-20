// 权益层：把「买了什么」和「从哪买的」彻底分开。
//
// 业务代码永远只问 currentPlan(storeId) 一个问题。
// 苹果内购、官网支付宝、安卓商店、人工发放，各自只负责往 Entitlement 表写一条记录，
// 它们的凭证校验逻辑各自独立，互不知道对方存在。
//
// 现在这层只记不拦：AI 用量照常记录，额度默认不限（FREE_AI_MONTHLY 不配就是关的）。
// 等上架后有了真实用量分布，再决定免费额度定多少——现在拍脑袋定的数字一定是错的。
const { basePrisma, getTenantId } = require('../config/prisma');
const { localDayKey } = require('./biz');

const PLAN_FREE = 'free';

/// 这家店当前的权益。没有有效权益 = free（免费档永远可用，这是对用户的承诺）
const currentPlan = async (storeId) => {
  const id = storeId ?? getTenantId();
  if (!id) return { plan: PLAN_FREE, source: null, expiresAt: null };
  const now = new Date();
  const e = await basePrisma.entitlement.findFirst({
    where: {
      storeId: id,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ expiresAt: 'desc' }], // 有多条时取管得最久的那条
  });
  if (!e) return { plan: PLAN_FREE, source: null, expiresAt: null };
  return { plan: e.plan, source: e.source, expiresAt: e.expiresAt };
};

/// 发放权益。各渠道校验完自己的凭证后调这里，落库这一步是统一的。
/// externalId 上有唯一约束：同一笔交易重复回调不会发两次权益（幂等）。
const grantEntitlement = async ({ storeId, plan, source, externalId = null, expiresAt = null, note = null }) => {
  if (!storeId || !plan || !source) throw new Error('grantEntitlement 缺少 storeId/plan/source');
  if (externalId) {
    return basePrisma.entitlement.upsert({
      where: { source_externalId: { source, externalId } },
      create: { storeId, plan, source, externalId, expiresAt, note, status: 'active' },
      update: { plan, expiresAt, status: 'active', note },
    });
  }
  return basePrisma.entitlement.create({ data: { storeId, plan, source, expiresAt, note, status: 'active' } });
};

/// 撤销权益（退款/取消订阅/风控）。退款不撤权益等于白送。
const revokeEntitlement = async ({ source, externalId, status = 'refunded' }) =>
  basePrisma.entitlement.updateMany({ where: { source, externalId }, data: { status } });

/// 记一次 AI 调用（按店/按天/按环节累计）。
/// 失败绝不能影响业务——计量出问题不该让老板记不了账。
const recordAiUsage = async (endpoint, storeId) => {
  const id = storeId ?? getTenantId();
  if (!id) return;
  const day = localDayKey(new Date());
  try {
    await basePrisma.aiUsage.upsert({
      where: { storeId_day_endpoint: { storeId: id, day, endpoint } },
      create: { storeId: id, day, endpoint, calls: 1 },
      update: { calls: { increment: 1 } },
    });
  } catch (_) {
    /* 计量失败静默：不能因为记账表出问题就挡住用户干活 */
  }
};

/// 今天已用的 AI 次数。bucket='core' 只数口述记账链路，'other' 数其余。
/// 按天不按月：月额度会让用户"月初挥霍月末干瞪眼"，按天给挫败感小得多，成本上限一样。
const CORE_ENDPOINTS = ['parse-entry', 'confirm-entry'];
const dailyAiCalls = async (bucket, storeId) => {
  const id = storeId ?? getTenantId();
  if (!id) return 0;
  const day = localDayKey(new Date());
  const rows = await basePrisma.aiUsage.findMany({ where: { storeId: id, day }, select: { calls: true, endpoint: true } });
  return rows
    .filter((r) => (bucket === 'core' ? CORE_ENDPOINTS.includes(r.endpoint) : !CORE_ENDPOINTS.includes(r.endpoint)))
    .reduce((s, r) => s + r.calls, 0);
};

/// 本月已用的 AI 次数（本地时区的"本月"）
const monthlyAiCalls = async (storeId) => {
  const id = storeId ?? getTenantId();
  if (!id) return 0;
  const prefix = localDayKey(new Date()).slice(0, 7); // YYYY-MM
  const rows = await basePrisma.aiUsage.findMany({
    where: { storeId: id, day: { startsWith: prefix } },
    select: { calls: true },
  });
  return rows.reduce((s, r) => s + r.calls, 0);
};

/// 本月有几天把额度用满了。订阅页拿它说人话："这个月有 12 天不够用"。
/// 这个数字必须是真的——拿假数字劝人掏钱，被发现一次信任就没了。
/// 只统计 core（口述记账）那份额度，因为那才是用户真正会撞的墙。
const daysHitLimit = async (limit, storeId) => {
  const id = storeId ?? getTenantId();
  if (!id || !limit || limit <= 0) return 0;
  const prefix = localDayKey(new Date()).slice(0, 7);
  const rows = await basePrisma.aiUsage.findMany({
    where: { storeId: id, day: { startsWith: prefix }, endpoint: { in: CORE_ENDPOINTS } },
    select: { day: true, calls: true },
  });
  // 同一天可能有多个 core 端点各记一行，先按天合并再判断
  const perDay = new Map();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.calls);
  let n = 0;
  for (const calls of perDay.values()) if (calls >= limit) n++;
  return n;
};

module.exports = { PLAN_FREE, CORE_ENDPOINTS, currentPlan, grantEntitlement, revokeEntitlement, recordAiUsage, dailyAiCalls, monthlyAiCalls, daysHitLimit };
