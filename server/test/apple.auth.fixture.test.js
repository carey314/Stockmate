const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const jwt = require('jsonwebtoken');

test('safe fixture generator signs real challenge nonce into private file without logging credentials', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stockmate-apple-auth-fixture-'));
  fs.chmodSync(directory, 0o700);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(directory, 'apple-test-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const nonce = crypto.randomBytes(32).toString('base64url'); const challengeId = crypto.randomUUID();
  const express = require('express'); const app = express(); let challengeCalls = 0;
  app.use(express.json());
  app.post('/api/v1/auth/apple/challenge', (req, res) => {
    assert.deepEqual(req.body, {}); challengeCalls++;
    res.json({ code: 200, data: { challengeId, nonce, expiresAt: new Date(Date.now() + 300000) } });
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(directory, 'access.private.json'), JSON.stringify({ api: `http://127.0.0.1:${server.address().port}/api/v1`, syntheticApple: true }), { mode: 0o600 });
  const script = path.join(__dirname, '../scripts/quality-apple-auth-proof.js');
  const result = await run(process.execPath, [script, directory, 'qa-fixture-owner', 'proof.json'], { env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const output = JSON.parse(result.stdout);
  const proof = JSON.parse(fs.readFileSync(output.proofFile));
  const claims = jwt.verify(proof.identityToken, publicKey, { algorithms: ['RS256'], audience: 'com.carey.stockmate', issuer: 'https://appleid.apple.com' });
  assert.equal(proof.challengeId, challengeId); assert.equal(claims.nonce, nonce); assert.equal(claims.sub, 'qa-fixture-owner');
  assert.equal(claims.exp - claims.iat, 300); assert.equal(challengeCalls, 1);
  assert.equal(fs.statSync(output.proofFile).mode & 0o777, 0o600);
  assert.equal(output.verified, false); assert.equal(output.accountCreated, false);
  assert.ok(!result.stdout.includes(nonce)); assert.ok(!result.stdout.includes(proof.identityToken)); assert.equal(result.stderr, '');
  await assert.rejects(run(process.execPath, [script, directory, 'qa-fixture-owner', '../escape.json']));
  assert.equal(challengeCalls, 1, 'Unsafe output rejected before issuing challenge');
});
