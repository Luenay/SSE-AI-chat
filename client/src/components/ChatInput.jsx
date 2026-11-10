import { useState } from 'react';

export default function ChatInput({ onSend, isStreaming, modeLabel }) {
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setValue('');
  };

  const handleKeyDown = (event) => {
    // isComposing 用来避开中文输入法选词时的回车
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题，例如：用三句话解释 SSE"
          aria-label="输入问题"
          rows={1}
          disabled={isStreaming}
        />
        <button
          type="button"
          className="send-button"
          onClick={submit}
          disabled={isStreaming || value.trim() === ''}
          aria-label={isStreaming ? '正在生成回答' : '发送问题'}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="composer-hint">
        <span>Enter 发送 · Shift + Enter 换行</span>
        <span className="hint-mode">{isStreaming ? '正在生成…' : modeLabel}</span>
      </p>
    </div>
  );
}
