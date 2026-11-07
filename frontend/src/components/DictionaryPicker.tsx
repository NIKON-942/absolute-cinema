import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { errorStatusKey, isAxiosStatus } from '@/services/api';

interface DictionaryItem { id: number; name: string }
const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Keep newly created entries available even if the movie form is cancelled. */
export function useMovieDictionary<T extends DictionaryItem>(load: () => Promise<T[]>, create: (name: string) => Promise<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reload = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const entries = await load();
      setItems(entries);
      return entries;
    } catch (error) {
      setFailed(true);
      throw error;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload().catch(() => undefined); }, [load]); // load is a stable service method

  const add = async (name: string) => {
    const existing = items.find(item => normalize(item.name) === normalize(name));
    if (existing) return existing;
    try {
      const item = await create(name.trim().replace(/\s+/g, ' '));
      setItems(previous => [...previous.filter(entry => entry.id !== item.id), item]);
      return item;
    } catch (error) {
      if (isAxiosStatus(error, 409)) {
        // Another administrator may have added the same entry since we loaded.
        const entries = await reload();
        const match = entries.find(item => normalize(item.name) === normalize(name));
        if (match) return match;
      }
      throw error;
    }
  };
  return { items, loading, failed, reload, add };
}

interface Props {
  id: string;
  label: string;
  dictionary: ReturnType<typeof useMovieDictionary<DictionaryItem>>;
  selected: number[];
  onChange: (ids: number[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function DictionaryPicker({ id, label, dictionary, selected, onChange, multiple = false, disabled, onBusyChange }: Props) {
  const { t, lang } = useLanguage();
  const { items, loading, failed, reload, add } = dictionary;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const normalized = normalize(query);
  const matches = items.filter(item => normalize(item.name).includes(normalized))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  const exact = items.find(item => normalize(item.name) === normalized);
  const locked = disabled || busy || loading || failed;

  const choose = (item: DictionaryItem) => {
    onChange(multiple
      ? selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id]
      : [item.id]);
    setQuery('');
    setError(null);
    input.current?.focus();
    if (!multiple) setOpen(false);
  };

  const create = async () => {
    if (locked || creating.current || !normalized) return;
    if (exact) { choose(exact); return; }
    creating.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const item = await add(query);
      onChange(multiple ? [...new Set([...selected, item.id])] : [item.id]);
      setQuery('');
      setOpen(false);
    } catch (err) {
      setError(t(isAxiosStatus(err, 409) ? 'admin.dictionary.duplicate' : errorStatusKey(err)));
    } finally {
      creating.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          input.current?.focus();
          setOpen(false);
        }
      }}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cinema-muted">{label}</label>
      {selected.length > 0 && <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('admin.dictionary.selected', { field: label })}>
        {selected.map(value => {
          const item = items.find(entry => entry.id === value);
          return <li key={value} className="inline-flex max-w-full items-center gap-1 rounded-full border border-cinema-amber/50 bg-cinema-amber/15 px-2.5 py-1 text-xs text-cinema-accent">
            <span className="break-words">{item?.name ?? `#${value}`}</span>
            <button type="button" disabled={disabled || busy} onClick={() => onChange(selected.filter(id => id !== value))}
              aria-label={t('admin.dictionary.remove', { name: item?.name ?? value })}
              className="shrink-0 rounded px-1 text-base hover:bg-cinema-card disabled:opacity-50">×</button>
          </li>;
        })}
      </ul>}
      <input ref={input} id={id} type="search" autoComplete="off" maxLength={255} value={query}
        disabled={locked} aria-expanded={open} aria-controls={`${id}-options`} aria-describedby={`${id}-hint`}
        placeholder={t('admin.dictionary.search')} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setOpen(true); setError(null); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => document.getElementById(`${id}-options`)?.querySelector<HTMLInputElement>('input')?.focus());
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!locked && (exact || matches.length === 1)) choose(exact ?? matches[0]);
            else setOpen(true);
          }
        }}
        className="w-full rounded-lg border border-cinema-border bg-cinema-black/60 px-3 py-2 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none disabled:opacity-50" />
      <p id={`${id}-hint`} className="mt-1 text-xs text-cinema-muted">{t('admin.dictionary.hint')}</p>
      {loading && <p role="status" className="mt-1 text-xs text-cinema-muted">{t('common.loading')}</p>}
      {failed && <div role="alert" className="mt-2 text-xs text-cinema-error">
        {t('admin.dictionary.loadFailed')}{' '}
        <button type="button" disabled={disabled || loading} className="underline" onClick={() => void reload().catch(() => undefined)}>{t('admin.dictionary.retry')}</button>
      </div>}
      {open && !loading && !failed && <div id={`${id}-options`} className="mt-2 rounded-lg border border-cinema-border bg-cinema-black/40 p-2">
        <div className="max-h-40 space-y-1 overflow-y-auto" role="group" aria-label={label}>
          {matches.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-cinema-soft hover:bg-cinema-card">
            <input type={multiple ? 'checkbox' : 'radio'} name={`${id}-choice`} checked={selected.includes(item.id)}
              disabled={disabled || busy} onChange={() => choose(item)} className="accent-cinema-amber" />
            <span className="break-words">{item.name}</span>
          </label>)}
          {matches.length === 0 && <p className="px-2 py-1 text-xs text-cinema-muted">{t('admin.dictionary.noResults')}</p>}
        </div>
        {normalized && !exact && <><button type="button" disabled={locked} onClick={() => void create()}
          className="mt-2 w-full break-words rounded-lg border border-cinema-amber/50 px-3 py-2 text-left text-sm text-cinema-accent hover:bg-cinema-amber/10 disabled:opacity-50">
          {busy ? t('common.loading') : t('admin.dictionary.create', { name: query.trim() })}
        </button><p className="mt-1 text-xs text-cinema-muted">{t('admin.dictionary.savedImmediately')}</p></>}
      </div>}
      {busy && <p role="status" className="mt-1 text-xs text-cinema-muted">{t('common.loading')}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-cinema-error">{error}</p>}
    </div>
  );
}
