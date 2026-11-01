import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  return (
    <div role="group" aria-label={t('theme.label')} className="flex shrink-0 rounded-lg border border-cinema-border bg-cinema-panel p-0.5">
      {(['light', 'dark'] as const).map(value => (
        <button key={value} type="button" onClick={() => setTheme(value)} aria-pressed={theme === value}
          aria-label={t(`theme.${value}`)} title={t(`theme.${value}`)}
          className={`cursor-pointer rounded-md p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinema-accent ${theme === value ? 'bg-cinema-amber text-cinema-ink' : 'text-cinema-muted hover:text-cinema-text'}`}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {value === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />}
          </svg>
        </button>
      ))}
    </div>
  );
}
