// 第二轮勾稽审计：上轮没扫到的路径——进货退货/订单取消/超额收款/收摊总账/软删商品/专属价回落/进货补付/损耗汇总。
// 跑法同 biz-loop-audit.js（隔离库 3196）：
//   rm -f /tmp/bizloop2.db* && env -u NODE_OPTIONS DATABASE_URL="file:/tmp/bizloop2.db" npx prisma db push --skip-generate
//   env -u NODE_OPTIONS DATABASE_URL="file:/tmp/bizloop2.db" PORT=3196 node src/app.js &
//   env -u NODE_OPTIONS node scripts/biz-loop-audit2.js
const B = 'http://localhost:3196/api/v1';
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
const RANGE = 'startDate=2026-01-01&endDate=2026-12-31';

(async () => {
  console.log('\n【开店+期初库存】');
  TOK = okd(await api('/auth/register', { username: 'boss2', password: 'audit123', realName: '二轮审计店' })).token;
  const type = okd(await api('/product-types', { name: '酒水', icon: '🍾', fields: [] }));
  const p1 = okd(await api('/products', { productTypeId: type.id, name: '泸州老窖', unit: '瓶', skus: [{ specValues: {}, price: 128, costPrice: 95, initQuantity: 10 }] }));
  const sku1 = p1.skus[0].id;
  chk('建品期初库存 10', stockOf(okd(await api(`/products/${p1.id}`)).skus[0]) === 10);
  const initRec = await api(`/inventory/records?skuId=${sku1}`);
  const initRows = initRec.data?.list ?? initRec.data ?? [];
  chk('期初库存有流水记录（审计可追溯）', initRec.code === 200 && /初始|期初/.test(JSON.stringify(initRows)), `流水: ${JSON.stringify(initRows).slice(0, 120)}`);

  console.log('\n【进货欠款→退货→补付】');
  const supplier = okd(await api('/suppliers', { name: '川货批发', phone: '13900000002' }));
  const po = okd(await api('/purchase-orders', { supplierId: supplier.id, paidAmount: 0, items: [{ skuId: sku1, quantity: 24, unitPrice: 95 }] }));
  chk('进货 24 瓶全欠（应付 2280）', po.actualAmount === 2280 && po.paidAmount === 0, `${po.actualAmount}/${po.paidAmount}`);
  const poDetail = okd(await api(`/purchase-orders/${po.id}`));
  const poRet = await api(`/purchase-orders/${po.id}/return`, { items: [{ itemId: poDetail.items[0].id, quantity: 4 }] });
  chk('进货退 4 瓶', poRet.code === 200 || poRet.code === 201, JSON.stringify(poRet).slice(0, 120));
  const poAfter = okd(await api(`/purchase-orders/${po.id}`));
  chk('退后应付 = 20×95 = 1900', poAfter.actualAmount === 1900, `实际 ${poAfter.actualAmount}`);
  chk('退后库存 = 10 + 24 - 4 = 30', stockOf(okd(await api(`/products/${p1.id}`)).skus[0]) === 30);
  const pay1 = await api(`/purchase-orders/${po.id}/pay`, { amount: 1900 });
  chk('补付 1900 结清', pay1.code === 200, JSON.stringify(pay1).slice(0, 100));
  const payOver = await api(`/purchase-orders/${po.id}/pay`, { amount: 1 });
  chk('进货单超额付款被拦', payOver.code === 400, `code=${payOver.code}`);
  const supStmt = await api(`/reports/supplier-statement?supplierId=${supplier.id}&${RANGE}`);
  chk('供应商对账单含退货冲减', supStmt.code === 200 && JSON.stringify(supStmt.data).includes('退'), JSON.stringify(supStmt.data).slice(0, 120));

  console.log('\n【挂账收款边界】');
  const cust = okd(await api('/customers', { name: '老王饭店', phone: '13900000001' }));
  const o1 = okd(await api('/orders', { customerId: cust.id, paidAmount: 0, settlementAccount: '挂账', items: [{ skuId: sku1, quantity: 5, unitPrice: 128 }] }));
  const overPay = await api(`/orders/${o1.id}/receive-payment`, { amount: 700 });
  chk('超额收款被拦（欠640收700）', overPay.code === 400, `code=${overPay.code}`);
  const exactPay = await api(`/orders/${o1.id}/receive-payment`, { amount: 640 });
  chk('足额收款结清', exactPay.code === 200);

  console.log('\n【订单取消（收了钱的单）】');
  const o2 = okd(await api('/orders', { paidAmount: 256, items: [{ skuId: sku1, quantity: 2, unitPrice: 128 }] }));
  const cancelR = await api(`/orders/${o2.id}/cancel`, {}, { method: 'PUT' });
  chk('取消已收款订单', cancelR.code === 200, JSON.stringify(cancelR).slice(0, 100));
  chk('取消后库存回退（30-5-2+2=25）', stockOf(okd(await api(`/products/${p1.id}`)).skus[0]) === 25, `实际 ${stockOf(okd(await api(`/products/${p1.id}`)).skus[0])}`);
  // 钱必须有去向：要么自动退款流水，要么现金流不再包含这笔
  const cf1 = okd(await api(`/reports/cashflow?${RANGE}`));
  const cfBlob = JSON.stringify(cf1);
  chk('取消单的已收款有退款流水（钱不悬空）', cfBlob.includes('取消订单退款') && cfBlob.includes('256'), cfBlob.slice(0, 200));
  chk('开单随收的钱进现金流（256 曾流入，NULL 账户不再被误杀）', cfBlob.includes('开单收款'), cfBlob.slice(0, 150));
  // 现金流净额勾稽：+640(收欠款) +256(开单收) -1900(付进货欠款) -256(取消退款) = -1260
  chk('现金流净额 = -1260', Math.abs(cf1.net - (-1260)) < 0.01, `实际 net=${cf1.net}`);

  // 进货单取消对称验证：新进货单付 190 → 取消 → 收回流水
  const po2 = okd(await api('/purchase-orders', { supplierId: supplier.id, paidAmount: 190, items: [{ skuId: sku1, quantity: 2, unitPrice: 95 }] }));
  const poCancel = await api(`/purchase-orders/${po2.id}/cancel`, {}, { method: 'PUT' });
  chk('取消已付款进货单', poCancel.code === 200, JSON.stringify(poCancel).slice(0, 100));
  const cf2 = okd(await api(`/reports/cashflow?${RANGE}`));
  chk('进货取消有退款收回流水（+190）', JSON.stringify(cf2).includes('取消进货单退款收回'), JSON.stringify(cf2).slice(0, 150));
  // po2 付款 -190 与取消收回 +190 相抵，净额不变（这也证明进货随单付款有流水）
  chk('现金流净额不变 = -1260（付款与收回相抵）', Math.abs(cf2.net - (-1260)) < 0.01, `实际 net=${cf2.net}`);

  console.log('\n【收摊总账落账】');
  const agg = await api('/ai/confirm-entry', { sales: [], purchases: [], expenses: [], aggregates: [{ label: '今日收摊总账', amount: 800 }] });
  chk('总账一笔落账', agg.code === 200 || agg.code === 201, JSON.stringify(agg).slice(0, 120));
  const profit = okd(await api(`/reports/profit?${RANGE}`));
  chk('利润报表销售额含总账 800（640+800=1440，不含取消单）', Math.abs(profit.sales - 1440) < 0.01, `实际 sales=${profit.sales}`);

  console.log('\n【损耗汇总（刚修的功能）】');
  okd(await api('/inventory/outbound', { skuId: sku1, quantity: 2, reason: '报损' }));
  const profit2 = okd(await api(`/reports/profit?${RANGE}`));
  chk('lossAmount = 2×95 = 190', profit2.lossAmount === 190, `实际 ${profit2.lossAmount}`);

  console.log('\n【专属价回落】');
  const pr = okd(await api('/pricing', { customerId: cust.id, skuId: sku1, price: 118 }));
  const r1 = okd(await api(`/pricing/resolve?customerId=${cust.id}&skuId=${sku1}`));
  chk('专属价生效 118', (r1.price ?? r1.suggestedPrice) === 118);
  const del = await api(`/pricing/${pr.id ?? pr.data?.id}`, null, { method: 'DELETE' });
  const r2 = okd(await api(`/pricing/resolve?customerId=${cust.id}&skuId=${sku1}`));
  const fallback = r2.price ?? r2.suggestedPrice;
  chk('删除后回落（上次价128 或标价128）', del.code === 200 && fallback === 128, `实际 ${fallback}`);

  console.log('\n【软删商品】');
  const delP = await api(`/products/${p1.id}`, null, { method: 'DELETE' });
  chk('删除商品', delP.code === 200, JSON.stringify(delP).slice(0, 100));
  const listAfter = okd(await api('/products?page=1&pageSize=50'));
  chk('商品列表不再含它', !(listAfter.list ?? []).some((x) => x.id === p1.id));
  const histOrder = okd(await api(`/orders/${o1.id}`));
  chk('历史订单仍可看且商品名还在', histOrder.items?.[0]?.productName === '泸州老窖', JSON.stringify(histOrder.items?.[0]).slice(0, 100));
  const sellDeleted = await api('/orders', { paidAmount: 128, items: [{ skuId: sku1, quantity: 1, unitPrice: 128 }] });
  chk('删掉的商品不能再开单（404）', sellDeleted.code === 404 || sellDeleted.code === 400, `code=${sellDeleted.code}`);
  const invReport = await api(`/reports/inventory`);
  chk('库存报表不再含已删商品', invReport.code === 200 && !JSON.stringify(invReport.data).includes('泸州老窖'), JSON.stringify(invReport.data).slice(0, 100));

  console.log(`\n========== ${pass} 通过 / ${fail} 失败 ==========`);
  if (issues.length) console.log('问题清单:\n' + issues.map((i, n) => `${n + 1}. ${i}`).join('\n'));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('审计中断:', e.message); process.exit(2); });
