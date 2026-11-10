/**
 * 端到端冒烟测试：自己启动后端，验证两条链路。
 *
 *   A. Mock 模式：没有密钥时的完整 SSE 流
 *   B. 真实模式代码路径：用一个「本地假百炼服务」代替真实 API，
 *      验证 llm.js 的请求头、模型切换、流式拆帧与文本拼接，全程不联网、不消耗额度
 *
 * 运行：npm run smoke
 * 使用 3101 / 3102 / 3103 三个独立端口，与正在运行的 dev server 互不干扰；
 * 所有子进程在 finally 中统一关闭。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const serverDir = path.join(rootDir, 'server');
const children = [];
const results = [];

function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

/** 启动一个后端子进程；显式传空密钥时 dotenv 不会覆盖，可强制进入 Mock */
function startBackend(port, extraEnv) {
  const child = spawn(process.execPath, ['src/app.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { log: '' };
  child.stdout.on('data', (data) => { state.log += data.toString(); });
  child.stderr.on('data', (data) => { state.log += data.toString(); });
  children.push(child);
  return { base: `http://127.0.0.1:${port}`, state };
}

async function waitForHealth(base, state, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // 后端还没监听，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`后端未能在 ${timeoutMs}ms 内启动。日志：\n${state.log}`);
}

async function postChat(base, question, model) {
  const payload = { question };
  if (model) payload.model = model;
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.body) return { status: res.status, contentType, raw: '' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let raw = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  return { status: res.status, contentType, raw };
}

function dataLine(frame) {
  return frame.split('\n').find((line) => line.startsWith('data:')) || '';
}

function parseFrames(raw) {
  const frames = raw.split('\n\n').filter((frame) => frame.includes('data:'));
  return {
    delta: frames.filter((frame) => frame.startsWith('event: delta')),
    done: frames.filter((frame) => frame.startsWith('event: done')),
    all: frames,
    text: frames
      .filter((frame) => frame.startsWith('event: delta'))
      .map((frame) => JSON.parse(dataLine(frame).slice(5).trim()).content)
      .join(''),
  };
}

/** 假百炼：返回标准 OpenAI 兼容 SSE 帧，并故意把一帧拆成两次写入 */
function startFakeUpstream(port) {
  const received = {};
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.path = req.url;
    received.auth = req.headers.authorization;
    received.body = JSON.parse(body || '{}');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"好，这是"}}]}\n\n');
    res.write('data: {"'); // 半帧：剩下的内容在下一次写入，考验 buffer 拼接
    setTimeout(() => {
      res.write('choices":[{"delta":{"content":"流式回答"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    }, 30);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, received }));
  });
}

let fakeUpstream = null;

try {
  // ---------- A. Mock 模式 ----------
  console.log('--- A. Mock 模式 ---');
  const mock = startBackend(3101, { DASHSCOPE_API_KEY: '' });
  const mockHealth = await waitForHealth(mock.base, mock.state);
  check('健康检查可用', mockHealth.ok === true, JSON.stringify(mockHealth));
  check('未配置密钥时自动进入 Mock', mockHealth.mode === 'mock');
  check('健康检查返回模型列表', Array.isArray(mockHealth.models) && mockHealth.models.length >= 1, JSON.stringify(mockHealth.models));

  const bad = await fetch(`${mock.base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  check('空问题返回 HTTP 400', bad.status === 400);
  await bad.text();

  const mockRes = await postChat(mock.base, '你好，请介绍一下 SSE');
  const mockFrames = parseFrames(mockRes.raw);
  check('响应头是 text/event-stream', mockRes.contentType.startsWith('text/event-stream'));
  check('收到多个 delta 帧', mockFrames.delta.length > 5, `共 ${mockFrames.delta.length} 帧`);
  check('收到且只收到一个 done 帧', mockFrames.done.length === 1);
  check('所有帧的 data 都是合法 JSON', mockFrames.all.every((frame) => {
    try { JSON.parse(dataLine(frame).slice(5).trim()); return true; } catch { return false; }
  }));
  check('增量文本能拼回完整回答', mockFrames.text.includes('Mock 模式') && mockFrames.text.includes('Markdown'));
  check('响应里没有泄露密钥', !mockRes.raw.includes('Bearer') && !mockRes.raw.includes('sk-'));

  // ---------- B. 真实模式代码路径（本地假上游） ----------
  console.log('\n--- B. 真实模式代码路径（假上游，不联网）---');
  fakeUpstream = await startFakeUpstream(3102);
  const real = startBackend(3103, {
    DASHSCOPE_API_KEY: 'sk-test-only',
    DASHSCOPE_BASE_URL: 'http://127.0.0.1:3102/v1',
    DASHSCOPE_MODEL: 'qwen-plus',
    DASHSCOPE_MODELS: 'qwen-plus,qwen3.8-flash,kimi-k3',
  });
  const realHealth = await waitForHealth(real.base, real.state);
  check('配置密钥后进入真实模式', realHealth.mode === 'real');
  check('模型列表来自配置', JSON.stringify(realHealth.models) === JSON.stringify(['qwen-plus', 'qwen3.8-flash', 'kimi-k3']), JSON.stringify(realHealth.models));

  const realRes = await postChat(real.base, '请说一句中文', 'qwen3.8-flash');
  const realFrames = parseFrames(realRes.raw);
  check('上游请求路径正确', fakeUpstream.received.path === '/v1/chat/completions', fakeUpstream.received.path);
  check('密钥只出现在服务端 Authorization 头', fakeUpstream.received.auth === 'Bearer sk-test-only');
  check('上游请求开启了 stream', fakeUpstream.received.body.stream === true);
  check('上游使用了页面选中的模型', fakeUpstream.received.body.model === 'qwen3.8-flash', fakeUpstream.received.body.model);
  check('半帧被正确拼接', realFrames.text === '你好，这是流式回答', realFrames.text);
  check('真实模式以 stop 结束', realFrames.done.length === 1 && JSON.parse(dataLine(realFrames.done[0]).slice(5).trim()).finishReason === 'stop');

  // 白名单之外的模型名必须被拒绝，回退到服务端默认模型
  await postChat(real.base, '再问一句', 'not-in-whitelist');
  check('未授权的模型名回退为默认模型', fakeUpstream.received.body.model === realHealth.model, fakeUpstream.received.body.model);

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${failed === 0 ? `全部通过（${results.length} 项）` : `${failed} 项失败`}`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.error('冒烟测试异常：', error.message);
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill();
  fakeUpstream?.server.close();
}
