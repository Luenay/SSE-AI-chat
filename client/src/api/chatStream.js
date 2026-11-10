import { createSSEParser } from '../utils/sse.js';

/**
 * 整个前端唯一的「发问题 + 收流」入口。
 *
 * @param {{question: string, model?: string}} payload 请求体：问题 + 页面选中的模型
 * @param {{onDelta?: Function, onDone?: Function, onError?: Function}} handlers 三类帧的回调
 * @param {AbortSignal} signal 用于取消请求（刷新页面 / 组件卸载时）
 */
export async function streamChat(payload, handlers, signal) {
  // 走相对路径 /api，由 Vite 代理转发到 Express，
  // 浏览器看到的是同源请求，不需要处理跨域，也不写死后端地址。
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  });

  // 在 SSE 响应头写入之前的错误（例如参数为空）仍是普通 JSON
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // 后端返回的不是 JSON，沿用默认提示
    }
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error('当前环境不支持流式响应（ReadableStream 不可用）');
  }

  const reader = response.body.getReader();
  // stream: true 很重要：一个中文字符的 UTF-8 字节可能被拆到两个 chunk 里，
  // 由 TextDecoder 记住未解码完的字节，才不会出现乱码。
  const decoder = new TextDecoder('utf-8');

  // 解析器只负责「把字节流还原成帧」，业务分发放在下面，职责分开更好理解
  const frames = [];
  const parser = createSSEParser((frame) => frames.push(frame));

  function dispatchFrames() {
    let textBuffer = '';
    const flushText = () => {
      if (textBuffer) {
        handlers.onDelta?.(textBuffer);
        textBuffer = '';
      }
    };

    for (const frame of frames.splice(0)) {
      const payload = frame.data && typeof frame.data === 'object' ? frame.data : {};
      if (frame.event === 'delta') {
        if (typeof payload.content === 'string') textBuffer += payload.content;
      } else if (frame.event === 'done') {
        flushText(); // 保证先追加完文本，再切到完成态
        handlers.onDone?.(payload);
      } else if (frame.event === 'error') {
        flushText();
        handlers.onError?.(payload.message || '生成回答时出错');
      }
    }
    // 同一网络块里的多个 delta 合并成一次回调，减少 React 的重渲染次数
    flushText();
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      dispatchFrames();
    }
    parser.flush();
    dispatchFrames();
  } finally {
    reader.releaseLock();
  }
}
