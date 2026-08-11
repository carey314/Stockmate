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
  const resp = await fetch(APPLE_JWKS_URL);
  if (!resp.ok) throw httpError(502, '获取 Apple 公钥失败');
  const { keys } = await resp.json();
  jwksCache = { keys, at: Date.now() };
  return keys;
};

/** 验证 identityToken，返回 { sub, email } */
const verifyAppleToken = async (identityToken) => {
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
    return { sub: payload.sub, email: payload.email ?? null };
  } catch (e) {
    throw httpError(401, `Apple 登录校验失败：${e.message}`);
  }
};

module.exports = { verifyAppleToken };
