const metrics = require('../services/platformMetrics');
const { ok } = require('../utils/response');
const { httpError } = require('../utils/biz');
const platformOnly = req => { if (!req.platformAdmin?.id) throw httpError(403, '仅平台运营账号可访问'); };
exports.overview = async (req, res) => { platformOnly(req); return ok(res, await metrics.overview(req.query)); };
exports.users = async (req, res) => { platformOnly(req); return ok(res, await metrics.users(req.query)); };
exports.userDetail = async (req, res) => { platformOnly(req); return ok(res, await metrics.userDetail(req.params.id, req.query)); };
exports.aiRequests = async (req, res) => { platformOnly(req); return ok(res, await metrics.aiRequests(req.query)); };
