// Sign in with Apple 的 identityToken 校验
// 流程：取 token header 的 kid → 拉苹果 JWKS 公钥（缓存1小时）→ RS256 验签 + 校 issuer/audience
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { httpError } = require('./biz');

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.carey.stockmate';

let jwksCache = { keys: null, at: 0 };

const getAppleKeys = async () => {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  try {
    const resp = await fetch(APPLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('Apple keys unavailable');
    const { keys } = await resp.json();
    if (!Array.isArray(keys) || !keys.length || keys.some(key => !key || typeof key.kid !== 'string')) {
      throw new Error('Invalid Apple keys');
    }
    jwksCache = { keys, at: Date.now() };
    return keys;
  } catch {
    throw httpError(502, '暂时无法验证 Apple 身份，请稍后重试');
  }
};

/** 旧 oauth 保持兼容；敏感网页登录桥必须提供 nonceHash 与 maxAgeSeconds。 */
const verifyAppleToken = async (identityToken, { nonceHash, maxAgeSeconds } = {}) => {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded?.header?.kid) throw httpError(401, 'Apple 令牌格式无效');

  const keys = await getAppleKeys();
  const jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) throw httpError(401, 'Apple 公钥不匹配（令牌可能过期）');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  try {
    const payload = jwt.verify(identityToken, publicKey.export({ type: 'spki', format: 'pem' }), {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: BUNDLE_ID,
    });
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('缺少用户标识');
    if (nonceHash !== undefined || maxAgeSeconds !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (typeof nonceHash !== 'string' || !/^[a-f0-9]{64}$/.test(nonceHash)
          || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0
          || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
          || now - payload.iat > maxAgeSeconds || payload.iat > now + 30
          || typeof payload.nonce !== 'string' || !payload.nonce) {
        throw new Error('请重新通过 Apple 验证身份');
      }
      const actual = crypto.createHash('sha256').update(payload.nonce).digest();
      if (!crypto.timingSafeEqual(actual, Buffer.from(nonceHash, 'hex'))) {
        throw new Error('Apple 验证请求不匹配');
      }
    }
    return { sub: payload.sub, email: payload.email ?? null };
  } catch (e) {
    throw httpError(401, `Apple 登录校验失败：${e.message}`);
  }
};

module.exports = { verifyAppleToken };
