// Official PNVS Dypnsapi 2017-05-25 SDK. Never use Dysmsapi SendSms.
const SDK = require('@alicloud/dypnsapi20170525');
const { Config } = require('@alicloud/openapi-core');
const { RuntimeOptions } = require('@darabonba/typescript');
const { checkConfig } = require('./config');
const { httpError } = require('../../utils/biz');
const SCHEMES = Object.freeze({ login: 'stockmate-login', bind: 'stockmate-bind', reset: 'stockmate-reset' });
const unavailable = () => httpError(503, '短信服务暂不可用，请稍后重试或使用原登录方式');
function createProvider({ env = process.env, client } = {}) {
  function getClient() {
    if (!checkConfig(env).enabled) throw unavailable();
    return client ||= new SDK.default(new Config({
      accessKeyId: env.PNVS_ACCESS_KEY_ID, accessKeySecret: env.PNVS_ACCESS_KEY_SECRET,
      endpoint: 'dypnsapi.aliyuncs.com', regionId: 'cn-hangzhou',
    }));
  }
  async function call(method, request) {
    try {
      const runtime = new RuntimeOptions({ autoretry: false, maxAttempts: 1, connectTimeout: 3000, readTimeout: 5000 });
      const response = await getClient()[method](request, runtime);
      const body = response?.body;
      if (body?.success !== true || body?.code !== 'OK') throw unavailable();
      return body.model;
    } catch { throw unavailable(); } // Never forward/log provider errors or request payloads.
  }
  return {
    enabled: () => checkConfig(env).enabled,
    send: ({ phone, purpose, id }) => {
      if (!SCHEMES[purpose]) return Promise.reject(unavailable());
      return call('sendSmsVerifyCodeWithOptions', new SDK.SendSmsVerifyCodeRequest({
        countryCode: '86', phoneNumber: phone, schemeName: SCHEMES[purpose], outId: id,
        signName: env.PNVS_SIGN_NAME, templateCode: env[`PNVS_TEMPLATE_CODE_${purpose.toUpperCase()}`],
        templateParam: JSON.stringify({ code: '##code##', min: '5' }), codeType: 1,
        codeLength: 6, validTime: 300, interval: 60, duplicatePolicy: 1, returnVerifyCode: false,
      })).then(() => undefined);
    },
    check: async ({ phone, purpose, code }) => {
      if (!SCHEMES[purpose]) throw unavailable();
      const model = await call('checkSmsVerifyCodeWithOptions', new SDK.CheckSmsVerifyCodeRequest({
        countryCode: '86', phoneNumber: phone, schemeName: SCHEMES[purpose], verifyCode: code,
      }));
      return model?.verifyResult === 'PASS';
    },
  };
}
module.exports = { createProvider, SCHEMES };
