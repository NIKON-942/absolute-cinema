import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { UploadProvider, useUploads } from '@/context/UploadContext';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import AppRoutes from '@/routes/AppRoutes';

const UploadPanel = lazy(() => import('@/components/UploadPanel').then(module => ({ default: module.UploadPanel })));
function BackgroundUploads() {
  const { tasks } = useUploads();
  return tasks.length ? <Suspense fallback={null}><UploadPanel /></Suspense> : null;
}

function SiteFooter() {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-cinema-border bg-cinema-black py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 text-center">
        <p className="text-sm font-semibold text-cinema-soft">{t('footer.tagline')}</p>
        <nav aria-label={t('privacy.links')} className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-semibold text-cinema-accent">
          <Link to="/privacy" className="hover:underline">{t('privacy.link')}</Link>
          <Link to="/terms" className="hover:underline">{t('terms.link')}</Link>
        </nav>
        <p className="text-xs text-cinema-muted">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <UploadProvider>
              <div className="flex min-h-screen flex-col bg-cinema-black font-sans text-cinema-text">
                <Navbar />
                <main className="flex-1">
                  <AppRoutes />
                </main>
                <SiteFooter />
                <BackgroundUploads />
              </div>
            </UploadProvider>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
