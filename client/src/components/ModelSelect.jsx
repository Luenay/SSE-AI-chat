import { useEffect, useRef, useState } from 'react';

/**
 * 自定义模型下拉框。
 *
 * 为什么不用原生 <select>：浏览器原生弹出层的圆角、边框和蓝色选中高亮
 * 由系统绘制，CSS 基本改不动，和页面的玻璃质感不搭，所以自己实现一个。
 *
 * 仍保留必要的可访问性：aria-haspopup / aria-expanded / role=listbox、
 * Esc 关闭、点击外部关闭、上下键移动、Enter 选中。
 */
export default function ModelSelect({ models, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  // 点击组件外面就收起面板
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  // 生成中禁用时，不允许面板停留在打开状态
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggle = () => {
    if (disabled) return;
    setActiveIndex(Math.max(0, models.indexOf(value)));
    setOpen((prev) => !prev);
  };

  const choose = (name) => {
    onChange(name);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((prev) => (prev + step + models.length) % models.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      // 阻止按钮原生的 click，避免和这里的逻辑重复触发
      event.preventDefault();
      if (!open) setOpen(true);
      else choose(models[activeIndex]);
    }
  };

  return (
    <div className="model-select" ref={wrapRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={`model-trigger ${open ? 'is-open' : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择对话使用的模型"
        title="选择本次对话使用的模型"
      >
        <svg className="model-trigger-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2.2" fill="currentColor" />
        </svg>
        <span className="model-trigger-text">{value}</span>
        <svg className="model-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="model-menu" role="listbox" aria-label="可用模型">
          <p className="model-menu-label">选择模型</p>
          {models.map((name, index) => {
            const selected = name === value;
            return (
              <button
                type="button"
                key={name}
                role="option"
                aria-selected={selected}
                className={`model-option ${selected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(name)}
              >
                <span className="model-option-dot" aria-hidden="true" />
                <span className="model-option-name">{name}</span>
                {selected && (
                  <svg className="model-option-check" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="m5 10 3.5 3.5L15 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
