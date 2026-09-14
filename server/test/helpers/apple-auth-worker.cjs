// Isolated test worker. Synthetic JWKS only; no external HTTP/provider calls permitted.
const jwk = JSON.parse(process.env.APPLE_TEST_JWK);
global.fetch = async url => {
  if (String(url) === 'https://appleid.apple.com/auth/keys') return { ok: true, json: async () => ({ keys: [jwk] }) };
  throw Error('External request blocked by isolated Apple test worker');
};
const express = require('express');
const db = require('../../src/config/prisma').basePrisma;
const app = express(); app.use(express.json()); app.use('/api/v1', require('../../src/routes'));
app.use(require('../../src/middlewares/errorHandler'));
const server = app.listen(0, '127.0.0.1', () => process.send({ event: 'ready', port: server.address().port }));
process.on('message', async message => {
  if (message === 'stop') { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); process.exit(0); }
});
