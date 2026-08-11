// 审核演示账号种子数据：把 demo 店铺填成一家像样的烟酒批发部。
// 空账号会让审核员看不出这个 App 在干什么（App Store 2.1 拒审风险）。
// 跑法：env -u NODE_OPTIONS BASE=https://qxju.shop/mate-api/api/v1 node scripts/seed-demo.js
// 只写 review 账号自己的店（注册即建店，租户隔离），不会碰到别人的数据。
const B = process.env.BASE || 'https://qxju.shop/mate-api/api/v1';
const USER = process.env.DEMO_USER || 'review';
const PASS = process.env.DEMO_PASS || 'ReviewDemo2026';
let TOK = '';
const api = async (path, body, { method } = {}) => {
  const r = await fetch(`${B}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};
const okd = (r, what) => (r.code === 200 || r.code === 201) ? r.data : (() => { throw new Error(`${what} 失败: ${JSON.stringify(r).slice(0, 200)}`); })();
const pick = (arr, i) => arr[i % arr.length];

(async () => {
  TOK = okd(await api('/auth/login', { username: USER, password: PASS }), '登录').token;
  console.log('✓ 登录 demo 账号');

  // ---- 品类：复用已有，缺的补上 ----
  const types = okd(await api('/product-types'), '品类');
  const typeByName = Object.fromEntries(types.map((t) => [t.name, t]));
  const ensureType = async (name, icon, fields) => {
    if (typeByName[name]) return typeByName[name];
    const t = okd(await api('/product-types', { name, icon, fields }), `建品类${name}`);
    typeByName[name] = t;
    return t;
  };
  const tWine = typeByName['酒水'] ?? (await ensureType('酒水', '🍾', [
    { key: 'brand', label: '品牌', type: 'text', scope: 'product', required: false },
    { key: 'spec', label: '规格', type: 'select', options: ['整箱', '单瓶'], scope: 'sku', required: true, affectsStock: true },
  ]));
  const tDrink = await ensureType('饮料', '🥤', [
    { key: 'brand', label: '品牌', type: 'text', scope: 'product', required: false },
    { key: 'spec', label: '规格', type: 'select', options: ['整箱', '单瓶'], scope: 'sku', required: true, affectsStock: true },
  ]);
  const tSnack = await ensureType('零食', '🍿', [
    { key: 'spec', label: '规格', type: 'select', options: ['整箱', '单包'], scope: 'sku', required: true, affectsStock: true },
  ]);
  console.log(`✓ 品类 ${Object.keys(typeByName).length} 个`);

  // ---- 商品（带整箱/单瓶双规格，条码，成本价）----
  const existing = okd(await api('/products?page=1&pageSize=200'), '商品列表');
  const haveNames = new Set((existing.list ?? []).map((p) => p.name));
  const CATALOG = [
    [tWine, '泸州老窖 特曲', '瓶', [['整箱', 2280, 2760, 'W1001', 6], ['单瓶', 95, 128, 'W1002', 40]]],
    [tWine, '牛栏山二锅头', '瓶', [['整箱', 240, 336, 'W1003', 12], ['单瓶', 10, 14, 'W1004', 96]]],
    [tWine, '青岛啤酒 500ml', '瓶', [['整箱', 96, 132, 'W1005', 20], ['单瓶', 4, 6, 'W1006', 180]]],
    [tWine, '雪花勇闯天涯', '瓶', [['整箱', 84, 120, 'W1007', 18], ['单瓶', 3.5, 5, 'W1008', 200]]],
    [tWine, '劲酒 125ml', '瓶', [['整箱', 320, 420, 'W1009', 5], ['单瓶', 13, 18, 'W1010', 60]]],
    [tWine, '五粮春', '瓶', [['整箱', 1680, 2100, 'W1011', 3], ['单瓶', 280, 350, 'W1012', 18]]],
    [tWine, '江小白 100ml', '瓶', [['整箱', 288, 396, 'W1013', 4], ['单瓶', 12, 16.5, 'W1014', 48]]],
    [tDrink, '农夫山泉 550ml', '瓶', [['整箱', 26, 36, 'D2001', 30], ['单瓶', 1.1, 2, 'D2002', 360]]],
    [tDrink, '可口可乐 330ml', '瓶', [['整箱', 48, 72, 'D2003', 22], ['单瓶', 2, 3, 'D2004', 264]]],
    [tDrink, '红牛 250ml', '瓶', [['整箱', 138, 180, 'D2005', 10], ['单瓶', 5.8, 7.5, 'D2006', 120]]],
    [tDrink, '康师傅冰红茶', '瓶', [['整箱', 42, 60, 'D2007', 16], ['单瓶', 2.8, 4, 'D2008', 192]]],
    [tDrink, '维他柠檬茶', '瓶', [['整箱', 55, 78, 'D2009', 8], ['单瓶', 3.7, 5.5, 'D2010', 96]]],
    [tSnack, '洽洽瓜子 108g', '包', [['整箱', 130, 180, 'S3001', 6], ['单包', 5.5, 7.5, 'S3002', 120]]],
    [tSnack, '乐事薯片 70g', '包', [['整箱', 96, 132, 'S3003', 8], ['单包', 4.2, 6, 'S3004', 144]]],
    [tSnack, '旺旺雪饼', '包', [['整箱', 108, 150, 'S3005', 5], ['单包', 4.8, 6.5, 'S3006', 90]]],
    [tSnack, '盐津铺子鱼豆腐', '包', [['整箱', 168, 228, 'S3007', 4], ['单包', 7, 9.5, 'S3008', 72]]],
    [tSnack, '好丽友派', '盒', [['整箱', 186, 252, 'S3009', 3], ['单包', 15.5, 21, 'S3010', 36]]],
    [tSnack, '德芙巧克力', '盒', [['整箱', 216, 288, 'S3011', 3], ['单包', 9, 12, 'S3012', 36]]],
  ];
  // 品类可能带 AI 生成的必填字段（品牌/香型…）——按定义自适应填，select 取第一个选项
  const fillRequired = (type, scope, presets = {}) => {
    const out = { ...presets };
    for (const f of (type.fields ?? []).filter((f) => f.scope === scope && f.required)) {
      if (out[f.key] != null) continue;
      out[f.key] = f.options?.length ? f.options[0] : (f.type === 'number' ? 1 : '常规');
    }
    return out;
  };
  const products = [];
  for (const [type, name, unit, skus] of CATALOG) {
    if (haveNames.has(name)) continue;
    const brandGuess = name.split(/[ \d]/)[0];
    const r = await api('/products', {
      productTypeId: type.id, name, unit,
      customFields: fillRequired(type, 'product', { brand: brandGuess, 品牌: brandGuess }),
      skus: skus.map(([spec, cost, price, barcode, qty]) => ({
        // 只塞品类真实定义过的规格键；品类若没有 spec 键（比如 AI 生成的酒水用的是
        // volume/packaging），硬塞会渲染成"整箱 · 250ml · 单瓶"这种自相矛盾的规格串
        specValues: fillRequired(type, 'sku',
            ((type.fields ?? []).some((f) => f.key === 'spec') ? { spec } : {})),
        costPrice: cost, price, barcode, initQuantity: qty,
      })),
    });
    if (r.code === 200 || r.code === 201) products.push(r.data);
    else console.log(`  ! ${name}: ${r.message ?? JSON.stringify(r).slice(0, 80)}`);
  }
  const allProducts = okd(await api('/products?page=1&pageSize=200'), '商品复查').list ?? [];
  console.log(`✓ 商品共 ${allProducts.length} 个`);

  // ---- 供应商 ----
  const sups = okd(await api('/suppliers'), '供应商');
  const supNames = new Set((sups.list ?? sups).map((s) => s.name));
  for (const [name, phone] of [['川酒批发部', '13908001001'], ['青岛啤酒经销处', '13908001002'], ['统一饮料华东仓', '13908001003'], ['洽洽零食总代', '13908001004'], ['本地日用批发', '13908001005']]) {
    if (!supNames.has(name)) await api('/suppliers', { name, phone });
  }
  const allSups = okd(await api('/suppliers'), '供应商复查');
  const supList = allSups.list ?? allSups;
  console.log(`✓ 供应商 ${supList.length} 家`);

  // ---- 客户（含重复清理）----
  const custs0 = okd(await api('/customers'), '客户');
  const cl0 = custs0.list ?? custs0;
  const seen = new Set();
  for (const c of cl0) {
    if (seen.has(c.name) && (c.owed ?? 0) === 0) {
      await api(`/customers/${c.id}`, null, { method: 'DELETE' }); // 去重复（保留有欠款的那个）
      console.log(`  · 清理重复客户 ${c.name}#${c.id}`);
    }
    seen.add(c.name);
  }
  const CUSTOMERS = [
    ['老王饭店', '13700002001'], ['川味小馆', '13700002002'], ['社区便利店', '13700002003'],
    ['夜宵大排档', '13700002004'], ['金鼎酒楼', '13700002005'], ['楼下小卖部', '13700002006'],
    ['东街烧烤店', '13700002007'], ['家乐超市', '13700002008'], ['老李杂货', '13700002009'],
  ];
  for (const [name, phone] of CUSTOMERS) {
    if (!seen.has(name)) { await api('/customers', { name, phone }); seen.add(name); }
  }
  const allCusts = (okd(await api('/customers'), '客户复查').list ?? []);
  console.log(`✓ 客户 ${allCusts.length} 家`);

  // ---- 进货单（含 1 张未付清，供应商欠款有得看）----
  const poCount = okd(await api('/purchase-orders?page=1&pageSize=1'), '进货单').total ?? 0;
  if (poCount < 4) {
    for (let i = 0; i < 5; i++) {
      const sup = pick(supList, i);
      const picks = allProducts.slice(i * 3, i * 3 + 3).filter(Boolean);
      if (!picks.length) continue;
      const items = picks.map((p) => {
        const sku = p.skus.find((s) => (s.specText || '').includes('整箱')) ?? p.skus[0];
        return { skuId: sku.id, quantity: 2 + (i % 3), unitPrice: sku.costPrice ?? 10 };
      });
      const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
      await api('/purchase-orders', {
        supplierId: sup.id,
        settlementAccount: i === 4 ? '挂账' : '微信',
        paidAmount: i === 4 ? 0 : Math.round(total * 100) / 100, // 最后一张全欠着
        items,
      });
    }
    console.log('✓ 进货单 5 张（1 张未付清）');
  } else console.log(`· 进货单已有 ${poCount} 张，跳过`);

  // ---- 销售单（现金/微信/挂账混合；含专属价与退货）----
  const ordCount = okd(await api('/orders?page=1&pageSize=1'), '订单').total ?? 0;
  if (ordCount < 10) {
    // 给两个老客户设专属价（体现"熟客有谈好的价"）
    const vip = allCusts.slice(0, 2);
    for (const [i, c] of vip.entries()) {
      const p = allProducts[i];
      const sku = p?.skus?.find((s) => (s.specText || '').includes('单瓶')) ?? p?.skus?.[0];
      if (sku) await api('/pricing', { customerId: c.id, skuId: sku.id, price: Math.round((sku.price ?? 10) * 0.92 * 100) / 100 });
    }
    const ACCOUNTS = ['现金', '微信', '支付宝', '现金', '微信'];
    const created = [];
    for (let i = 0; i < 16; i++) {
      const cust = i % 4 === 0 ? null : pick(allCusts, i); // 每 4 单有 1 单散客
      const p1 = pick(allProducts, i * 2), p2 = pick(allProducts, i * 2 + 1);
      const items = [p1, p2].filter(Boolean).map((p, k) => {
        const sku = pick(p.skus, i + k);
        return { skuId: sku.id, quantity: 1 + ((i + k) % 4), unitPrice: sku.price ?? 10 };
      });
      const total = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
      const credit = cust && i % 5 === 0; // 记名客户里每 5 单 1 单挂账
      const r = await api('/orders', {
        ...(cust ? { customerId: cust.id } : {}),
        settlementAccount: credit ? '挂账' : pick(ACCOUNTS, i),
        paidAmount: credit ? 0 : Math.round(total * 100) / 100,
        items,
      });
      if (r.code === 200 || r.code === 201) created.push(r.data);
    }
    console.log(`✓ 销售单 ${created.length} 张`);
    // 一张部分收款 + 一张退货（对账单才有看头）
    const creditOrders = created.filter((o) => o.actualAmount - o.paidAmount > 1);
    if (creditOrders[0]) {
      const o = creditOrders[0];
      await api(`/orders/${o.id}/receive-payment`, { amount: Math.round((o.actualAmount - o.paidAmount) / 2 * 100) / 100, settlementAccount: '微信' });
      console.log('  · 1 张挂账单已收一半');
    }
    const paidOrder = created.find((o) => o.actualAmount - o.paidAmount < 0.01 && o.items?.length);
    if (paidOrder) {
      const detail = okd(await api(`/orders/${paidOrder.id}`), '订单详情');
      const it = detail.items?.[0];
      if (it) {
        const r = await api(`/orders/${paidOrder.id}/return`, { items: [{ itemId: it.id, quantity: 1 }], account: '现金' });
        if (r.code === 200) console.log('  · 1 张单退了 1 件（对账单有冲减行）');
      }
    }
  } else console.log(`· 订单已有 ${ordCount} 张，跳过`);

  // ---- 开销 + 报损（利润表的成本侧才不空）----
  // 幂等：重跑不重复记开销（否则毛利被翻倍的房租/工资吃成负数，demo 观感极差）
  const expListRaw = okd(await api('/expenses'), '开销');
  const expHave = new Set(((expListRaw.list ?? expListRaw) || []).map((e) => `${e.category}|${e.amount}`));
  for (const [category, amount, note] of [['摊位费', 800, '本月门面租金'], ['运输', 120, '送货油费'], ['水电', 260, '本月水电'], ['人工', 1500, '帮工工资']]) {
    if (expHave.has(`${category}|${amount}`)) continue;
    await api('/expenses', { category, amount, note });
  }
  const lossP = allProducts.find((p) => p.name.includes('啤酒'));
  const lossSku = lossP?.skus?.find((s) => (s.specText || '').includes('单瓶'));
  if (lossSku && !expHave.size) await api('/inventory/outbound', { skuId: lossSku.id, quantity: 3, reason: '报损' }); // 首次种子才报损
  console.log('✓ 开销 4 笔 + 报损 1 笔');

  // ---- 汇总 ----
  const ordersMeta = okd(await api('/orders?page=1&pageSize=200'), 'x');
  const poMeta = okd(await api('/purchase-orders?page=1&pageSize=200'), 'x');
  const sum = {
    品类: (okd(await api('/product-types'), 'x')).length,
    商品: (okd(await api('/products?page=1&pageSize=200'), 'x').list ?? []).length,
    客户: (okd(await api('/customers'), 'x').list ?? []).length,
    供应商: ((okd(await api('/suppliers'), 'x').list) ?? okd(await api('/suppliers'), 'x')).length,
    订单: (() => { const d = ordersMeta; return d.total ?? d.pagination?.total ?? (d.list ?? []).length; })(),
    进货单: (() => { const d = poMeta; return d.total ?? d.pagination?.total ?? (d.list ?? []).length; })(),
  };
  console.log('\n===== demo 店铺现状 =====');
  console.log(sum);
})().catch((e) => { console.error('种子失败:', e.message); process.exit(1); });
