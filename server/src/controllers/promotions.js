const service = require('../services/promotions');
const { ok } = require('../utils/response');
const { httpError } = require('../utils/biz');
const { ZodError } = require('zod');
const expectedStatuses = new Set([400, 401, 403, 404, 409, 410, 503]);
const guarded = fn => async (req,res) => {
  res.set('Cache-Control','no-store');
  try {
    return ok(res,await fn(req));
  } catch (err) {
    if (err instanceof ZodError || expectedStatuses.has(err?.status)) throw err;
    // Driver errors can contain query arguments, issuance ciphertext and stacks.
    // Log only a fixed event code, then give the shared handler a safe error.
    console.error('[promotions]', 'PROMOTION_INTERNAL_ERROR');
    throw httpError(500, '服务器内部错误');
  }
};
const platform = fn => guarded(req => {
  if (!req.platformAdmin) throw httpError(403,'需要平台管理员身份');
  return fn(req);
});
exports.createBatch = platform(req=>service.createBatch(req.body,req.platformAdmin));
exports.listCodes = platform(req=>service.listCodes(req.query));
exports.audit = platform(req=>service.audit(req.query));
exports.disable = platform(req=>service.disable(req.params.id,req.body,req.platformAdmin));
exports.revoke = platform(req=>service.revoke(req.params.id,req.body,req.platformAdmin));
exports.redeem = guarded(req=>service.redeem(req.body,req.user));
