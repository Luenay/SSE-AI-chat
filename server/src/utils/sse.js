/**
 * SSE（Server-Sent Events）协议工具 —— 后端只在这个文件里处理「帧」的格式。
 *
 * 一个 SSE 帧长这样（末尾必须有两个换行，表示这一帧结束）：
 *   event: delta
 *   data: {"content":"你好"}
 *
 * 本项目有两处用到帧：
 *   1. 写给前端：writeSSEHeaders / sendEvent / sendComment
 *   2. 读上游百炼：createSSEParser（把网络字节流切成一帧一帧）
 */

const MAX_BUFFER_LENGTH = 256 * 1024;

/** 建立 SSE 响应：设置响应头并立刻刷出去，让前端知道连接已经建立 */
export function writeSSEHeaders(res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform 很关键：禁止中间代理压缩或改写响应体，否则流会被攒起来
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 告诉 Nginx 等反向代理不要缓冲这条流
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

/** 写一个业务帧。payload 转成 JSON，前端用 JSON.parse 读回 */
export function sendEvent(res, event, payload) {
  // 客户端已经断开时不要继续写，否则会触发 write after end
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** 写一个注释帧（冒号开头）。浏览器会忽略它，常用来做心跳保活 */
export function sendComment(res, text) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`: ${text}\n\n`);
}

/** 解析单个完整帧，返回 { event, data }；注释帧和空帧返回 null */
function parseFrame(raw) {
  let event = 'message';
  const dataLines = [];

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // 空行、注释、心跳
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // 规范允许冒号后带一个空格
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    // id / retry 等字段本项目用不到，忽略即可
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') }; // 多行 data 按规范用换行拼接
}

/**
 * 增量帧解析器：网络数据是一块一块到达的，
 * 一块里可能装了好几帧（粘包），也可能只有半帧（半帧），
 * 所以必须把没凑齐的部分暂存在 buffer 里，等下一块来了再拼。
 *
 * @param {(frame: {event: string, data: string}) => void} onFrame 每解析出一帧就回调
 */
export function createSSEParser(onFrame) {
  let buffer = '';
  let pendingCR = false; // 上一个 chunk 以 \r 结尾时，把 \r 留到下一次一起处理

  function drain() {
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawFrame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const frame = parseFrame(rawFrame);
      if (frame) onFrame(frame);
      boundary = buffer.indexOf('\n\n');
    }
    if (buffer.length > MAX_BUFFER_LENGTH) {
      throw new Error('SSE 单个帧过大，已停止解析');
    }
  }

  return {
    push(text) {
      // 处理恰好被切在 \r 和 \n 之间的 CRLF，避免把一行 data 拆成两帧
      if (pendingCR) {
        text = '\r' + text;
        pendingCR = false;
      }
      if (text.endsWith('\r')) {
        pendingCR = true;
        text = text.slice(0, -1);
      }
      // 统一换行符：兼容 \r\n 与 \n，之后都按 \n\n 切帧
      buffer += text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      drain();
    },

    /** 流结束时调用，收尾处理最后一段没有以双换行结尾的内容 */
    flush() {
      if (pendingCR) {
        buffer += '\n';
        pendingCR = false;
      }
      if (buffer.trim() !== '') {
        const frame = parseFrame(buffer);
        if (frame) onFrame(frame);
      }
      buffer = '';
    },
  };
}
