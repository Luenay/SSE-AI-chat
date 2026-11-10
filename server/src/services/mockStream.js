/**
 * 没有 API Key 时用它模拟「模型逐字往外吐字」。
 * 回答里故意带上标题、列表、代码块、表格和引用，方便一眼验证 Markdown 渲染效果。
 */

const MOCK_LINES = [
  '## 你好，这是一段模拟回答 👋',
  '',
  '你现在看到的是 **Mock 模式**：后端没有配置 `DASHSCOPE_API_KEY`，所以不会真的请求百炼，而是由本地一段一段地生成文字，用来验证 **SSE 流式链路** 是否通畅。',
  '',
  '你刚才问的是：`{QUESTION}`',
  '',
  '### 这段回答是怎么到达浏览器的？',
  '',
  '1. 浏览器用 `fetch` 向 `/api/chat` 发送 POST 请求',
  '2. Express 写入 SSE 响应头，并保持连接打开',
  '3. 后端每产生一段文本，就写一个 `event: delta` 帧',
  '4. 前端用 `ReadableStream` 边读边解析，把增量文本追加到消息里',
  '5. 收到 `event: done` 后结束渲染，光标消失',
  '',
  '```js',
  '// 前端追加文本的关键思路：函数式更新，避免读到旧的状态',
  'setMessages((prev) => appendToLastMessage(prev, delta));',
  '```',
  '',
  '| 阶段 | 负责方 | 数据形式 |',
  '| --- | --- | --- |',
  '| 提问 | 浏览器 | JSON 请求体 |',
  '| 生成 | 后端 / 百炼 | 增量文本片段 |',
  '| 推送 | SSE 连接 | `data: {...}` 帧 |',
  '| 展示 | React + Markdown | 逐步重渲染 |',
  '',
  '> 想接真实模型？把密钥填进 `server/.env` 的 `DASHSCOPE_API_KEY`，重启后端即可，前端一行都不用改。',
  '',
  '更完整的原理说明见项目根目录的 `README.md`。',
];

const MOCK_ANSWER = MOCK_LINES.join('\n');

/** 可被 AbortSignal 立刻打断的等待，避免客户端断开后定时器还在跑 */
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 与 llm.js 完全相同的契约：每次 yield 一小段文本；model 在模拟模式下忽略 */
export async function* streamAnswer(question, signal, model) {
  // 问题由用户输入，只截取一小段并去掉会破坏 Markdown 结构的字符
  const brief = String(question).replace(/[`\r\n]/g, ' ').slice(0, 60);
  const text = MOCK_ANSWER.replace('{QUESTION}', brief);

  for (let i = 0; i < text.length; ) {
    if (signal?.aborted) return;
    await delay(18, signal);
    if (signal?.aborted) return;
    const step = 2 + Math.floor(Math.random() * 3);
    yield text.slice(i, i + step);
    i += step;
  }
}
