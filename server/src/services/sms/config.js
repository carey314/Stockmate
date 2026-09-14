const REQUIRED = ['PNVS_ACCESS_KEY_ID', 'PNVS_ACCESS_KEY_SECRET', 'PNVS_SIGN_NAME', 'PNVS_TEMPLATE_CODE_LOGIN', 'PNVS_TEMPLATE_CODE_RESET', 'PNVS_TEMPLATE_CODE_BIND'];
function checkConfig(env = process.env) {
  const missing = REQUIRED.filter(key => !env[key]?.trim());
  return { enabled: missing.length === 0, missing };
}
module.exports = { REQUIRED, checkConfig };
