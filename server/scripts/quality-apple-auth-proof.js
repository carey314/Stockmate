// Produces a fresh synthetic proof file for Dio tests. Does NOT verify or register.
// Usage: node quality-apple-auth-proof.js PRIVATE_RUNTIME SUBJECT OUTPUT_BASENAME
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
async function main() {
  process.umask(0o077);
  const [runtime, subject, basename] = process.argv.slice(2);
  if (!runtime || !/^qa-[\w-]{1,80}$/.test(subject || '') || !/^[\w-]+\.json$/.test(basename || '')) throw Error('Invalid test arguments');
  const directory = fs.realpathSync(runtime);
  if (!path.basename(directory).startsWith('stockmate-apple-auth-') || (fs.statSync(directory).mode & 0o777) !== 0o700) throw Error('Requires private isolated runtime');
  const access = JSON.parse(fs.readFileSync(path.join(directory, 'access.private.json')));
  const url = new URL(access.api);
  if (!access.syntheticApple || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Synthetic loopback service only');
  const response = await fetch(`${access.api}/auth/apple/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body = await response.json();
  if (response.status !== 200 || !body.data?.nonce) throw Error('Challenge unavailable');
  const c = body.data;
  const identityToken = jwt.sign({ sub: subject, nonce: c.nonce, iss: 'https://appleid.apple.com', aud: 'com.carey.stockmate' },
    fs.readFileSync(path.join(directory, 'apple-test-private.pem')), { algorithm: 'RS256', keyid: 'quality-only-apple-auth', expiresIn: '5m' });
  const output = path.join(directory, basename);
  fs.writeFileSync(output, JSON.stringify({ challengeId: c.challengeId, identityToken }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ proofFile: output, expiresAt: c.expiresAt, verified: false, accountCreated: false }));
}
main().catch(() => { console.error('Synthetic proof not created; no credential output'); process.exitCode = 1; });
