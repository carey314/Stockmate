// 业务闭环勾稽审计：模拟三个画像店主的真实生意周期，每步程序化断言账目勾稽。
// 覆盖：王姐(散称小数/口述挂账/收摊总账) 老徐(双规格条码/专属价/挂账对账/退货冲账) 刘哥(进价波动/报损/盘亏) 小妹(staff 403矩阵)
// 跑法：隔离库起服务后 env -u NODE_OPTIONS node scripts/biz-loop-audit.js
//   cd server && rm -f /tmp/bizloop.db* && env -u NODE_OPTIONS DATABASE_URL="file:/tmp/bizloop.db" npx prisma db push --skip-generate
//   env -u NODE_OPTIONS DATABASE_URL="file:/tmp/bizloop.db" PORT=3197 node src/app.js &
const B = 'http://localhost:3197/api/v1';
let TOK = '';
let pass = 0, fail = 0;
const issues = [];
const chk = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; issues.push(`${name} ${detail}`); console.log(`  ✗ ${name}  ${detail}`); }
};
const api = async (path, body, { method, token } = {}) => {
  const r = await fetch(`${B}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? TOK}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};
const stockOf = (sku) => sku.inventory?.quantity ?? 0;
const okd = (r) => (r.code === 200 || r.code === 201) ? r.data : (() => { throw new Error(`API失败: ${JSON.stringify(r).slice(0, 200)}`); })();

(async () => {
  // ========== 开店 ==========
  console.log('\n【开店】');
  const reg = okd(await api('/auth/register', { username: 'boss', password: 'audit123', realName: '勾稽测试店' }));
  TOK = reg.token;

  // 品类：馄饨（口味 affectsStock=false 不产生库存规格；包装 affectsStock=true）
  const wontonType = okd(await api('/product-types', {
    name: '馄饨', icon: '🥟',
    fields: [
      { key: 'flavor', label: '口味', type: 'select', options: ['辣', '不辣'], scope: 'sku', required: false, affectsStock: false },
      { key: 'pack', label: '包装', type: 'select', options: ['袋装', '散称'], scope: 'sku', required: true, affectsStock: true },
    ],
  }));
  const fruitType = okd(await api('/product-types', { name: '水果', icon: '🍎', fields: [] }));
  const wineType = okd(await api('/product-types', { name: '酒水', icon: '🍾', fields: [{ key: 'spec', label: '规格', type: 'select', options: ['整箱24瓶', '单瓶'], scope: 'sku', required: true, affectsStock: true }] }));
  chk('三品类创建', wontonType.id && fruitType.id && wineType.id);

  // 商品
  const p1 = okd(await api('/products', { productTypeId: wontonType.id, name: '虾仁馄饨', unit: '袋', skus: [{ specValues: { pack: '袋装' }, price: 25, costPrice: 18 }] }));
  const p2 = okd(await api('/products', { productTypeId: wontonType.id, name: '鲜肉馄饨', unit: '斤', skus: [{ specValues: { pack: '散称' }, price: 12, costPrice: 8 }] }));
  const p3 = okd(await api('/products', { productTypeId: fruitType.id, name: '红富士苹果', unit: '斤', skus: [{ specValues: {}, price: 6, costPrice: 5.2 }] }));
  const p4 = okd(await api('/products', { productTypeId: wineType.id, name: '泸州老窖', unit: '瓶', skus: [
    { specValues: { spec: '整箱24瓶' }, price: 2800, costPrice: 2280, barcode: 'BX001' },
    { specValues: { spec: '单瓶' }, price: 128, costPrice: 95, barcode: 'DP001' },
  ] }));
  const sku1 = p1.skus[0].id, sku2 = p2.skus[0].id, sku3 = p3.skus[0].id;
  const sku4box = p4.skus.find((s) => s.specValues?.spec === '整箱24瓶')?.id ?? p4.skus[0].id;
  const sku4btl = p4.skus.find((s) => s.specValues?.spec === '单瓶')?.id ?? p4.skus[1].id;
  chk('四商品创建（含双规格+条码+小数单位）', sku1 && sku2 && sku3 && sku4btl);

  // 客户/供应商
  const laowang = okd(await api('/customers', { name: '老王饭店', phone: '13900000001' }));
  const supplier = okd(await api('/suppliers', { name: '川货批发', phone: '13900000002' }));
  chk('客户+供应商', laowang.id && supplier.id);

  // ========== 进货（王姐小数 + 刘哥进价波动）==========
  console.log('\n【进货】');
  okd(await api('/purchase-orders', { supplierId: supplier.id, paidAmount: 0, items: [
    { skuId: sku1, quantity: 40, unitPrice: 18 },
    { skuId: sku2, quantity: 25.5, unitPrice: 8 },
    { skuId: sku4btl, quantity: 24, unitPrice: 95 },
  ] }));
  okd(await api('/purchase-orders', { supplierId: supplier.id, paidAmount: 262.6, items: [{ skuId: sku3, quantity: 50.5, unitPrice: 5.2 }] }));
  // 隔天进价降了（刘哥场景）
  okd(await api('/purchase-orders', { supplierId: supplier.id, paidAmount: 144, items: [{ skuId: sku3, quantity: 30, unitPrice: 4.8 }] }));
  let inv = okd(await api(`/products/${p3.id}`));
  chk('小数进货落库存（苹果 80.5 斤）', stockOf(inv.skus[0]) === 80.5, `实际 ${stockOf(inv.skus[0])}`);
  console.log(`  [观察] 进价 5.2→4.8 后 sku.costPrice = ${inv.skus[0].costPrice}（口径：${inv.skus[0].costPrice === 4.8 ? '最新进价' : inv.skus[0].costPrice === 5.2 ? '首次价不动' : '其他/加权'}）`);

  // ========== 专属价（老徐）==========
  console.log('\n【专属价】');
  const pricingSet = await api('/pricing', { customerId: laowang.id, skuId: sku4btl, price: 118 });
  chk('设置专属价接口', pricingSet.code === 200 || pricingSet.code === 201, JSON.stringify(pricingSet).slice(0, 120));
  const sugg = await api(`/pricing/resolve?customerId=${laowang.id}&skuId=${sku4btl}`);
  const suggPrice = sugg.data?.price ?? sugg.data?.suggestedPrice;
  chk('开单建议价自动返回专属价 118', sugg.code === 200 && suggPrice === 118, JSON.stringify(sugg).slice(0, 150));

  // ========== 卖货 ==========
  console.log('\n【卖货】');
  // 散客现金
  const o1 = okd(await api('/orders', { paidAmount: 75, items: [{ skuId: sku1, quantity: 3, unitPrice: 25 }] }));
  // 老王挂账（专属价 118）
  const o2 = okd(await api('/orders', { customerId: laowang.id, paidAmount: 0, settlementAccount: '挂账', items: [{ skuId: sku4btl, quantity: 10, unitPrice: 118 }] }));
  // 刘哥散称小数
  const o3 = okd(await api('/orders', { paidAmount: 14.1, items: [{ skuId: sku3, quantity: 2.35, unitPrice: 6 }] }));
  chk('三张单（现金/挂账/小数斤）', o1.id && o2.id && o3.id);
  chk('挂账单欠款 1180', o2.actualAmount - o2.paidAmount === 1180, `${o2.actualAmount}-${o2.paidAmount}`);

  // ========== 口述记账真调（王姐）==========
  console.log('\n【口述记账·真调 DeepSeek】');
  let voiceSaleAmt = 0, voiceCredit = 0;
  try {
    const parsed = okd(await api('/ai/parse-entry', { text: '卖了2斤鲜肉馄饨收了24块，老王饭店又拿了5瓶泸州老窖单瓶的没给钱' }));
    const cash = parsed.sales.find((s) => s.paid !== false && s.customerId == null);
    const credit = parsed.sales.find((s) => s.customerId === laowang.id);
    chk('口述解析出 2 条卖出且客户匹配老王', parsed.sales.length === 2 && !!credit, JSON.stringify(parsed.sales.map((s) => ({ n: s.name, c: s.customerId, p: s.paid }))));
    chk('挂账语义：老王那条 paid≠true', credit && credit.paid !== true);
    // 按 App 确认流落账
    const confirm = await api('/ai/confirm-entry', {
      sales: parsed.sales.map((s) => ({ ...s, skuId: s.suggestedSkuId ?? s.matchedProduct?.skus?.[0]?.id ?? undefined })),
      purchases: [], expenses: [], aggregates: [],
    });
    if (confirm.code === 200 || confirm.code === 201) {
      chk('口述确认落账', true);
      voiceSaleAmt = (cash?.totalAmount ?? cash?.quantity * (cash?.unitPrice ?? 0)) || 0;
      voiceCredit = credit ? (credit.totalAmount ?? credit.quantity * (credit.unitPrice ?? 0)) || 0 : 0;
    } else {
      chk('口述确认落账', false, JSON.stringify(confirm).slice(0, 200));
    }
  } catch (e) {
    chk('口述链路（DeepSeek 网络）', false, e.message.slice(0, 120));
  }

  // ========== 收款 + 退货冲账（老徐月底）==========
  console.log('\n【收款+退货】');
  const payR = await api(`/orders/${o2.id}/receive-payment`, { amount: 1000, account: '现金' });
  chk('部分收款 1000', payR.code === 200, JSON.stringify(payR).slice(0, 120));
  const retR = await api(`/orders/${o2.id}/return`, { items: [{ itemId: okd(await api(`/orders/${o2.id}`)).items[0].id, quantity: 2 }] });
  chk('退货 2 瓶', retR.code === 200 || retR.code === 201, JSON.stringify(retR).slice(0, 150));
  // 收1000后退236：挂账余额180冲到0，多出的56必须算成应退现金（钱一分不能消失）
  chk('退货算出应退现金 56', retR.data?.refundCash === 56, `refundCash=${retR.data?.refundCash}`);
  // 退超量必须拦
  const retOver = await api(`/orders/${o2.id}/return`, { items: [{ itemId: okd(await api(`/orders/${o2.id}`)).items[0].id, quantity: 99 }] });
  chk('退货超量被拦（400）', retOver.code === 400, `code=${retOver.code}`);

  // ========== 报损 + 盘点（刘哥）==========
  console.log('\n【报损+盘点】');
  const lossR = await api('/inventory/outbound', { skuId: sku3, quantity: 3, reason: '报损' });
  chk('报损 3 斤', lossR.code === 200 || lossR.code === 201, JSON.stringify(lossR).slice(0, 120));
  const p2now = stockOf(okd(await api(`/products/${p2.id}`)).skus[0]);
  const stR = await api('/stocktakes', { items: [{ skuId: sku2, actualQty: Math.round((p2now - 1.5) * 1000) / 1000 }] });
  chk('盘点（盘亏1.5斤）', stR.code === 200 || stR.code === 201, JSON.stringify(stR).slice(0, 150));

  // ========== 员工 403 矩阵（小妹）==========
  console.log('\n【员工权限矩阵】');
  const staffMk = okd(await api('/system/users', { username: 'xiaomei', password: 'staff123', realName: '小妹' }));
  const staffLogin = okd(await api('/auth/login', { username: 'xiaomei', password: 'staff123' }));
  const st = staffLogin.token;
  chk('staff 创建+登录', !!st && staffMk);
  const bossOnly = ['/reports/profit?start=2026-08-01&end=2026-08-31', '/reports/cashflow?startDate=2026-08-01&endDate=2026-08-31', '/export/all', '/system/users'];
  for (const path of bossOnly) {
    const r = await api(path, null, { token: st });
    chk(`staff 打 ${path.split('?')[0]} → 403`, r.code === 403, `code=${r.code}`);
  }
  const staffAsk = await api('/ai/ask', { question: '谁欠钱' }, { token: st });
  chk('staff 问生意 → 403', staffAsk.code === 403, `code=${staffAsk.code}`);
  const staffOrder = await api('/orders', { paidAmount: 25, items: [{ skuId: sku1, quantity: 1, unitPrice: 25 }] }, { token: st });
  chk('staff 正常开单可用', staffOrder.code === 200 || staffOrder.code === 201, JSON.stringify(staffOrder).slice(0, 100));

  // ========== 总勾稽 ==========
  console.log('\n【总勾稽】');
  // 库存勾稽（从流水重算 vs 接口现值）
  const expect1 = 40 - 3 - 1; // 虾仁: 进40 卖3 员工卖1（口述若卖出虾仁另计——口述卖的是鲜肉）
  const s1 = stockOf(okd(await api(`/products/${p1.id}`)).skus[0]);
  chk(`虾仁馄饨库存 = ${expect1}`, s1 === expect1, `实际 ${s1}`);
  const s3 = stockOf(okd(await api(`/products/${p3.id}`)).skus[0]);
  chk('苹果库存 = 80.5 - 2.35 - 3(报损) = 75.15', Math.abs(s3 - 75.15) < 0.001, `实际 ${s3}`);
  const s4 = stockOf(okd(await api(`/products/${p4.id}`)).skus.find((s) => s.id === sku4btl));
  const expect4 = 24 - 10 + 2 - 5; // 进24 卖10 退2 口述卖5（必须扣单瓶，不许扣到整箱）
  chk(`泸州单瓶库存 = ${expect4}（口述规格词命中单瓶）`, s4 === expect4, `实际 ${s4}`);
  const s4box = stockOf(okd(await api(`/products/${p4.id}`)).skus.find((s) => s.id === sku4box));
  chk('整箱库存未被口述误扣（=0）', s4box === 0, `实际 ${s4box}`);

  // 欠款勾稽：owed = 1180 - 1000 - 236(退货冲账) + 口述挂账
  const custs = okd(await api('/customers'));
  const wangNow = (custs.list ?? custs).find((c) => c.id === laowang.id);
  chk('口述挂账不再是0元单（建议价自动补齐）', voiceCredit > 0, `voiceCredit=${voiceCredit}`);
  chk('口述挂账按专属价算 5×118=590（不是整箱14000）', voiceCredit === 590, `实际 ${voiceCredit}`);
  // o2: 1180 挂账 -1000 收款 -236 退货 = 冲到0+退现56 → o2 结清；老王只欠口述那单
  const expectOwed = voiceCredit;
  chk(`老王欠款勾稽 = 口述挂账 ${expectOwed}`, Math.abs(wangNow.owed - expectOwed) < 0.01, `实际 ${wangNow.owed}`);

  // 对账单：期末 = owed，且有退货冲减行
  const stmt = await api(`/reports/customer-statement?customerId=${laowang.id}&startDate=2026-08-01&endDate=2026-08-31`);
  if (stmt.code === 200) {
    const rows = stmt.data.rows ?? stmt.data.items ?? [];
    chk('对账单期末余额 = 客户欠款', Math.abs((stmt.data.closingOwed ?? stmt.data.closing ?? NaN) - wangNow.owed) < 0.01, `对账单 ${JSON.stringify(stmt.data).slice(0, 150)}`);
    chk('对账单含退货冲减行', JSON.stringify(rows).includes('退'), '未见冲减行');
  } else chk('对账单接口', false, JSON.stringify(stmt).slice(0, 120));

  // 资金流水：冲账不计入
  const cf = await api('/reports/cashflow?startDate=2026-08-01&endDate=2026-08-31');
  if (cf.code === 200) {
    const blob = JSON.stringify(cf.data);
    chk('资金流水不含"冲账"账户', !blob.includes('冲账'), '流水混入冲账');
  } else chk('资金流水接口', false, JSON.stringify(cf).slice(0, 100));

  // 报损可见性（刘哥灵魂拷问：这个月烂掉多少钱？）
  const invRecords = await api('/inventory/records?reason=报损');
  const lossVisible = invRecords.code === 200 && JSON.stringify(invRecords.data).includes('报损');
  console.log(`  [观察] 报损记录可查询: ${lossVisible ? '✓(出入库流水)' : '✗'}；报表中心是否有损耗金额汇总待人工确认`);

  // 散客赊账必须被拦（没名没姓的欠款等于消失）
  const walkInCredit = await api('/orders', { paidAmount: 12, items: [{ skuId: sku1, quantity: 2, unitPrice: 25 }] });
  chk('散客赊账被拦（400 提示先选客户）', walkInCredit.code === 400 && (walkInCredit.message ?? '').includes('客户'), JSON.stringify(walkInCredit).slice(0, 120));
  // 负库存开单（新店主第一天）——全款
  const negOrder = await api('/orders', { paidAmount: 999 * 12, items: [{ skuId: sku2, quantity: 999, unitPrice: 12 }] });
  chk('负库存开单默认放行（含提示）', negOrder.code === 200 || negOrder.code === 201, JSON.stringify(negOrder).slice(0, 120));

  console.log(`\n========== ${pass} 通过 / ${fail} 失败 ==========`);
  if (issues.length) console.log('问题清单:\n' + issues.map((i, n) => `${n + 1}. ${i}`).join('\n'));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('审计中断:', e.message); process.exit(2); });
