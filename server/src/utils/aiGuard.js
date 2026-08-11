// AI 输出清洗层：每个 AI 环节一个专用 sanitizer。
//
// 原则：**AI 说什么不算数，过了清洗才算数。**
// 提示词能降低乱生成的概率，但保证不了下限——下限由这里的代码保证：
// - 非法条目直接丢弃并记入 dropped（前端可提示"AI 给了 N 条不合格的已忽略"），绝不带病进 UI
// - AI 违反铁律的字段（如商品生成偷带 costPrice）在这里强制剥离
// - 数字一律 coerce：字符串数字转数字，转不了置 null/丢弃，绝不让 NaN 传播进账本

const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const FIELD_TYPES = new Set(['text', 'number', 'select', 'date', 'boolean']);
const EXPENSE_CATEGORIES = new Set(['摊位费', '燃气', '运输', '水电', '人工', '其他']);

// 数字清洗。**必须先挡住 null/''/布尔**——JS 里 Number(null)、Number('')、Number(false) 全是 0，
// 而提示词明令 AI"信息缺失就填 null"。不挡的话，"老板没说进价"会被洗成"进价 0 元"，
// 落库直接把商品原有成本抹成 0：毛利虚高一倍，且 profitUnreliable 判的是 == null，
// 0 不是 null → 连"这单没填进价"的诚实提示都不会亮。这是最阴的一类错：数字看着很确定，其实是编的。
const num = (v) => {
  if (v == null || typeof v === 'boolean') return null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[¥,，\s元]/g, '');
    if (cleaned === '') return null; // "元"、"￥"、纯空格 → 不是数字，是没填
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- 环节1：品类字段生成 ----------
// 保证：key 合法且不重复、type 在枚举内、select 必有非空 options、数量有上限
const sanitizeFields = (parsed) => {
  const dropped = [];
  const seen = new Set();
  const clean = (raw, scope, cap) => {
    const out = [];
    for (const f of Array.isArray(raw) ? raw : []) {
      if (out.length >= cap) {
        dropped.push(`${scope}「${str(f?.label) || str(f?.key)}」超出数量上限`);
        continue;
      }
      const key = str(f?.key, 40);
      const label = str(f?.label, 20);
      const type = FIELD_TYPES.has(f?.type) ? f.type : 'text';
      if (!key || !FIELD_KEY_RE.test(key) || !label) {
        dropped.push(`${scope}字段缺 key/label 或 key 非法：${JSON.stringify(f).slice(0, 80)}`);
        continue;
      }
      if (seen.has(key)) {
        dropped.push(`${scope}字段 key 重复：${key}`);
        continue;
      }
      seen.add(key);
      const options =
        type === 'select'
          ? [...new Set((Array.isArray(f?.options) ? f.options : []).map((o) => str(o, 20)).filter(Boolean))]
          : undefined;
      if (type === 'select' && (!options || options.length < 2)) {
        dropped.push(`select 字段「${label}」选项不足 2 个`);
        continue;
      }
      out.push({
        key,
        label,
        type,
        ...(options ? { options } : {}),
        ...(str(f?.unit, 10) ? { unit: str(f.unit, 10) } : {}),
        required: f?.required === true,
        affectsStock: f?.affectsStock !== false, // 只有明确 false 才不产生库存规格
      });
    }
    return out;
  };
  return {
    fields: clean(parsed?.fields, '商品', 6),
    specs: clean(parsed?.specs, '规格', 3),
    dropped,
  };
};

// ---------- 环节2/3：商品生成 & 粘贴导入 ----------
// 保证：名字非空且不重复、price 是合法数字、specValues 的值必须在品类 options 内、
//       **强制剥离 costPrice（仅"生成"环节——铁律：AI 不许编成本；导入环节保留用户真实数据）**
const sanitizeProducts = (parsed, { specDefs = [], allowCost = false, maxCount = 30 } = {}) => {
  const dropped = [];
  const seenNames = new Set();
  const optionsByKey = Object.fromEntries(
    specDefs.filter((d) => Array.isArray(d.options) && d.options.length).map((d) => [d.key, new Set(d.options)])
  );
  const out = [];
  for (const p of Array.isArray(parsed?.products) ? parsed.products : []) {
    if (out.length >= maxCount) break;
    const name = str(p?.name, 40);
    if (!name) {
      dropped.push(`商品缺名称：${JSON.stringify(p).slice(0, 60)}`);
      continue;
    }
    if (seenNames.has(name)) {
      dropped.push(`商品重复：${name}`);
      continue;
    }
    const skus = [];
    for (const s of Array.isArray(p?.skus) ? p.skus : [{}]) {
      const price = num(s?.price);
      if (price == null || price < 0 || price > 1000000) {
        dropped.push(`「${name}」某规格价格非法（${s?.price}）`);
        continue;
      }
      // specValues 只保留品类里定义过的 key，且 select 值必须在 options 内——AI 编的维度/值一律不进库
      const spec = {};
      let specBad = false;
      for (const [k, v] of Object.entries(s?.specValues ?? {})) {
        const sv = str(v, 30);
        if (!specDefs.some((d) => d.key === k)) continue; // 编造的维度直接忽略
        if (optionsByKey[k] && !optionsByKey[k].has(sv)) {
          dropped.push(`「${name}」规格值不在选项内：${k}=${sv}`);
          specBad = true;
          break;
        }
        spec[k] = sv;
      }
      if (specBad) continue;
      const initQuantity = Math.max(0, num(s?.initQuantity) ?? 0);
      const costPrice = allowCost ? num(s?.costPrice) : null;
      skus.push({
        specValues: spec,
        price,
        ...(costPrice != null && costPrice >= 0 ? { costPrice } : {}), // 生成环节 allowCost=false → 永远剥离
        ...(str(s?.barcode, 40) ? { barcode: str(s.barcode, 40) } : {}),
        initQuantity,
      });
    }
    if (skus.length === 0) {
      dropped.push(`「${name}」没有一个合法规格，整条忽略`);
      continue;
    }
    seenNames.add(name);
    out.push({
      name,
      unit: str(p?.unit, 10) || '件',
      customFields: typeof p?.customFields === 'object' && p.customFields ? p.customFields : {},
      skus,
    });
  }
  return { products: out, dropped };
};

