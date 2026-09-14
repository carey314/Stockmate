// Actual HTTP routes and Prisma, isolated test DB. No external identity providers.
if (!/^file:\/tmp\/unit-web-login-multiprocess-/.test(process.env.DATABASE_URL || '')) {
  throw new Error('Web login worker requires its dedicated isolated database');
}
const express = require('express');
const prisma = require('../../src/config/prisma');
const app = express();
app.use(express.json());
app.use('/api/v1', require('../../src/routes'));
app.use(require('../../src/middlewares/errorHandler'));
const server = app.listen(0, '127.0.0.1', () => {
  process.send({ type: 'ready', port: server.address().port });
});
process.on('message', async message => {
  if (message !== 'stop') return;
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
  process.exit(0);
});
