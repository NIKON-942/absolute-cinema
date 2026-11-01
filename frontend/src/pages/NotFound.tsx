import { Link } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
      <span className="mb-6 text-7xl">🎬</span>
      <h1 className="mb-2 text-3xl font-extrabold text-slate-50">{t('notfound.title')}</h1>
      <p className="mb-8 text-sm text-cinema-muted">{t('notfound.text')}</p>
      <Link to="/" className="rounded-xl bg-cinema-amber px-6 py-3 font-bold text-cinema-black transition hover:shadow-glow">
        {t('notfound.back')}
      </Link>
    </div>
  );
}