// ---------- 环节4：问生意 ----------
// 保证：answer 是字符串且有长度上限；空回答给诚实占位
const sanitizeAnswer = (parsed) => {
  const a = typeof parsed?.answer === 'string' ? parsed.answer.trim() : '';
  if (!a) return '（AI 没有给出有效回答，换个问法试试）';
  return a.length > 600 ? `${a.slice(0, 600)}…` : a;
};

// ---------- 环节5：口述记账 ----------
// ID 防幻觉校验在 aiParse 里已有（matchedProductId/customerId 必须真实存在）。
// 这里补数字与结构：数量/金额 coerce，非法条目丢弃；开销类目收敛到枚举。
const sanitizeParseEntry = (parsed) => {
  const dropped = [];
  const cleanQty = (v) => {
    const n = num(v);
    return n != null && n > 0 && n <= 100000 ? Math.round(n * 1000) / 1000 : null;
  };
  const cleanMoney = (v) => {
    const n = num(v);
    return n != null && n >= 0 && n <= 10000000 ? Math.round(n * 100) / 100 : null;
  };

  const purchases = [];
  for (const it of Array.isArray(parsed?.purchases) ? parsed.purchases : []) {
    const name = str(it?.name, 40);
    const quantity = cleanQty(it?.quantity);
    if (!name || quantity == null) {
      dropped.push(`进货条目不完整已忽略：${JSON.stringify(it).slice(0, 60)}`);
      continue;
    }
    purchases.push({
      // 白名单：只放行流程真正用到的字段。用 ...it 展开的话，
      // AI 多塞的任何键都会原样透传到前端确认卡，等于把未经校验的内容带进业务流
      name,
      quantity,
      unit: str(it?.unit, 10) || '件',
      totalCost: cleanMoney(it?.totalCost),
      unitCost: cleanMoney(it?.unitCost),
      matchedProductId: Number.isInteger(it?.matchedProductId) ? it.matchedProductId : null,
      suggestedTypeId: Number.isInteger(it?.suggestedTypeId) ? it.suggestedTypeId : null,
    });
  }

  const sales = [];
  for (const it of Array.isArray(parsed?.sales) ? parsed.sales : []) {
    const name = str(it?.name, 40);
    const quantity = cleanQty(it?.quantity);
    if (!name || quantity == null) {
      dropped.push(`卖出条目不完整已忽略：${JSON.stringify(it).slice(0, 60)}`);
      continue;
    }
    sales.push({
      // 同上：白名单，不透传 AI 自己加的键
      name,
      quantity,
      unit: str(it?.unit, 10) || '件',
      totalAmount: cleanMoney(it?.totalAmount),
      unitPrice: cleanMoney(it?.unitPrice),
      matchedProductId: Number.isInteger(it?.matchedProductId) ? it.matchedProductId : null,
      customerId: Number.isInteger(it?.customerId) ? it.customerId : null,
      paid: typeof it?.paid === 'boolean' ? it.paid : null,
    });
  }

  const expenses = [];
  for (const it of Array.isArray(parsed?.expenses) ? parsed.expenses : []) {
    const amount = cleanMoney(it?.amount);
    if (amount == null || amount <= 0) {
      dropped.push(`开销金额非法已忽略：${JSON.stringify(it).slice(0, 60)}`);
      continue;
    }
    const category = EXPENSE_CATEGORIES.has(it?.category) ? it.category : '其他';
    expenses.push({ category, amount, note: str(it?.note, 60) || null });
  }

  const aggregates = [];
  for (const it of Array.isArray(parsed?.aggregates) ? parsed.aggregates : []) {
    const amount = cleanMoney(it?.amount);
    if (amount == null || amount <= 0) {
      dropped.push(`汇总金额非法已忽略：${JSON.stringify(it).slice(0, 60)}`);
      continue;
    }
    aggregates.push({ label: str(it?.label, 30) || '营业额', amount, note: str(it?.note, 60) || null });
  }

  const warnings = (Array.isArray(parsed?.warnings) ? parsed.warnings : [])
    .map((w) => str(w, 120))
    .filter(Boolean);

  return {
    purchases,
    sales,
    expenses,
    aggregates,
    warnings,
    dropped,
    deliveryNote: str(parsed?.deliveryNote, 120) || null,
    supplierName: str(parsed?.supplierName, 40) || null,
  };
};

module.exports = { sanitizeFields, sanitizeProducts, sanitizeAnswer, sanitizeParseEntry };
