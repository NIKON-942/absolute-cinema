import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { AuthShell } from '@/components/AuthShell';
import { Spinner } from '@/components/Spinner';

/**
 * OAuth landing page: the backend redirects here with the JWT in the URL
 * FRAGMENT (`#token=<jwt>`, never sent to any server). We store the token,
 * fetch `me` and go home.
 */
export default function OAuthSuccess() {
  const { t } = useLanguage();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Prefer the fragment; fall back to ?token= for older links.
    let token = searchParams.get('token');
    const hashMatch = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
    if (hashMatch) {
      token = decodeURIComponent(hashMatch[1]);
      // Scrub the fragment so the JWT doesn't linger in history/address bar.
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    }
    if (!token) {
      setFailed(true);
      return;
    }
    loginWithToken(token)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setFailed(true));
  }, [searchParams, loginWithToken, navigate]);

  return (
    <AuthShell title={failed ? t('auth.oauth.errorTitle') : t('auth.oauth.successTitle')}>
      {failed ? (
        <div className="rounded-xl border border-cinema-red/50 bg-cinema-red/10 px-4 py-6 text-center" role="alert">
          <span className="mb-2 block text-3xl">😞</span>
          <p className="mb-4 text-sm text-cinema-error">{t('auth.oauth.errorText')}</p>
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
