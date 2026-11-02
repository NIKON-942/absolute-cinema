import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { resolveMediaUrl } from '@/utils/url';

interface ImageFieldProps {
  id: string;
  label: string;
  value: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onUrlChange: (url: string) => void;
  portrait?: boolean;
  disabled?: boolean;
}

/** File attachment is the default; external links are an optional disclosure. */
export function ImageField({ id, label, value, file, onFileChange, onUrlChange, portrait = false, disabled = false }: ImageFieldProps) {
  const { t } = useLanguage();
  const [filePreview, setFilePreview] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!file) { setFilePreview(''); return; }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const preview = file ? filePreview : resolveMediaUrl(value);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-cinema-muted">{label}</label>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-cinema-border bg-cinema-black/30 p-3">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-cinema-border bg-cinema-card ${portrait ? 'h-24 w-16 rounded-lg' : 'h-20 w-20 rounded-2xl'}`}>
          {preview ? <img src={preview} alt={label} className="h-full w-full object-cover" /> : (
            <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cinema-muted">
              <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" />
            </svg>
          )}
        </div>
        <div className="min-w-[10rem] flex-1 space-y-2">
          <input id={id} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={disabled} className="peer sr-only" aria-describedby={`${id}-hint`} aria-invalid={Boolean(error)}
            onChange={event => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              if (!selected) return;
              if (!/\.(jpe?g|png|webp)$/i.test(selected.name) || selected.size > 5 * 1024 * 1024) {
                setError(t('images.invalid')); return;
              }
              setError(''); onFileChange(selected); onUrlChange('');
            }} />
          <label htmlFor={id} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-cinema-border bg-cinema-panel px-3 py-2 text-sm font-semibold text-cinema-text transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cinema-accent ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:border-cinema-amber/60 hover:text-cinema-accent'}`}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
            {t('images.attach')}
          </label>
          <p id={`${id}-hint`} className="text-xs text-cinema-muted">{t('images.hint')}</p>
          {file && <p className="break-all text-xs text-cinema-soft">{file.name}</p>}
          {(file || value) && <button type="button" disabled={disabled}
            onClick={() => { onFileChange(null); onUrlChange(''); setError(''); }}
            className="text-xs font-semibold text-cinema-muted underline underline-offset-2 hover:text-cinema-error disabled:opacity-60">{t('images.remove')}</button>}
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-cinema-error">{error}</p>}
      <details className="text-sm text-cinema-muted">
        <summary className="cursor-pointer py-1 text-xs font-semibold hover:text-cinema-text">{t('images.useUrl')}</summary>
        <label htmlFor={`${id}-url`} className="sr-only">{t('images.url')}</label>
        <input id={`${id}-url`} type="url" value={value.startsWith('/api/') ? '' : value} placeholder="https://…" disabled={disabled}
          onChange={event => { onFileChange(null); onUrlChange(event.target.value); setError(''); }}
          className="mt-2 w-full rounded-lg border border-cinema-border bg-cinema-panel px-3 py-2 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none" />
      </details>
    </div>
  );
}
