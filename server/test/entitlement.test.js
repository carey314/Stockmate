// 权益层：买的是「权益」，权益挂在店铺上，支付渠道只是来源字段。
// 这层写错的后果：要么该给的权益没给（用户付了钱用不了），要么退款了权益还在（白送）。
process.env.TZ = 'Asia/Shanghai';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedDb, dropIsolatedDb, seedBase } = require('./helpers/db');

const DB_FILE = useIsolatedDb('entitlement'); // 必须在 require prisma 之前
const prisma = require('../src/config/prisma');
const { basePrisma } = prisma;
const { currentPlan, grantEntitlement, revokeEntitlement, recordAiUsage, monthlyAiCalls, PLAN_FREE } =
  require('../src/utils/entitlement');

const STORE = 1;
const OTHER_STORE = 2;

before(async () => {
  await seedBase(basePrisma); // helper 要求显式传 prisma 实例
  await basePrisma.store.upsert({ where: { id: OTHER_STORE }, create: { id: OTHER_STORE, name: '别人家的店' }, update: {} });
});
after(async () => {
  await basePrisma.$disconnect();
  dropIsolatedDb(DB_FILE);
});

describe('权益查询 · 没买过就是免费档（免费永远可用是对用户的承诺）', () => {
  test('从没发过权益的店 = free', async () => {
    const p = await currentPlan(STORE);
    assert.equal(p.plan, PLAN_FREE);
    assert.equal(p.source, null);
  });

  test('发放后立刻生效，并带出来源渠道', async () => {
    await grantEntitlement({ storeId: STORE, plan: 'pro', source: 'web', externalId: 'WEB-1', expiresAt: new Date(Date.now() + 864e5) });
    const p = await currentPlan(STORE);
    assert.equal(p.plan, 'pro');
    assert.equal(p.source, 'web');
  });

  test('权益是按店隔离的：这家店买了，别家不能白蹭', async () => {
    assert.equal((await currentPlan(OTHER_STORE)).plan, PLAN_FREE);
  });

  test('过期的权益不算数，自动退回 free', async () => {
    await grantEntitlement({ storeId: OTHER_STORE, plan: 'pro', source: 'apple', externalId: 'APL-EXPIRED', expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await currentPlan(OTHER_STORE)).plan, PLAN_FREE);
  });

  test('expiresAt 为 null = 永久权益（人工发的内测号）', async () => {
    await grantEntitlement({ storeId: OTHER_STORE, plan: 'pro', source: 'manual', note: '内测' });
    const p = await currentPlan(OTHER_STORE);
    assert.equal(p.plan, 'pro');
    assert.equal(p.expiresAt, null);
  });
});

describe('渠道解耦 · 同一份权益可以来自任何渠道', () => {
  test('三个渠道各发各的，互不干扰', async () => {
    const store = 3;
    await basePrisma.store.upsert({ where: { id: store }, create: { id: store, name: '三渠道店' }, update: {} });
    await grantEntitlement({ storeId: store, plan: 'pro', source: 'apple', externalId: 'APL-9', expiresAt: new Date(Date.now() + 864e5) });
    await grantEntitlement({ storeId: store, plan: 'pro', source: 'android', externalId: 'AND-9', expiresAt: new Date(Date.now() + 2 * 864e5) });
    const p = await currentPlan(store);
    assert.equal(p.plan, 'pro');
    // 多条有效时取管得最久的那条，用户不吃亏
    assert.equal(p.source, 'android');
  });

  test('同一笔交易重复回调只发一次权益（渠道回调必然重复，幂等是硬要求）', async () => {
    const store = 4;
    await basePrisma.store.upsert({ where: { id: store }, create: { id: store, name: '幂等店' }, update: {} });
    for (let i = 0; i < 3; i++) {
      await grantEntitlement({ storeId: store, plan: 'pro', source: 'apple', externalId: 'APL-SAME', expiresAt: new Date(Date.now() + 864e5) });
    }
    const rows = await basePrisma.entitlement.findMany({ where: { storeId: store } });
    assert.equal(rows.length, 1, '重复回调不该产生多条权益');
  });
});

describe('撤销 · 退款了权益必须跟着没（不撤等于白送）', () => {
  test('退款后立刻回落到 free', async () => {
    const store = 5;
    await basePrisma.store.upsert({ where: { id: store }, create: { id: store, name: '退款店' }, update: {} });
    await grantEntitlement({ storeId: store, plan: 'pro', source: 'apple', externalId: 'APL-REFUND', expiresAt: new Date(Date.now() + 864e5) });
    assert.equal((await currentPlan(store)).plan, 'pro');
    await revokeEntitlement({ source: 'apple', externalId: 'APL-REFUND' });
    assert.equal((await currentPlan(store)).plan, PLAN_FREE);
  });
});

describe('AI 用量计量 · 将来定价的唯一依据', () => {
  test('按店按天按环节累加', async () => {
    const store = 6;
    await basePrisma.store.upsert({ where: { id: store }, create: { id: store, name: '计量店' }, update: {} });
    await recordAiUsage('parse-entry', store);
    await recordAiUsage('parse-entry', store);
    await recordAiUsage('ask', store);
    assert.equal(await monthlyAiCalls(store), 3);
    const rows = await basePrisma.aiUsage.findMany({ where: { storeId: store } });
    assert.equal(rows.length, 2, '两个环节分开记，定价时要看哪个环节费钱');
  });

  test('用量也是按店隔离的', async () => {
    assert.equal(await monthlyAiCalls(999), 0);
  });

  test('没有租户上下文时静默跳过，不抛错（计量不能反过来搞挂业务）', async () => {
    await recordAiUsage('parse-entry', null);
    assert.ok(true);
  });
});
