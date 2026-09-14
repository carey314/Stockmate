const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('PNVS adapter uses platform generated codes and checks only PASS', async () => {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '../src/services/sms/provider.js')), 'PNVS adapter is required');
  const { createProvider } = require('../src/services/sms/provider');
  const calls = [];
  let verdict = 'UNKNOWN';
  const sdk = {
    async sendSmsVerifyCodeWithOptions(req, runtime) { calls.push({ req, runtime }); return { body: { code: 'OK', success: true, model: { bizId: 'synthetic' } } }; },
    async checkSmsVerifyCodeWithOptions(req) { calls.push({ req }); return { body: { code: 'OK', success: true, model: { verifyResult: verdict } } }; },
  };
  const env = { PNVS_ACCESS_KEY_ID: 'synthetic', PNVS_ACCESS_KEY_SECRET: 'synthetic', PNVS_SIGN_NAME: 'synthetic', PNVS_TEMPLATE_CODE_LOGIN: 'synthetic-login', PNVS_TEMPLATE_CODE_RESET: 'synthetic-reset', PNVS_TEMPLATE_CODE_BIND: 'synthetic-bind' };
  const p = createProvider({ env, client: sdk });
  await p.send({ phone: '13800000000', purpose: 'login', id: 'request' });
  assert.equal(calls[0].req.templateParam, '{"code":"##code##","min":"5"}');
  for (const [key, value] of Object.entries({ codeLength: 6, codeType: 1, validTime: 300, interval: 60, duplicatePolicy: 1, returnVerifyCode: false, countryCode: '86' })) assert.equal(calls[0].req[key], value);
  assert.equal(calls[0].runtime.autoretry, false);
  assert.equal(calls[0].req.templateCode, 'synthetic-login');
  assert.equal(await p.check({ phone: '13800000000', purpose: 'login', code: '123456' }), false);
  verdict = 'PASS'; assert.equal(await p.check({ phone: '13800000000', purpose: 'login', code: '123456' }), true);
  assert.equal(calls[0].req.schemeName, calls[1].req.schemeName);
  sdk.checkSmsVerifyCodeWithOptions = async () => ({ body: { code: 'OK', success: false, model: { verifyResult: 'PASS' } } });
  await assert.rejects(p.check({ phone: '13800000000', purpose: 'login', code: '123456' }), { status: 503 });
  sdk.sendSmsVerifyCodeWithOptions = async () => { throw new Error('secret code phone provider error'); };
  await assert.rejects(p.send({ phone: '13800000000', purpose: 'login', id: 'request' }), e => e.status === 503 && !e.message.includes('secret'));
  await assert.rejects(createProvider({ env: {} }).send({}), { status: 503 });
});
