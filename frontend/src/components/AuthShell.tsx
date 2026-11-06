import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { googleAuthUrl } from '@/utils/url';
import { safeReturnTo } from '@/utils/authReturn';
import { BrandIcon } from '@/components/BrandIcon';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centered card layout shared by the auth pages (login/register/forgot/reset). */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md animate-fadeIn rounded-2xl border border-cinema-border bg-cinema-panel/80 p-6 shadow-card sm:p-8">
        <div className="mb-6 text-center">
          <Link to="/" className="mb-4 inline-flex items-center gap-2" aria-label="AbsoluteCinema">
            <BrandIcon />
            <span className="text-xl font-extrabold tracking-tight text-cinema-text">
              Absolute<span className="text-cinema-accent">Cinema</span>
            </span>
          </Link>
          <h1 className="text-2xl font-extrabold text-cinema-strong">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-cinema-muted">{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-cinema-muted">{footer}</div>}
        <PrivacyLink />
      </div>
    </div>
  );
}

function PrivacyLink() {
  const { t } = useLanguage();
  return <p className="mt-4 text-center text-xs"><Link to="/privacy" className="text-cinema-accent hover:underline">{t('privacy.link')}</Link></p>;
}

/** Google OAuth button — navigates the browser to the backend OAuth entry point. */
export function GoogleButton() {
  const { t } = useLanguage();
  const location = useLocation();
  const returnTo = safeReturnTo((location.state as { from?: string } | null)?.from ?? new URLSearchParams(location.search).get('returnTo'));
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = googleAuthUrl(returnTo);
      }}
      className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-cinema-border bg-cinema-black/60 px-4 py-3 text-sm font-semibold text-cinema-text transition hover:border-cinema-muted/60 hover:bg-cinema-black"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.6-.2-2.3H12v4.5h6.5c-.1 1-.8 2.6-2.2 3.6l3.6 2.8c2.1-1.9 3.6-4.8 3.6-8.6z" />
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.6-2.8c-1 .7-2.4 1.2-4.3 1.2-3.3 0-6.1-2.2-7.1-5.2l-3.8 2.9C3.1 21.3 7.2 24 12 24z" />
        <path fill="#FBBC05" d="M4.9 14.3c-.3-.8-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.1 6.8C.4 8.4 0 10.1 0 12s.4 3.6 1.1 5.2l3.8-2.9z" />
        <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.2-3.1C16.9 1.1 14.7 0 12 0 7.2 0 3.1 2.7 1.1 6.8l3.8 2.9c1-3 3.8-5 7.1-5z" />
      </svg>
      {t('auth.login.google')}
    </button>
  );
}

/** Field-level validation message. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-cinema-red">{message}</p>;
}

export const authInputClass =
  'w-full rounded-xl border border-cinema-border bg-cinema-black/60 px-4 py-3 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none focus:ring-1 focus:ring-cinema-amber/40';

export const authLabelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-cinema-muted';

export const authButtonClass =
  'w-full cursor-pointer rounded-xl bg-cinema-amber px-4 py-3 text-sm font-bold text-cinema-ink transition hover:shadow-glow disabled:cursor-default disabled:opacity-60';
