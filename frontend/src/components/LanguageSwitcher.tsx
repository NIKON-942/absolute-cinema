import { useLanguage } from '@/context/LanguageContext';

export function LanguageSwitcher() {
  const { lang, setLang, t } = useLanguage();
  return (
    <div className="flex items-center rounded-lg border border-cinema-border bg-cinema-panel p-0.5 text-xs font-bold" role="group" aria-label={t('common.language')}>
      <button
        type="button"
        onClick={() => setLang('en')}
        className={`cursor-pointer rounded-md px-2 py-1 transition ${
          lang === 'en' ? 'bg-cinema-amber text-cinema-black' : 'text-cinema-muted hover:text-slate-100'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang('uk')}
        className={`cursor-pointer rounded-md px-2 py-1 transition ${
          lang === 'uk' ? 'bg-cinema-amber text-cinema-black' : 'text-cinema-muted hover:text-slate-100'
        }`}
      >
        UK
      </button>
    </div>
  );
}
