const crypto = require('node:crypto');
const { z } = require('zod');
const { basePrisma: db } = require('../config/prisma');
const { httpError } = require('../utils/biz');
const { currentPlan } = require('../utils/entitlement');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const batchSchema = z.object({ requestId: z.string().uuid(), label: z.string().trim().min(1).max(80), count: z.number().int().min(1).max(100), redeemExpiresAt: z.string().datetime({ offset: true }).nullable().optional() }).strict();
const why = value => z.object({ reason: z.string().trim().min(2).max(240) }).strict().parse(value).reason;
async function atomic(work) {
  for (let i = 0; ; i++) {
    try { return await db.$transaction(work, { maxWait: 10000, timeout: 20000 }); }
    catch (e) { if (i >= 3 || !['P1008','P2028','P2034'].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 30 * 2 ** i)); }
  }
}
async function lockAdmin(tx, admin) {
  if (!Number.isInteger(admin?.id) || !Number.isInteger(admin?.sessionVersion)) throw httpError(403, '需要平台管理员身份');
  const changed = await tx.platformAdmin.updateMany({ where: { id: admin.id, status: 1, sessionVersion: admin.sessionVersion }, data: { sessionVersion: { increment: 0 } } });
  if (changed.count !== 1) throw httpError(401, '平台登录已失效');
}
function encryptionKey() {
  const raw = process.env.PROMO_CODE_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw httpError(503, '体验码发放密钥尚未配置');
  return key;
}
function seal(codes, batchId) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(batchId));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(codes), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64')).join('.');
}
function unseal(value, batchId) {
  const [iv, tag, encrypted] = value.split('.').map(v => Buffer.from(v, 'base64'));
  try { const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv); cipher.setAAD(Buffer.from(batchId)); cipher.setAuthTag(tag); return JSON.parse(Buffer.concat([cipher.update(encrypted), cipher.final()]).toString()); }
  catch { throw httpError(503, '体验码发放材料暂无法恢复，请核对平台密钥'); }
}
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const letters = [...crypto.randomBytes(16)].map(n => alphabet[n & 31]).join('');
  return `ZC-${letters.match(/.{4}/g).join('-')}`;
}
function normalize(value) {
  const code = z.string().trim().min(1).max(80).parse(value).toUpperCase().replace(/[\s-]/g, '');
  if (!/^ZC[A-HJ-NP-Z2-9]{16}$/.test(code)) throw httpError(400, '请输入完整智存体验码');
  return code;
}
const publicBatch = row => ({ id: row.id, label: row.label, count: row.count, redeemExpiresAt: row.redeemExpiresAt, createdAt: row.createdAt });
async function createBatch(input, admin) {
  const parsed = batchSchema.parse(input);
  const data = { label: parsed.label, count: parsed.count, redeemExpiresAt: parsed.redeemExpiresAt ? new Date(parsed.redeemExpiresAt).toISOString() : null };
  const contentHash = hash(JSON.stringify(data));
  encryptionKey();
  return atomic(async tx => {
    await lockAdmin(tx, admin);
    const previous = await tx.promoBatch.findUnique({ where: { adminId_requestId: { adminId: admin.id, requestId: parsed.requestId } } });
    if (previous) {
      if (previous.contentHash !== contentHash) throw httpError(409, '此生成编号已用于不同内容，请重试原批次');
      const codes = unseal(previous.sealedCodes, previous.id);
      await tx.platformAudit.create({ data: { adminId: admin.id, action: 'promo.batch.recover', targetId: previous.id, metadata: JSON.stringify({ count: codes.length }) } });
      return { batch: publicBatch(previous), codes, replayed: true };
    }
    if (data.redeemExpiresAt && new Date(data.redeemExpiresAt) <= new Date()) throw httpError(400, '领取截止时间须晚于当前时间');
    const id = crypto.randomUUID();
    const codes = Array.from({ length: data.count }, () => { const code = newCode(); return { id: crypto.randomUUID(), code, hint: `••••-${code.slice(-4)}` } });
    const batch = await tx.promoBatch.create({ data: { ...data, redeemExpiresAt: data.redeemExpiresAt ? new Date(data.redeemExpiresAt) : null, id, adminId: admin.id, requestId: parsed.requestId, contentHash, sealedCodes: seal(codes, id) } });
    for (const code of codes) await tx.promoCode.create({ data: { id: code.id, batchId: id, codeHash: hash(normalize(code.code)), codeHint: code.hint, redeemExpiresAt: batch.redeemExpiresAt } });
    await tx.platformAudit.create({ data: { adminId: admin.id, action: 'promo.batch.create', targetId: id, metadata: JSON.stringify({ count: codes.length, label: data.label }) } });
    return { batch: publicBatch(batch), codes, replayed: false };
  });
}
const pageInput = query => z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20), state: z.enum(['unused','redeemed','disabled','revoked','expired']).optional(), batchId: z.string().uuid().optional() }).strict().parse(query);
async function listCodes(query) {
  const { page, pageSize, state, batchId } = pageInput(query);
  const where = { ...(batchId ? { batchId } : {}), ...(state === 'expired' ? { state: 'unused', redeemExpiresAt: { lte: new Date() } } : state ? { state, ...(state === 'unused' ? { OR: [{ redeemExpiresAt: null }, { redeemExpiresAt: { gt: new Date() } }] } : {}) } : {}) };
  const [rows, total] = await Promise.all([db.promoCode.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, batchId: true, codeHint: true, state: true, redeemExpiresAt: true, storeId: true, userId: true, entitlementId: true, redeemedAt: true, revokedAt: true, createdAt: true } }), db.promoCode.count({ where })]);
  const batches = await db.promoBatch.findMany({ where: { id: { in: rows.map(r => r.batchId) } }, select: { id: true, label: true } });
  return { list: rows.map(row => ({ ...row, state: row.state === 'unused' && row.redeemExpiresAt && row.redeemExpiresAt <= new Date() ? 'expired' : row.state, batchLabel: batches.find(b => b.id === row.batchId)?.label || '' })), total, page, pageSize };
}
async function audit(query) {
  const { page, pageSize } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(query);
  const [list,total] = await Promise.all([db.platformAudit.findMany({ orderBy: [{createdAt:'desc'}, {id:'desc'}],skip:(page-1)*pageSize,take:pageSize,select:{id:true,adminId:true,actorUserId:true,action:true,targetId:true,storeId:true,reason:true,createdAt:true} }), db.platformAudit.count()]);
  return { list, total, page, pageSize };
}
async function manage(id, input, admin, action) {
  z.string().uuid().parse(id); const reason = why(input);
  return atomic(async tx => {
    await lockAdmin(tx, admin);
    const code = await tx.promoCode.findUnique({ where: { id } });
    if (!code) throw httpError(404, '体验码不存在');
    const targetState = action === 'disable' ? 'disabled' : 'revoked';
    if (code.state === targetState) return { id, state: targetState, replayed: true };
    if (action === 'disable' && code.state !== 'unused') throw httpError(409, '已领取的体验须使用收回权益操作');
    if (action === 'revoke' && code.state !== 'redeemed') throw httpError(409, '该体验尚未领取，请使用停用体验码');
    if (action === 'revoke') {
      const changed = await tx.entitlement.updateMany({ where: { id: code.entitlementId, storeId: code.storeId, source: 'promotion', externalId: code.id }, data: { status: 'canceled' } });
      if (changed.count !== 1) throw httpError(409, '体验权益对应记录不完整，请核对后处理');
    }
    await tx.promoCode.update({ where: { id }, data: { state: targetState, revokedAt: new Date() } });
    await tx.platformAudit.create({ data: { adminId: admin.id, action: `promo.${action}`, targetId: id, storeId: code.storeId, reason } });
    return { id, state: targetState, replayed: false };
  });
}
async function redeem(input, actor) {
  const { code } = z.object({ code: z.string() }).strict().parse(input);
  if (actor?.role !== 'admin') throw httpError(403, '请店主在自己的账号兑换，员工同步享有店铺权益');
  const codeHash = hash(normalize(code));
  const result = await atomic(async tx => {
    const locked = await tx.user.updateMany({ where: { id: actor.userId, storeId: actor.storeId, role: 'admin', status: 1, sessionVersion: actor.sessionVersion }, data: { sessionVersion: { increment: 0 } } });
    if (locked.count !== 1 || !await tx.store.findUnique({ where: { id: actor.storeId } })) throw httpError(401, '账号或店铺已失效');
    const row = await tx.promoCode.findUnique({ where: { codeHash } });
    if (!row) throw httpError(400, '体验码无效，请核对后重试');
    if (row.storeId && row.storeId !== actor.storeId) throw httpError(409, '此体验码已用于另一店铺');
    if (row.state === 'revoked' || row.state === 'disabled') throw httpError(410, '此体验码或体验权益已停用');
    if (row.state === 'redeemed') {
      const existing = await tx.entitlement.findFirst({ where: { id: row.entitlementId, storeId: actor.storeId, source: 'promotion', externalId: row.id, status: 'active' } });
      if (!existing) throw httpError(410, '此体验权益已失效');
      return { replayed: true, grant: { id: existing.id, state: 'active', storeId: row.storeId, expiresAt: existing.expiresAt } };
    }
    if (row.redeemExpiresAt && row.redeemExpiresAt <= new Date()) throw httpError(410, '此体验码已超过领取截止时间');
    const entitlement = await tx.entitlement.create({ data: { storeId: actor.storeId, plan: 'pro', source: 'promotion', externalId: row.id, expiresAt: null, note: '平台赠送，不设到期，可由平台收回' } });
    await tx.promoCode.update({ where: { id: row.id }, data: { state: 'redeemed', storeId: actor.storeId, userId: actor.userId, entitlementId: entitlement.id, redeemedAt: new Date() } });
    await tx.platformAudit.create({ data: { actorUserId: actor.userId, action: 'promo.redeem', targetId: row.id, storeId: actor.storeId } });
    return { replayed: false, grant: { id: entitlement.id, state: 'active', storeId: actor.storeId, expiresAt: null } };
  });
  return { ...result, entitlement: await currentPlan(actor.storeId) };
}
module.exports = { createBatch, listCodes, audit, redeem, disable: (id,body,admin) => manage(id,body,admin,'disable'), revoke: (id,body,admin) => manage(id,body,admin,'revoke') };
