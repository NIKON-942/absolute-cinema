import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { AuthShell } from '@/components/AuthShell';
import { authService } from '@/services/authService';
import { safeReturnTo } from '@/utils/authReturn';
import { Spinner } from '@/components/Spinner';

/** Exchange the short-lived, browser-bound OAuth code once; never accept JWTs from URLs. */
export default function OAuthSuccess() {
  const { t } = useLanguage();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const [failed, setFailed] = useState(Boolean(error));
  const errorKey = ['cancelled','unavailable','state','linkRequired','conflict'].includes(error ?? '') ? `auth.google.${error}` : 'auth.oauth.errorText';
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code');
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (error || !code) { setFailed(true); return; }
    authService.exchangeGoogle(code)
      .then(async result => {
        await loginWithToken(result.accessToken);
        navigate(safeReturnTo(result.returnTo), { replace: true });
      })
      .catch(() => setFailed(true));
  }, [searchParams, loginWithToken, navigate]);

  return (
    <AuthShell title={failed ? t('auth.oauth.errorTitle') : t('auth.oauth.successTitle')}>
      {failed ? (
        <div className="rounded-xl border border-cinema-red/50 bg-cinema-red/10 px-4 py-6 text-center" role="alert">
          <span className="mb-2 block text-3xl">😞</span>
          <p className="mb-4 text-sm text-cinema-error">{t(errorKey)}</p>
          <Link to="/login" className="inline-block rounded-xl bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink transition hover:shadow-glow">
            {t('auth.oauth.toLogin')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-cinema-muted">
          <Spinner size={10} />
          <p className="text-sm">{t('auth.oauth.successText')}</p>
        </div>
      )}
    </AuthShell>
  );
}
