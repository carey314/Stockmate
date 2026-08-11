// 第三轮勾稽审计：时区边界 / 跨月对账 / 并发开单 / 分页边界。
// 这三类是"前两轮都对、上线后才炸"的类型：
//   时区——早市 6 点的单算到昨天；跨月——上月欠款不结转；并发——同时开两单库存丢更新。
// 跑法（隔离库 3195）：
//   rm -f /tmp/bizloop3.db* && env -u NODE_OPTIONS DATABASE_URL="file:/tmp/bizloop3.db" npx prisma db push --skip-generate
//   env -u NODE_OPTIONS DATABASE_URL="file:/tmp/bizloop3.db" PORT=3195 node src/app.js &
//   env -u NODE_OPTIONS node scripts/biz-loop-audit3.js
const { execSync } = require('child_process');
const B = 'http://localhost:3195/api/v1';
const DB = '/tmp/bizloop3.db';
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
// 本地时区日期键（和后端 biz.localDayKey 同口径，独立实现——不能用系统验系统）
const localKey = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const sql = (q) => execSync(`sqlite3 "${DB}" "${q.replace(/"/g, '\\"')}"`).toString().trim();

(async () => {
  console.log('\n【开店】');
  TOK = okd(await api('/auth/register', { username: 'boss3', password: 'audit123', realName: '三轮审计店' })).token;
  const type = okd(await api('/product-types', { name: '馄饨', icon: '🥟', fields: [] }));
  const p1 = okd(await api('/products', { productTypeId: type.id, name: '虾仁馄饨', unit: '袋', skus: [{ specValues: {}, price: 25, costPrice: 18, initQuantity: 500 }] }));
  const sku1 = p1.skus[0].id;
  const cust = okd(await api('/customers', { name: '老王饭店' }));
  chk('开店完成', sku1 && cust.id);

  // ========== 时区边界（王姐早市 6 点开张）==========
  console.log('\n【时区边界】');
  const now = new Date();
  const todayLocal = localKey(now);
  const todayUtc = now.toISOString().slice(0, 10);
  console.log(`  [环境] 当前本地日期=${todayLocal} UTC日期=${todayUtc}${todayLocal !== todayUtc ? ' ← 正处在时区差窗口，这轮能真实复现 bug' : ''}`);
  const o1 = okd(await api('/orders', { paidAmount: 250, items: [{ skuId: sku1, quantity: 10, unitPrice: 25 }] }));
  const RANGE_TODAY = `startDate=${todayLocal}&endDate=${todayLocal}`;
  const prof = okd(await api(`/reports/profit?${RANGE_TODAY}`));
  chk('今天的单算进"今天"的利润（区间口径）', Math.abs(prof.sales - 250) < 0.01, `sales=${prof.sales}`);
  const todayRow = (prof.byDay ?? []).find((d) => d.date === todayLocal);
  chk('按日走势的日期键=本地日期（早市 6 点不算昨天）', !!todayRow && Math.abs(todayRow.sales - 250) < 0.01,
    `byDay=${JSON.stringify(prof.byDay)}`);
  const ov = okd(await api('/stats/overview'));
  chk('首页今日销售额=250（同口径）', Math.abs((ov.todaySales ?? 0) - 250) < 0.01, `todaySales=${ov.todaySales}`);
  const trend = await api('/stats/sales?days=7');
  if (trend.code === 200) {
    const rows = trend.data.list ?? trend.data ?? [];
    const hit = rows.find?.((d) => d.date === todayLocal);
    chk('7日趋势含今天且金额对', !!hit && Math.abs(hit.sales - 250) < 0.01, `trend=${JSON.stringify(rows).slice(0, 200)}`);
  } else chk('趋势接口', false, JSON.stringify(trend).slice(0, 100));

  // ========== 跨月对账（上月挂账要结转成期初）==========
  console.log('\n【跨月对账】');
  const oLast = okd(await api('/orders', { customerId: cust.id, paidAmount: 0, settlementAccount: '挂账', items: [{ skuId: sku1, quantity: 4, unitPrice: 25 }] }));
  // 把这单和它的流水挪到"上个月 15 号"（直接改库造历史，API 无法指定 createdAt）
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 10, 0, 0);
  const lmMs = lastMonth.getTime(); // Prisma 在 SQLite 存 INTEGER 毫秒，写文本会被读成废值
  sql(`UPDATE "Order" SET createdAt=${lmMs} WHERE id=${oLast.id}`);
  sql(`UPDATE "PaymentRecord" SET paidAt=${lmMs} WHERE orderId=${oLast.id}`);
  const ym = localKey(lastMonth).slice(0, 7);
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-28`;
  const stmtLast = okd(await api(`/reports/customer-statement?customerId=${cust.id}&startDate=${monthStart}&endDate=${monthEnd}`));
  chk('上月对账单：期初0 期末100', Math.abs((stmtLast.openingOwed ?? stmtLast.opening ?? -1)) < 0.01 && Math.abs((stmtLast.closingOwed ?? stmtLast.closing) - 100) < 0.01,
    `opening=${stmtLast.openingOwed ?? stmtLast.opening} closing=${stmtLast.closingOwed ?? stmtLast.closing}`);
  // 本月对账单：期初必须结转上月的 100（不结转 = 老板以为客户不欠钱了）
  const thisStart = `${todayLocal.slice(0, 7)}-01`;
  const stmtThis = okd(await api(`/reports/customer-statement?customerId=${cust.id}&startDate=${thisStart}&endDate=${todayLocal}`));
  chk('本月对账单期初结转上月欠款 100', Math.abs((stmtThis.openingOwed ?? stmtThis.opening) - 100) < 0.01,
    `opening=${stmtThis.openingOwed ?? stmtThis.opening}`);
  // 本月还了 60 → 本月期末 40
  okd(await api(`/orders/${oLast.id}/receive-payment`, { amount: 60 }));
  const stmtThis2 = okd(await api(`/reports/customer-statement?customerId=${cust.id}&startDate=${thisStart}&endDate=${todayLocal}`));
  chk('本月收款后期末=40', Math.abs((stmtThis2.closingOwed ?? stmtThis2.closing) - 40) < 0.01, `closing=${stmtThis2.closingOwed ?? stmtThis2.closing}`);
  chk('客户欠款字段同步=40', Math.abs((okd(await api('/customers')).list ?? []).find((c) => c.id === cust.id).owed - 40) < 0.01);
  // 上月对账单不能被本月的收款改写（历史必须冻结）
  const stmtLast2 = okd(await api(`/reports/customer-statement?customerId=${cust.id}&startDate=${monthStart}&endDate=${monthEnd}`));
  chk('上月对账单不被本月收款改写（期末仍100）', Math.abs((stmtLast2.closingOwed ?? stmtLast2.closing) - 100) < 0.01,
    `closing=${stmtLast2.closingOwed ?? stmtLast2.closing}`);

  // ========== 并发开单（两台手机同时卖同一个货）==========
  console.log('\n【并发开单】');
  const before = stockOf(okd(await api(`/products/${p1.id}`)).skus[0]);
  const N = 10;
  const results = await Promise.all(Array.from({ length: N }, () => api('/orders', { paidAmount: 25, items: [{ skuId: sku1, quantity: 1, unitPrice: 25 }] })));
  const okCount = results.filter((r) => r.code === 200 || r.code === 201).length;
  const after = stockOf(okd(await api(`/products/${p1.id}`)).skus[0]);
  chk(`并发 ${N} 单全部成功`, okCount === N, `成功 ${okCount}/${N}：${JSON.stringify(results.filter((r) => r.code >= 400).slice(0, 2))}`);
  chk(`并发后库存精确 = ${before} - ${okCount}（无丢失更新）`, after === before - okCount, `before=${before} after=${after} 差=${before - after}`);
  const recCount = Number(sql(`SELECT COUNT(*) FROM InventoryRecord WHERE skuId=${sku1} AND type='outbound'`));
  console.log(`  [观察] 出库流水条数=${recCount}（应 ≥ ${okCount + 1}，含前面的单）`);

  // ========== 分页边界 ==========
  console.log('\n【分页边界】');
  const total = Number(sql(`SELECT COUNT(*) FROM "Order"`));
  const pageA = okd(await api('/orders?page=1&pageSize=5'));
  const pageB = okd(await api('/orders?page=2&pageSize=5'));
  const idsA = (pageA.list ?? []).map((o) => o.id);
  const idsB = (pageB.list ?? []).map((o) => o.id);
  chk('分页 total 与库内一致', (pageA.total ?? pageA.pagination?.total) === total, `接口 total=${pageA.total ?? pageA.pagination?.total} 库内=${total}`);
  chk('第1页第2页无重复（排序稳定）', idsA.every((id) => !idsB.includes(id)), `A=${idsA} B=${idsB}`);
  const pageOver = okd(await api('/orders?page=999&pageSize=5'));
  chk('超尾页返回空数组不报错', Array.isArray(pageOver.list) && pageOver.list.length === 0);

  console.log(`\n========== ${pass} 通过 / ${fail} 失败 ==========`);
  if (issues.length) console.log('问题清单:\n' + issues.map((i, n) => `${n + 1}. ${i}`).join('\n'));
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('审计中断:', e.message); process.exit(2); });
