// 统一响应格式
const ok = (res, data = null, message = 'success') =>
  res.json({ code: 200, message, data });

const created = (res, data = null, message = 'created') =>
  res.status(201).json({ code: 201, message, data });

const fail = (res, code, message, errors) =>
  res.status(code).json({ code, message, ...(errors ? { errors } : {}) });

// 包装 async 处理器，自动 catch 传给 errorHandler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ok, created, fail, wrap };
