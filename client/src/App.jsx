import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from './api/chatStream.js';
import ChatWindow from './components/ChatWindow.jsx';
import ChatInput from './components/ChatInput.jsx';
import ModelSelect from './components/ModelSelect.jsx';

let messageId = 0;
const createId = () => `msg-${++messageId}`;

/**
 * 把一段增量文本追加到最后一条助手消息上。
 *
 * 注意：这里返回的是「新数组 + 只替换最后一条」，其他消息的对象引用保持不变，
 * 配合 MessageItem 的 React.memo，历史消息就不会被无谓地重渲染。
 */
function appendDelta(messages, text) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return messages;
  const next = messages.slice(0, -1);
  next.push({ ...last, content: last.content + text });
  return next;
}

/** 给最后一条助手消息打补丁（完成态、错误提示等） */
function patchLastAssistant(messages, patch) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return messages;
  const next = messages.slice(0, -1);
  next.push({ ...last, ...patch });
  return next;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // undefined = 正在探测；null = 后端没连上；对象 = /api/health 的返回
  const [serverInfo, setServerInfo] = useState(undefined);
  // 页面选中的模型。列表来自后端 /api/health 的 models 字段，不是前端写死的
  const [currentModel, setCurrentModel] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('health unavailable'))))
      .then((data) => {
        if (!alive) return;
        setServerInfo(data);
        // 后端说用哪个默认模型，下拉框就先选中哪个；用户之前选过且仍在列表里则保留
        setCurrentModel((prev) => (data.models?.includes(prev) ? prev : data.model || 'qwen-plus'));
      })
      .catch(() => {
        if (alive) setServerInfo(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 组件卸载时取消未完成的请求，避免向已卸载组件 setState
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = useCallback(async (rawText) => {
    const question = rawText.trim();
    if (!question || isStreaming) return;

    // 立刻插入用户气泡 + 一条空的助手气泡，助手气泡随后被逐段填满
    setMessages((prev) => [
      ...prev,
      { id: createId(), role: 'user', content: question },
      { id: createId(), role: 'assistant', content: '', streaming: true },
    ]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // 请求体带上当前选中的模型；后端会做白名单校验
    await streamChat({ question, model: currentModel || undefined }, {
      // 关键：函数式更新。写成 setMessages([...messages, ...]) 会一直读到旧值
      onDelta: (text) => setMessages((prev) => appendDelta(prev, text)),
      // done 帧携带结束原因；将来也能在这里接收 token 用量、耗时等扩展字段
      onDone: (payload) => {
        setMessages((prev) => patchLastAssistant(prev, { streaming: false, finishReason: payload.finishReason }));
      },
      // 流中途出错：错误提示放在当前助手气泡里，不弹窗打断对话
      onError: (message) => {
        setMessages((prev) => patchLastAssistant(prev, { error: message }));
      },
    }, controller.signal)
      .catch((error) => {
        if (controller.signal.aborted) return; // 用户主动取消，不提示错误
        setMessages((prev) => patchLastAssistant(prev, { error: error.message }));
        console.error('[chat] 请求失败:', error.message);
      })
      .finally(() => {
        // 无论成功 / 出错 / 取消，都要恢复「可继续提问」的状态
        setMessages((prev) => patchLastAssistant(prev, { streaming: false }));
        setIsStreaming(false);
        if (abortRef.current === controller) abortRef.current = null;
      });
  }, [isStreaming, currentModel]);

  const modeLabel =
    serverInfo === undefined
      ? '连接中'
      : serverInfo === null
        ? '后端未连接'
        : serverInfo.mode === 'mock'
          ? '模拟模式'
          : '百炼在线';
  const models = Array.isArray(serverInfo?.models) && serverInfo.models.length > 0
    ? serverInfo.models
    : ['qwen-plus'];
  const modelValue = currentModel || models[0];

  return (
    <div className="page-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="dot-grid" aria-hidden="true" />

      <main className="chat-card">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M5 16c3-7 6-7 9 0s6 7 9 0 4-5 4-5" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="6" cy="16" r="2.2" fill="white" />
              </svg>
            </div>
            <div className="brand-text">
              <h1>流式 AI 助手</h1>
              <p>Streaming Chat · SSE Demo</p>
            </div>
          </div>
          <div className="badges">
            <span className="badge">
              <span className={`badge-dot ${serverInfo?.mode === 'mock' ? 'is-mock' : ''}`} />
              {modeLabel}
            </span>
            <ModelSelect
              models={models}
              value={modelValue}
              onChange={setCurrentModel}
              disabled={isStreaming || !serverInfo}
            />
          </div>
        </header>

        <ChatWindow messages={messages} onExampleClick={handleSend} isStreaming={isStreaming} />
        <ChatInput onSend={handleSend} isStreaming={isStreaming} modeLabel={modeLabel} />
      </main>

      <p className="page-footnote">
        Node + Express · 阿里云百炼 · SSE 流式传输 · React + Markdown
      </p>
    </div>
  );
}
