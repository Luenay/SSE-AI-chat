import { config } from '../config.js';
import { createSSEParser } from '../utils/sse.js';

/** 把上游的 HTTP 错误翻译成看得懂、又不泄露密钥的提示 */
function toFriendlyError(status, body) {
  const hints = {
    400: '请求参数不被百炼接受，请检查 DASHSCOPE_MODEL 是否正确',
    401: 'API Key 无效或已过期，请检查 server/.env 中的 DASHSCOPE_API_KEY',
    403: '这个 API Key 没有访问该模型的权限',
    404: '接口地址或模型名不存在，请检查 DASHSCOPE_BASE_URL 与 DASHSCOPE_MODEL',
    429: '调用过于频繁或额度不足，请稍后重试',
  };
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || '';
  } catch {
    // 上游返回的不是 JSON（例如网关的 HTML 错误页），忽略即可
  }
  detail = String(detail).slice(0, 160);
  return new Error(`${hints[status] || `百炼接口返回 HTTP ${status}`}${detail ? `：${detail}` : ''}`);
}

/**
 * 调用百炼「OpenAI 兼容模式」的流式接口。
 *
 * 统一契约：async generator，每次 yield 一小段文本。
 * 第三个参数 model 由路由层从白名单里选出，Mock 实现会忽略它。
 * 路由层完全不用关心文本是百炼给的还是 Mock 给的。
 *
 * 上游返回的 SSE 帧形如：
 *   data: {"choices":[{"delta":{"content":"你"}}]}
 *   data: [DONE]
 */
export async function* streamAnswer(question, signal, model = config.model) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`, // 密钥只出现在服务端的请求头里
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: question }], // 基础版：只发当前这一问
      stream: true, // 关键：让上游边生成边返回，而不是等整篇写完
    }),
    signal, // 客户端断开或超时时，这里会一起中止上游请求
  });

  if (!response.ok) {
    throw toFriendlyError(response.status, await response.text());
  }
  if (!response.body) {
    throw new Error('百炼没有返回可读取的流式响应体');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const pending = []; // 解析器回调里收集到的文本片段
  let finished = false; // 是否收到 data: [DONE]
  let streamError = null; // 有些错误会出现在帧里，而不是 HTTP 状态码里

  const parser = createSSEParser(({ data }) => {
    if (data.trim() === '[DONE]') {
      finished = true;
      return;
    }
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return; // 忽略无法识别的帧
    }
    if (json?.error?.message) {
      streamError = new Error(`百炼返回错误：${String(json.error.message).slice(0, 160)}`);
      return;
    }
    // OpenAI 兼容格式的增量文本就在这个字段里
    const content = json?.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      pending.push(content);
    }
  });

  try {
    while (!finished && !streamError) {
      const { value, done } = await reader.read();
      if (done) break;
      // stream: true 让 TextDecoder 正确处理「一个中文字符被拆到两个 chunk」的情况
      parser.push(decoder.decode(value, { stream: true }));
      while (pending.length > 0) yield pending.shift();
    }
    parser.flush(); // 收尾：万一最后一帧没带双换行
    if (streamError) throw streamError;
    while (pending.length > 0) yield pending.shift();
  } finally {
    // 提前结束时主动释放上游连接，避免连接与内存泄漏
    await reader.cancel().catch(() => {});
  }
}
