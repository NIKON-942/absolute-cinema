import { useLanguage } from '@/context/LanguageContext';

export function LanguageSwitcher() {
  const { lang, setLang, t } = useLanguage();
  const nextLang = lang === 'uk' ? 'en' : 'uk';
  const label = `${t('common.language')}: ${nextLang === 'en' ? 'English' : 'Українська'}`;
  return (
    <button
      type="button"
      onClick={() => setLang(nextLang)}
      aria-label={label}
      title={label}
      className="inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-cinema-border bg-cinema-panel px-2 text-xs font-bold text-cinema-muted transition hover:border-cinema-amber/60 hover:text-cinema-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinema-accent"
    >
      {nextLang.toUpperCase()}
    </button>
  );
}
