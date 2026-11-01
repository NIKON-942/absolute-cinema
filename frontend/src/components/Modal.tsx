import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-8 flex max-h-[calc(100dvh-4rem)] w-full animate-popIn flex-col rounded-2xl border border-cinema-border bg-cinema-panel shadow-card ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-cinema-border px-6 py-4">
          <h2 className="text-lg font-bold text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="cursor-pointer rounded-md p-1 text-cinema-muted transition hover:bg-cinema-card hover:text-slate-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-3 border-t border-cinema-border px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
