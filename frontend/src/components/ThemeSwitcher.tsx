import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={t(`theme.${nextTheme}`)}
      title={t(`theme.${nextTheme}`)}
      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-cinema-border bg-cinema-panel text-cinema-muted transition hover:border-cinema-amber/60 hover:text-cinema-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinema-accent"
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {nextTheme === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />}
      </svg>
    </button>
  );
}
