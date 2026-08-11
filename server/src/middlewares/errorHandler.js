const { ZodError } = require('zod');

// 统一错误处理
module.exports = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      code: 400,
      message: '参数错误',
      errors: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }
  if (err.status) {
    return res.status(err.status).json({ code: err.status, message: err.message });
  }
  console.error('[error]', err);
  return res.status(500).json({ code: 500, message: '服务器内部错误' });
};
