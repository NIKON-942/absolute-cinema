import { useEffect, useLayoutEffect, useRef } from 'react';

interface AutoTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum height in rows (default 3). */
  minRows?: number;
  /** Height cap in px — beyond it the field scrolls (default 288). */
  maxHeight?: number;
}

/**
 * Textarea that grows with its content between minRows and maxHeight,
 * instead of being an endlessly resizable box.
 */
export function AutoTextarea({
  minRows = 3,
  maxHeight = 288,
  className = '',
  value,
  ...rest
}: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useLayoutEffect(resize, [value, maxHeight]);
  useEffect(() => {
    // recalc when fonts finish loading
    document.fonts?.ready?.then(resize).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onInput={resize}
      className={`${className} resize-none`}
      {...rest}
    />
  );
}
