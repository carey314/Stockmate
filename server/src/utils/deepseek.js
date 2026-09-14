// DeepSeek调用保持原有重试/额度语义；逐次provider尝试记录不含业务正文的运营指标。
const { httpError } = require('./biz');
const { nextAttempt, recordAttempt } = require('../services/metricsContext');

const callDeepSeek = async (systemPrompt, userContent, { retries = 2, history = [] } = {}) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw httpError(503, 'AI 未配置（DEEPSEEK_API_KEY 为空）');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const record = nextAttempt(), start = Date.now();
    let usage, status = 'failed', errorCode = 'NETWORK_ERROR';
    try {
      const resp = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userContent }], temperature: 0.1, response_format: { type: 'json_object' } }),
      });
      if (!resp.ok) {
        errorCode = `HTTP_${resp.status}`;
        try { usage = (await resp.json())?.usage; } catch { /* HTTP status remains the failure source. */ }
        throw httpError(502, `AI 服务返回 ${resp.status}，稍后再试`);
      }
      errorCode = 'INVALID_RESPONSE_JSON'; status = 'parse_failed';
      const json = await resp.json(); usage = json.usage;
      errorCode = 'INVALID_PROVIDER_JSON';
      const content = json.choices?.[0]?.message?.content?.trim() || '{}';
      const result = JSON.parse(content.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
      status = 'success'; errorCode = null;
      return result;
    } catch (error) {
      if (error.status) throw error; // 原HTTP业务错误不重试；网络/JSON解析错误仍按原策略重试。
      console.warn(`[deepseek] attempt=${attempt + 1} failed; code=${errorCode}; retry=${attempt < retries}`);
    } finally {
      await recordAttempt(record, { model, status, durationMs: Date.now() - start, usage, errorCode });
    }
  }
  throw httpError(503, 'AI 服务暂时连不上（网络波动），请稍后重试');
};
module.exports = { callDeepSeek };
