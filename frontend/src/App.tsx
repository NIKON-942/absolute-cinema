import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { Navbar } from '@/components/Navbar';
import AppRoutes from '@/routes/AppRoutes';

function SiteFooter() {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-cinema-border bg-cinema-black py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-2 px-4 text-center">
        <p className="text-sm font-semibold text-slate-300">{t('footer.tagline')}</p>
        <p className="text-xs text-cinema-muted">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ToastProvider>
          <div className="flex min-h-screen flex-col bg-cinema-black font-sans text-slate-100">
            <Navbar />
            <main className="flex-1">
              <AppRoutes />
            </main>
            <SiteFooter />
          </div>
        </ToastProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
