import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { safeReturnTo } from '@/utils/authReturn';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { errorStatusKey, extractServerMessage, isAxiosStatus } from '@/services/api';
import { AuthShell, GoogleButton, FieldError, authInputClass, authLabelClass, authButtonClass } from '@/components/AuthShell';
import { Spinner } from '@/components/Spinner';
import { isValidEmail } from '@/utils/validation';

export default function Login() {
  const { t } = useLanguage();
  const { login } = useAuth();
  const { error: errorToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const from = safeReturnTo((location.state as { from?: string } | null)?.from ?? new URLSearchParams(location.search).get('returnTo'));
  const sessionExpired = searchParams.get('expired') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!email.trim()) next.email = t('auth.validation.emailRequired');
    else if (!isValidEmail(email)) next.email = t('auth.validation.emailInvalid');
    if (!password) next.password = t('auth.validation.passwordRequired');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBlocked(false);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (isAxiosStatus(err, 403)) {
        setBlocked(true);
        errorToast(t('auth.blockedAccount'));
      } else {
        errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-semibold text-cinema-accent hover:underline">
            {t('nav.register')}
          </Link>
        </>
      }
    >
      {sessionExpired && (
        <div className="mb-4 rounded-xl border border-cinema-amber/40 bg-cinema-amber/10 px-4 py-3 text-sm text-cinema-accent">
          {t('auth.expiredNotice')}
        </div>
      )}
      {blocked && (
        <div className="mb-4 rounded-xl border border-cinema-red/50 bg-cinema-red/10 px-4 py-3 text-sm text-cinema-error" role="alert">
          {t('auth.blockedAccount')}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="login-email" className={authLabelClass}>
            {t('auth.email')}
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
          />
          <FieldError message={errors.email} />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className={authLabelClass}>
              {t('auth.password')}
            </label>
            <Link to="/forgot-password" className="mb-1.5 text-xs font-semibold text-cinema-muted transition hover:text-cinema-accent">
              {t('auth.forgotLink')}
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            aria-invalid={Boolean(errors.password)}
          />
          <FieldError message={errors.password} />
        </div>

        <button type="submit" disabled={submitting} className={`flex items-center justify-center gap-2 ${authButtonClass}`}>
          {submitting && <Spinner size={4} />}
          {submitting ? t('common.loading') : t('auth.login.submit')}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-cinema-muted">
        <span className="h-px flex-1 bg-cinema-border" />
        {t('auth.or')}
        <span className="h-px flex-1 bg-cinema-border" />
      </div>

      <GoogleButton />
    </AuthShell>
  );
}
