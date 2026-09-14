const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { format } = require('node:util');
const express = require('express');
const { z } = require('zod');
const { httpError } = require('../src/utils/biz');
const { wrap } = require('../src/utils/response');

// Inject only the service boundary; exercise the real controllers, async wrapper,
// Express response and global error handler without loading Prisma or any DB.
const servicePath = require.resolve('../src/services/promotions');
const originalService = require.cache[servicePath];
let failure;
const methods = ['createBatch', 'listCodes', 'audit', 'disable', 'revoke', 'redeem'];
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true,
  exports: Object.fromEntries(methods.map(method => [method, async () => { throw failure(); }])) };
const controller = require('../src/controllers/promotions');
let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.headers['x-test-missing-platform']) req.platformAdmin = { id: 1, sessionVersion: 0 };
    req.user = { userId: 2, storeId: 3, role: 'admin', sessionVersion: 0 };
    next();
  });
  for (const method of methods) app.post(`/${method}`, wrap(controller[method]));
  app.use(require('../src/middlewares/errorHandler'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (originalService) require.cache[servicePath] = originalService;
  else delete require.cache[servicePath];
});
async function call(method, headers = {}) {
  const res = await fetch(`${base}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}',
  });
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
}

test('all promotion endpoints redact unknown errors before the real global error handler', async t => {
  const code = 'ZC-SYNTHETIC-ERROR-CANARY';
  const sealed = 'synthetic-iv.synthetic-tag.synthetic-encrypted-material';
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(format(...args)));
  for (const method of methods) {
    for (const status of [undefined, 500]) {
      failure = () => Object.assign(new Error(`${code} ${sealed}`), {
        name: code, code: sealed, status, stack: `synthetic stack ${code} ${sealed}`,
        meta: { sealedCodes: sealed },
      });
      const result = await call(method);
      assert.equal(result.status, 500);
      assert.equal(result.cache, 'no-store');
      assert.deepEqual(result.body, { code: 500, message: '服务器内部错误' });
      assert(!logs.join('\n').includes(code), 'full code must not enter logs');
      assert(!logs.join('\n').includes(sealed), 'sealed issuance material must not enter logs');
    }
  }
  assert.equal(logs.length, methods.length * 2);
  assert(logs.every(line => line === '[promotions] PROMOTION_INTERNAL_ERROR'));
});

test('expected business errors preserve status and message without error logs', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(format(...args)));
  for (const method of methods) {
    for (const status of [400, 401, 403, 404, 409, 410, 503]) {
      failure = () => httpError(status, '预期业务错误');
      const result = await call(method);
      assert.equal(result.status, status);
      assert.equal(result.cache, 'no-store');
      assert.deepEqual(result.body, { code: status, message: '预期业务错误' });
    }
  }
  const missing = await call('createBatch', { 'x-test-missing-platform': '1' });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.message, '需要平台管理员身份');
  assert.deepEqual(logs, []);
});

test('Zod errors preserve the global field-error response without error logs', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(format(...args)));
  const parsed = z.object({ count: z.number().int().min(1) }).safeParse({ count: 0 });
  failure = () => parsed.error;
  for (const method of methods) {
    const result = await call(method);
    assert.equal(result.status, 400);
    assert.equal(result.cache, 'no-store');
    assert.deepEqual(result.body, { code: 400, message: '参数错误',
      errors: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) });
  }
  assert.deepEqual(logs, []);
});
