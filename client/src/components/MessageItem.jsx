import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 只覆盖链接渲染：新窗口打开并带上安全属性。
// react-markdown 默认不渲染原始 HTML（没有启用 rehype-raw），因此无需担心 XSS。
const markdownComponents = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

function AssistantAvatar() {
  return (
    <div className="avatar avatar-ai" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M4 12c2.4-5 4.8-5 7.2 0s4.8 5 7.2 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.2" opacity=".35" />
      </svg>
    </div>
  );
}

function MessageItem({ message }) {
  const isUser = message.role === 'user';
  const isEmptyThinking = !isUser && message.content === '' && message.streaming;

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <AssistantAvatar />}
      <div className="bubble">
        {isUser ? (
          <p className="user-text">{message.content}</p>
        ) : (
          <>
            {isEmptyThinking ? (
              <div className="thinking" aria-label="正在生成">
                <span /><span /><span />
              </div>
            ) : (
              <div className={`markdown-body ${message.streaming ? 'is-streaming' : ''}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
            {message.error && (
              <div className="error-note" role="alert">
                <strong>出错了</strong>
                <span>{message.error}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// 流式时每帧只有最后一条消息的对象引用会变，memo 让历史消息保持不动
export default memo(MessageItem);
