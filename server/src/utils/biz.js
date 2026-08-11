// 业务小工具
const httpError = (status, message) => {
  const e = new Error(message);
  e.status = status;
  return e;
};

// JSON 字段（DB 里存 String）安全解析
const parseJson = (str, fallback) => {
  try {
    return str == null ? fallback : JSON.parse(str);
  } catch {
    return fallback;
  }
};

// 序列化品类（options/customFields 转回 JSON）
const serializeField = (f) => ({ ...f, options: parseJson(f.options, null) });
// 提示词瘦身：只保留「名字里有字出现在这句话里」的条目。
// 无脑拼全量的代价：500 个商品的店每次口述都在为 500 行付费，
// 而其中 490 行跟这句话一个字都不沾边——AI 本来也匹配不上，纯烧钱。
// 单字命中很宽松（宁可多带绝不漏），再用 floor/cap 兜住下限和上限。
const narrowForPrompt = (list, nameOf, text, { floor = 20, cap = 150 } = {}) => {
  if (!Array.isArray(list) || !list.length) return [];
  const t = String(text ?? '');
  // 只按中文字匹配：数字和字母是噪音源——"500ml" 里的数字会命中口述里的 "192"，
  // 一匹配全中，过滤就形同虚设。中文单字匹配足够宽松（"青啤"能命中"青岛啤酒"），又不会误伤。
  const cjk = (str) => [...String(str ?? '')].filter((ch) => /[\u4e00-\u9fa5]/.test(ch));
  const textChars = new Set(cjk(t));
  const hit = list.filter((x) => cjk(nameOf(x)).some((ch) => textChars.has(ch)));
  if (hit.length >= cap) return hit.slice(0, cap);
  if (hit.length >= floor) return hit;
  const hitSet = new Set(hit);
  const rest = list.filter((x) => !hitSet.has(x)).slice(-(floor - hit.length));
  return [...hit, ...rest];
};

// 钱一律两位小数。别指望存储层帮你抹平浮点脏值——
// 0.7*3 在 JS 里是 2.0999999999999996，SQLite 写入时碰巧归整成 2.1，
// 但这是巧合不是保证：这个脏值只要参与一次折扣计算，让利额就少 1 分。
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 日期键：必须按**本地时区**取，不能用 toISOString（那是 UTC）。
// 北京时间 00:00-08:00 的单子 toISOString 会落到前一天——早市摊主 6 点卖的货全算昨天。
const localDayKey = (d) => {
  const t = new Date(d);
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const serializeProduct = (p) => ({
  ...p,
  customFields: parseJson(p.customFields, {}),
  ...(p.productType ? { productType: serializeType(p.productType) } : {}),
  ...(p.skus
    ? {
        skus: p.skus.map((s) => ({ ...s, specValues: parseJson(s.specValues, {}) })),
        totalStock: p.skus.reduce((sum, s) => sum + (s.inventory?.quantity ?? 0), 0),
      }
    : {}),
});
const serializeType = (t) => ({
  ...t,
  ...(t.fields ? { fields: t.fields.map(serializeField) } : {}),
});

// 单号：前缀 + yyyyMMdd + 3位序号（SO=销售单 PO=进货单）
// 单号 = 前缀 + 当天日期 + 当日序号。序号靠 count 推算，两台手机同一瞬间开单会拿到同一个 count；
// 库里有 @@unique([storeId, orderNo]) 兜底，所以不会重号，但第二个人会看到"开单失败"。
// 这里主动避让：真被占了就顺延取下一个空号，最多试 10 次。
const genDocNo = async (prisma, model, prefix) => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const p = `${prefix}${ymd}`;
  let seq = (await prisma[model].count({ where: { orderNo: { startsWith: p } } })) + 1;
  for (let i = 0; i < 10; i++) {
    const no = `${p}${String(seq).padStart(3, '0')}`;
    const taken = await prisma[model].findFirst({ where: { orderNo: no }, select: { id: true } });
    if (!taken) return no;
    seq++;
  }
  // 极端并发下退到时间戳后缀：宁可单号不连号，也不能让老板开不出单
  return `${p}${String(seq).padStart(3, '0')}-${Date.now() % 1000}`;
};
const genOrderNo = (prisma) => genDocNo(prisma, 'order', 'SO');
const genPurchaseNo = (prisma) => genDocNo(prisma, 'purchaseOrder', 'PO');

