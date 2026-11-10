import { useEffect, useRef } from 'react';
import MessageItem from './MessageItem.jsx';

const EXAMPLES = [
  { title: '理解 SSE', question: '用三句话解释什么是 SSE，以及它和 WebSocket 的区别' },
  { title: '写一段代码', question: '用 React 写一个防抖 Hook，并逐行解释原理' },
  { title: '学习路线', question: '给前端新人列一份三个月的学习路线，用表格呈现' },
];

function EmptyState({ onExampleClick, isStreaming }) {
  return (
    <div className="empty-state">
      <div className="empty-emblem" aria-hidden="true">
        <span className="ring ring-one" />
        <span className="ring ring-two" />
        <span className="ring-core" />
      </div>
      <p className="empty-kicker">READY TO STREAM</p>
      <h2>从一个问题开始</h2>
      <p className="empty-desc">
        回答会一段一段实时到达，标题、列表、代码与表格都会即时排版。
        没配置密钥也没关系，模拟模式同样能看到完整的流式过程。
      </p>
      <div className="example-grid">
        {EXAMPLES.map((item, index) => (
          <button
            key={item.title}
            type="button"
            className="example-card"
            onClick={() => onExampleClick(item.question)}
            disabled={isStreaming}
          >
            <span className="example-index">0{index + 1}</span>
            <span className="example-title">{item.title}</span>
            <span className="example-question">{item.question}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatWindow({ messages, onExampleClick, isStreaming }) {
  const listRef = useRef(null);

  // 每来一段文本就滚到底部。流式期间不用平滑滚动，否则连续触发会抖动。
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="message-list" ref={listRef} aria-live="polite" aria-label="对话消息">
      {messages.length === 0 ? (
        <EmptyState onExampleClick={onExampleClick} isStreaming={isStreaming} />
      ) : (
        <div className="message-stack">
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}
