import { useLanguage } from '@/context/LanguageContext';

export function LanguageSwitcher() {
  const { lang, setLang, t } = useLanguage();
  return (
    <div className="flex items-center rounded-lg border border-cinema-border bg-cinema-panel p-0.5 text-xs font-bold" role="group" aria-label={t('common.language')}>
      <button
        type="button"
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        className={`cursor-pointer rounded-md px-2 py-1 transition ${
          lang === 'en' ? 'bg-cinema-amber text-cinema-ink' : 'text-cinema-muted hover:text-cinema-text'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang('uk')}
        aria-pressed={lang === 'uk'}
        className={`cursor-pointer rounded-md px-2 py-1 transition ${
          lang === 'uk' ? 'bg-cinema-amber text-cinema-ink' : 'text-cinema-muted hover:text-cinema-text'
        }`}
      >
        UK
      </button>
    </div>
  );
}
