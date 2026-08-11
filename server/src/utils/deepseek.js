// DeepSeek 调用统一封装：自动重试 + 友好错误
const { httpError } = require('./biz');

const callDeepSeek = async (systemPrompt, userContent, { retries = 2, history = [] } = {}) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw httpError(503, 'AI 未配置（DEEPSEEK_API_KEY 为空）');

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            ...history, // 多轮上下文（问生意追问用），调用方负责截断
            { role: 'user', content: userContent },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) throw httpError(502, `AI 服务返回 ${resp.status}，稍后再试`);
      const json = await resp.json();
      // token 账单可见化（也是将来按用量计费的地基）：hit=缓存命中(便宜10倍) miss=未命中
      const u = json.usage;
      if (u) console.log(`[deepseek] tokens: 输入${u.prompt_tokens}(hit ${u.prompt_cache_hit_tokens ?? 0}/miss ${u.prompt_cache_miss_tokens ?? u.prompt_tokens}) 输出${u.completion_tokens}`);
      const content = json.choices?.[0]?.message?.content?.trim() || '{}';
      return JSON.parse(content.replace(/^```(json)?/i, '').replace(/```$/, '').trim());
    } catch (e) {
      lastErr = e;
      if (e.status) throw e; // 业务错误不重试
      // 网络抖动（连接超时/断开）→ 重试
      console.warn(`[deepseek] 第${attempt + 1}次失败: ${e.message}${attempt < retries ? '，重试…' : ''}`);
    }
  }
  throw httpError(503, `AI 服务暂时连不上（网络波动），请稍后重试`);
};

module.exports = { callDeepSeek };
