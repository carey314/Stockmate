const fs = require('node:fs');
const path = require('node:path');
const { SignedDataVerifier, Environment, VerificationStatus } = require('@apple/app-store-server-library');
const { httpError } = require('./biz');
const appleRoots = [fs.readFileSync(path.join(__dirname, '../../certs/AppleRootCA-G3.cer'))];

// Production callers use pinned Apple roots and online revocation checking. Tests can
// construct a verifier with a synthetic root; HTTP/config never chooses trust roots.
function createSignedVerifier({ roots = appleRoots, onlineChecks = true } = {}) {
  return async function verify(payload, decode) {
    const appId = Number(process.env.APPLE_APP_ID);
    const hasAppId = Number.isSafeInteger(appId) && appId > 0;
    const bundleId = process.env.APPLE_BUNDLE_ID || 'com.carey.stockmate';
    const environments = hasAppId ? [Environment.PRODUCTION, Environment.SANDBOX] : [Environment.SANDBOX];
    let retryable = false;
    for (const environment of environments) {
      const verifier = new SignedDataVerifier(roots, onlineChecks, environment, bundleId, environment === Environment.PRODUCTION ? appId : undefined);
      try { return await decode(verifier, payload); }
      catch (error) { if (error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) retryable = true; }
    }
    if (retryable) throw httpError(503, 'Apple证书检查暂不可用，请保留交易后重试');
    // Untrusted hint only improves the configuration error; never grants access.
    let hint;
    try { hint = JSON.parse(Buffer.from(payload.split('.')[1], 'base64url').toString('utf8')); } catch {}
    if (!hasAppId && (hint?.environment === 'Production' || hint?.data?.environment === 'Production')) throw httpError(503, '未配置APPLE_APP_ID，暂不能验证正式Apple交易');
    throw httpError(400, 'Apple签名、应用或环境验证失败');
  };
}
const verifySigned = createSignedVerifier();
const verifyAppleSignedTransaction = payload => verifySigned(payload, (verifier, value) => verifier.verifyAndDecodeTransaction(value));
module.exports = { createSignedVerifier, verifySigned, verifyAppleSignedTransaction };
