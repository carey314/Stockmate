// 多租户隔离回归测试：注册两个店，验证数据隔离 + 跨店越权全拦 + 删号只清本店。
// 用隔离临时库跑，不碰 dev.db。用法：node scripts/tenant-isolation-test.js
// 依赖后端能连到本脚本指定的 DATABASE_URL——这里直接起一个独立 app 实例。
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const TMP_DB = path.join(__dirname, '../prisma/tenant-test.db');
const BASE = 'http://localhost:3177/api/v1';
process.env.DATABASE_URL = `file:./tenant-test.db`;
process.env.PORT = '3177';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'tenant-test-secret';
process.env.ALLOW_REGISTRATION = 'true';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } };

const req = (method, url, token, body) =>
  new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(url);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); },
    );
    r.on('error', () => resolve({ status: 0 }));
    if (data) r.write(data);
    r.end();
  });

async function main() {
  // 干净临时库：用 db push 按当前 schema 直接建表（迁移历史缺 Recipe 的 CreateTable，
  // 从零 migrate deploy 会失败——那是历史遗留，不影响生产/dev.db）
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: path.join(__dirname, '..'), env: process.env, stdio: 'ignore' });

  const app = require('../src/app'); // 启动 server（app.js 内 listen）
  await new Promise((r) => setTimeout(r, 1200));

  // 注册店 A、店 B
  const rA = await req('POST', `${BASE}/auth/register`, null, { username: 'shopA', password: 'passA123', realName: '店A' });
  const rB = await req('POST', `${BASE}/auth/register`, null, { username: 'shopB', password: 'passB123', realName: '店B' });
  ok(rA.status === 200 && rA.body.data.token, '店A注册成功');
  ok(rB.status === 200 && rB.body.data.token, '店B注册成功');
  const tA = rA.body.data.token, tB = rB.body.data.token;

  // 各自应有 3 套预设品类、0 商品
  const typesA = await req('GET', `${BASE}/product-types`, tA);
  ok(typesA.body.data.length === 3, '店A开箱有3套预设品类');
  const prodA0 = await req('GET', `${BASE}/products`, tA);
  ok(prodA0.body.data.pagination.total === 0, '店A初始0商品');

  // 店A 建商品 + 客户
  const typeId = typesA.body.data[0].id;
  const pA = await req('POST', `${BASE}/products`, tA, { name: 'A店酒', productTypeId: typeId, unit: '瓶', defaultPrice: 100, costPrice: 60, customFields: { brand: 'x' } });
  ok(pA.status === 201, '店A建商品成功');
  const skuA = pA.body.data.skus[0].id;
  const cA = await req('POST', `${BASE}/customers`, tA, { name: 'A店客户' });
  const custA = cA.body.data.id;

  // 店B 看不到店A的商品/客户
  const prodB = await req('GET', `${BASE}/products`, tB);
  ok(prodB.body.data.pagination.total === 0, '店B看不到店A商品（隔离）');
  const custB = await req('GET', `${BASE}/customers`, tB);
  ok(custB.body.data.list.length === 0, '店B看不到店A客户（隔离）');

  // 跨店越权：店B token 操作店A资源，全部应 404
  const attacks = [
    ['GET', `${BASE}/products/${pA.body.data.id}`, '读店A商品详情'],
    ['DELETE', `${BASE}/products/${pA.body.data.id}`, '删店A商品'],
    ['PUT', `${BASE}/skus/${skuA}`, '改店A SKU', { price: 0.01 }],
    ['PUT', `${BASE}/customers/${custA}`, '改店A客户', { name: 'hacked' }],
    ['DELETE', `${BASE}/customers/${custA}`, '删店A客户'],
    ['POST', `${BASE}/pricing`, '给店A SKU设专属价', { skuId: skuA, customerId: custA, price: 1 }],
  ];
  for (const [m, url, label, bd] of attacks) {
    const r = await req(m, url, tB, bd);
    ok(r.status === 404, `跨店越权被拦：${label}（得到 ${r.status}）`);
  }

  // 店A SKU 未被改动
  const pACheck = await req('GET', `${BASE}/products/${pA.body.data.id}`, tA);
  ok(pACheck.body.data.skus[0].price === 100, '店A SKU价格未被越权改动');

  // 店B 正常经营：建货→入库→开单，单号与店A独立不撞
  const typeB = (await req('GET', `${BASE}/product-types`, tB)).body.data[0].id;
  const pB = await req('POST', `${BASE}/products`, tB, { name: 'B店酒', productTypeId: typeB, unit: '瓶', defaultPrice: 200, customFields: { brand: 'y' } });
  const skuB = pB.body.data.skus[0].id;
  await req('POST', `${BASE}/inventory/adjust`, tB, { skuId: skuB, quantity: 10, reason: '初始' });
  const oA = await req('POST', `${BASE}/orders`, tA, { items: [{ skuId: skuA, quantity: 1, unitPrice: 100 }] });
  const oB = await req('POST', `${BASE}/orders`, tB, { items: [{ skuId: skuB, quantity: 1, unitPrice: 200 }] });
  ok(oA.status === 201 && oB.status === 201, '两店各自开单成功');
  ok(oA.body.data.orderNo === oB.body.data.orderNo, '两店当天单号各自从001起（每店独立编号）');

  // 报表隔离：各看各的销售额
  const ovA = await req('GET', `${BASE}/stats/overview`, tA);
  const ovB = await req('GET', `${BASE}/stats/overview`, tB);
  ok(ovA.body.data.todaySales === 100, '店A报表只含自己(100)');
  ok(ovB.body.data.todaySales === 200, '店B报表只含自己(200)');

  // 删号清店：店B删号后，店A完好
  const del = await req('POST', `${BASE}/auth/delete-account`, tB);
  ok(del.body.data.shopWiped === true, '店B删号=清店');
  const ovAAfter = await req('GET', `${BASE}/stats/overview`, tA);
  ok(ovAAfter.body.data.todaySales === 100 && ovAAfter.body.data.productCount === 1, '店A删号后完好无损');
  // 店B token 失效
  const bDead = await req('GET', `${BASE}/products`, tB);
  ok(bDead.status === 401, '店B删号后token立即失效');

  console.log(`\n租户隔离回归：${pass} 通过 / ${fail} 失败`);
  for (const f of [TMP_DB, `${TMP_DB}-journal`, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