// SKU 序列化 + 规格描述文本（"500ml · 53度"）
const serializeSku = (s) => ({
  ...s,
  specValues: parseJson(s.specValues, {}),
});
const buildSpecText = (specValues, fields) => {
  const entries = Object.entries(specValues || {});
  if (!entries.length) return '';
  const byKey = Object.fromEntries((fields || []).map((f) => [f.key, f]));
  return entries
    .map(([k, v]) => {
      const f = byKey[k];
      if (f?.unit) return `${v}${f.unit}`; // 有单位：500ml
      if (f?.type === 'number') return `${f.label}${v}`; // 纯数字标含义：酒精度52
      return `${v}`; // 枚举值本身可读：袋装/盒装
    })
    .join(' · ');
};

// 商品编码：P + 时间戳后8位（可被用户自定义覆盖）
const genProductCode = () => `P${Date.now().toString().slice(-8)}`;

/// 内置「散客」：不是每一单都有具体客户。夫妻店、路边摊绝大多数就是一手交钱一手交货，
/// 强制先建客户档案会把第一单就卡死。开单不传 customerId 时兜底挂到这里。
/// 传 tx 或 prisma 都行。
const getWalkInCustomer = async (db) => {
  let c = await db.customer.findFirst({ where: { name: '散客', isDeleted: 0 } });
  if (!c) c = await db.customer.create({ data: { name: '散客', notes: '系统内置：没有指定客户的零售单挂在这里' } });
  return c;
};

/// 是否允许卖成负库存（店铺设置，默认允许）。
/// 硬卡「库存不足」对新用户是劝退级体验：库存还没录全客人就来了，
/// 单开不出来，人就走了。生意真发生了账就得记，库存差额留给盘点纠。
/// 想严格管控的老板可以在设置里关掉。
const isNegativeStockAllowed = async () => {
  const prisma = require('../config/prisma');
  const s = await prisma.setting.findFirst({ where: { key: 'allowNegativeStock' } }); // findFirst=扩展层自动按店过滤
  return s?.value !== '0'; // 没设过 = 允许
};


/// 卖出扣库存（orders.create 与口述记账共用）。
/// 有配方的 SKU 是"成品"：卖 1 份扣的是配方里各原料的用量，成品自身不追库存——
/// 奶茶店卖一杯扣茶叶/牛奶/杯子，而不是扣一个叫"奶茶"的虚拟数。
/// 返回被扣成负数的清单（allowNegative=false 时直接抛错）。
const deductForSale = async (tx, { sku, qty, reasonLabel, relatedOrderId, operatorId, allowNegative }) => {
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const negatives = [];
  const components = await tx.recipe.findMany({ where: { ownerSkuId: sku.id } });
  const targets = components.length
    ? await Promise.all(
        components.map(async (c) => ({
          sku: await tx.sku.findUnique({ where: { id: c.componentSkuId }, include: { product: true } }),
          qty: r3(c.qty * qty),
        }))
      )
    : [{ sku, qty: r3(qty) }];

  for (const t of targets) {
    if (!t.sku) continue; // 原料被删了：跳过并记负库存提示以外的问题?——保守跳过
    let inv = await tx.inventory.findUnique({ where: { skuId: t.sku.id } });
    if (!inv) inv = await tx.inventory.create({ data: { productId: t.sku.productId, skuId: t.sku.id } });
    const before = inv.quantity;
    const after = r3(before - t.qty);
    const label = `${t.sku.product?.name ?? ''}${t.sku.specText ? ` ${t.sku.specText}` : ''}`;
    if (after < 0) {
      if (!allowNegative) throw httpError(400, `「${label}」库存不足：仅剩 ${before}`);
      negatives.push(`${label} → ${after}`);
    }
    await tx.inventory.update({ where: { id: inv.id }, data: { quantity: after } });
    await tx.inventoryRecord.create({
      data: {
        productId: t.sku.productId,
        skuId: t.sku.id,
        type: 'outbound',
        quantity: t.qty,
        beforeQuantity: before,
        afterQuantity: after,
        reason: components.length ? `配方扣料 ${reasonLabel}` : reasonLabel,
        relatedOrderId: relatedOrderId ?? null,
        operatorId,
      },
    });
  }
  return negatives;
};

module.exports = {
  deductForSale,
  getWalkInCustomer,
  isNegativeStockAllowed,
  httpError,
  parseJson,
  serializeField,
  money,
  narrowForPrompt,
  localDayKey,
  serializeProduct,
  serializeType,
  serializeSku,
  buildSpecText,
  genOrderNo,
  genPurchaseNo,
  genProductCode,
};
