const { z } = require('zod');
const { ok } = require('../utils/response');
const { httpError } = require('../utils/biz');
const { createService } = require('../services/appleLogin');

const verifySchema = z.object({ challengeId: z.string().uuid(), identityToken: z.string().min(10).max(16384) }).strict();
const registerSchema = z.object({ registrationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), createStore: z.literal(true), consent: z.literal(true), realName: z.string().trim().min(1).max(30) }).strict();
function createController(options) {
  const service = createService(options);
  const call = (method, schema) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return ok(res, await service[method](schema ? schema.parse(req.body) : undefined)); }
    catch (error) {
      if (error.status || error instanceof z.ZodError) throw error;
      // Prisma errors may contain submitted values. Never pass them to the raw error logger.
      throw httpError(503, 'Apple登录暂未完成，请重试原请求或稍后重新验证');
    }
  };
  return { capabilities: call('capabilities'), challenge: call('challenge', z.object({}).strict()), verify: call('verify', verifySchema), register: call('register', registerSchema) };
}
module.exports = { ...createController(), createController };
