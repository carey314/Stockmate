const { z } = require('zod');
const prisma = require('../config/prisma');
const { ok } = require('../utils/response');

const schema = z.object({
  level: z.string().max(20).default('manual'),
  message: z.string().min(1).max(1000),
  stack: z.string().max(4000).nullish(),
  platform: z.string().max(20).nullish(),
  appVersion: z.string().max(30).nullish(),
});

// 崩溃上报：不要求登录（崩溃可能发生在登录之前），且永远返回成功——
// 上报失败绝不能反过来影响 App，更不能让用户看见"上报错误失败"这种套娃提示
exports.report = async (req, res) => {
  try {
    const d = schema.parse(req.body);
    await prisma.clientLog.create({
      data: { ...d, stack: d.stack ?? null, userId: req.user?.userId ?? null },
    });
  } catch (_) {
    /* 静默吞掉：上报链路自身的问题不该打扰用户 */
  }
  return ok(res, { received: true });
};
