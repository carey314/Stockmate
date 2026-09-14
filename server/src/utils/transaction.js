const prisma = require('../config/prisma');
// SQLite 同进程串行写事务，避免交互事务同时读后升级写锁的死锁。
// 跨进程仍由数据库事务/唯一键兜底；可重试冲突不会留下半批账。
let tail = Promise.resolve();
const transaction = (work) => {
  const execute = async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await prisma.$transaction(work, { maxWait: 10000, timeout: 20000 }); }
      catch (e) {
        if (attempt >= 3 || !['P2034', 'P1008', 'P2028'].includes(e.code)) throw e;
        await new Promise(resolve => setTimeout(resolve, 30 * 2 ** attempt));
      }
    }
  };
  const result = tail.then(execute, execute);
  tail = result.catch(() => {});
  return result;
};
module.exports = { transaction };
