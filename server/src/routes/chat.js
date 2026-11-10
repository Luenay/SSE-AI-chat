import { Router } from 'express';
import { config } from '../config.js';
import { streamAnswer } from '../services/index.js';
import { writeSSEHeaders, sendEvent, sendComment } from '../utils/sse.js';

const router = Router();

/** 只把安全的错误文案发给前端，避免上游错误信息里夹带密钥或内部细节 */
function toClientMessage(error, timedOut) {
  if (timedOut) return '模型响应超时，请稍后重试';
  const text = String(error?.message || '生成回答时发生未知错误');
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '***').slice(0, 200);
}

/**
 * POST /api/chat
 * 请求体：{ "question": "你想问什么", "model": "可选，必须在 DASHSCOPE_MODELS 里" }
 * 响应：text/event-stream，逐帧下发 delta / done / error（详见 README）
 */
async function handleChat(req, res) {
  // ---- 阶段 1：入参校验。此时还没写响应头，可以正常返回 HTTP 状态码 ----
  const { question, model } = req.body ?? {};
  if (typeof question !== 'string' || question.trim() === '') {
    return res.status(400).json({ error: 'question 不能为空，且必须是字符串' });
  }
  if (question.length > config.maxQuestionLength) {
    return res.status(400).json({ error: `问题过长，最多 ${config.maxQuestionLength} 个字符` });
  }

  // 白名单校验：只允许使用服务端配置过的模型，避免前端随意传模型名消耗额度
  const selectedModel =
    typeof model === 'string' && config.models.includes(model) ? model : config.model;

  // ---- 阶段 2：切换成 SSE 响应。从这里开始状态码已固定，出错只能发 error 帧 ----
  writeSSEHeaders(res);
  sendComment(res, 'connected'); // 先写一帧注释，促使代理立刻把响应头刷给浏览器

  const requestId = Math.random().toString(36).slice(2, 10);
  const startedAt = Date.now();
  const controller = new AbortController();
  let clientClosed = false;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.upstreamTimeoutMs);

  // 模型思考较久时保持连接活跃；注释帧会被前端解析器忽略
  const heartbeat = setInterval(() => sendComment(res, 'ping'), 15_000);

  // 客户端断开（关页面、刷新、取消请求）时立刻中止上游，别让模型继续烧钱
  res.on('close', () => {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    // 注意：正常 res.end() 也会触发 close，此时 writableEnded 为 true，不算断开
    if (!res.writableEnded) {
      clientClosed = true;
      controller.abort();
    }
  });

  // 日志只记状态，不打印问题全文，也不逐帧打印
  console.log(`[chat ${requestId}] mode=${config.isMock ? 'mock' : 'real'} model=${selectedModel}`);

  try {
    let chunks = 0;
    for await (const text of streamAnswer(question.trim(), controller.signal, selectedModel)) {
      if (clientClosed) break;
      sendEvent(res, 'delta', { content: text });
      chunks += 1;
    }
    if (!clientClosed) {
      sendEvent(res, 'done', { finishReason: config.isMock ? 'mock' : 'stop' });
    }
    console.log(`[chat ${requestId}] done chunks=${chunks} cost=${Date.now() - startedAt}ms`);
  } catch (error) {
    if (clientClosed) return; // 用户自己断开了，没必要（也没法）再报错
    console.error(`[chat ${requestId}] error: ${error?.message}`);
    sendEvent(res, 'error', { message: toClientMessage(error, timedOut) });
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

router.post('/chat', handleChat);

export default router;
