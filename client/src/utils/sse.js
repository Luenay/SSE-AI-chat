/**
 * 浏览器侧的 SSE 帧解析器。
 *
 * 为什么不用 EventSource？
 *   EventSource 只能发 GET 请求，既不能带请求体，也不能自定义请求头，
 *   而我们的接口是 POST /api/chat 且要传 question。
 *   所以只能用 fetch + ReadableStream 自己读，也就需要自己把字节流切成帧。
 *
 * 最难理解的一点：网络数据是一块一块（chunk）到达的，
 * 一块里可能有好几个完整帧，也可能只包含「半个帧」。
 * 因此必须用一个 buffer 把没凑齐的部分存起来，等下一块到了再拼。
 */

const MAX_BUFFER_LENGTH = 256 * 1024;

/** 把一个完整帧的文本解析成 { event, data }；心跳注释帧返回 null */
function parseFrame(raw) {
  let event = 'message'; // SSE 规范：没写 event 字段时默认叫 message
  const dataLines = [];

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // 空行、注释、心跳
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // 规范允许冒号后带一个空格
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join('\n');
  let data = rawData;
  try {
    data = JSON.parse(rawData); // 本项目约定 data 是 JSON
  } catch {
    // 万一后端返回纯文本帧，原样交给调用方处理，不要因为解析失败打断整条流
  }
  return { event, data };
}

/**
 * @param {(frame: {event: string, data: unknown}) => void} onFrame 每解析出一帧就回调一次
 */
export function createSSEParser(onFrame) {
  let buffer = '';

  return {
    push(text) {
      buffer += text;
      let boundary = buffer.indexOf('\n\n'); // 两个换行 = 一帧结束
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2); // 剩下的（可能是半帧）留到下一次
        const frame = parseFrame(rawFrame);
        if (frame) onFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
      if (buffer.length > MAX_BUFFER_LENGTH) {
        throw new Error('流式数据帧过大，已停止解析');
      }
    },

    /** 流结束后调用一次，处理最后没以双换行结尾的内容 */
    flush() {
      if (buffer.trim() !== '') {
        const frame = parseFrame(buffer);
        if (frame) onFrame(frame);
      }
      buffer = '';
    },
  };
}
