const service = require('../services/standardImport');
const { ok } = require('../utils/response');
exports.validate = async (req, res) => ok(res, await service.validate(req.body, req.user));
exports.commit = async (req, res) => ok(res, await service.commit(req.body, req.user));
