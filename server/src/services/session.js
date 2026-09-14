const jwt = require('jsonwebtoken');
const issueJwt = user => jwt.sign({ userId: user.id, username: user.username, role: user.role, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
// Generation zero permits pre-migration JWTs only until first revocation.
const sessionMatches = (claims, user) => (claims.sessionVersion ?? 0) === user.sessionVersion;
async function clearGrants(tx, userIds) {
  const where = { userId: { in: userIds } };
  await tx.webLoginCode.deleteMany({ where });
  await tx.webLoginChallenge.deleteMany({ where });
  const identities = await tx.phoneIdentity.findMany({ where, select: { phone: true } });
  await tx.smsChallenge.deleteMany({ where: { OR: [where, { phone: { in: identities.map(i => i.phone) } }] } });
  await tx.smsReauth.deleteMany({ where });
  const apple = await tx.authIdentity.findMany({ where: { ...where, provider: 'apple' }, select: { openId: true } });
  await tx.appleAuthAttempt.deleteMany({ where: { OR: [where, { appleSub: { in: apple.map(i => i.openId) } }] } });
  await tx.webAccessGrant.deleteMany({ where });
}
module.exports = { issueJwt, sessionMatches, clearGrants };
