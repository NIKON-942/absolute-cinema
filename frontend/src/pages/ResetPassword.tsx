import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/context/ToastContext';
import { authService } from '@/services/authService';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { AuthShell, FieldError, authInputClass, authLabelClass, authButtonClass } from '@/components/AuthShell';
import { Spinner } from '@/components/Spinner';
import { isValidPassword } from '@/utils/validation';

export default function ResetPassword() {
  const { t } = useLanguage();
  const { error: errorToast } = useToast();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!password) next.password = t('auth.validation.passwordRequired');
    else if (password.length < 8) next.password = t('auth.validation.passwordMin');
    else if (!isValidPassword(password)) next.password = t('auth.validation.passwordPattern');
    if (confirm !== password) next.confirm = t('auth.validation.passwordMismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await authService.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title={t('auth.reset.title')}>
        <div className="rounded-xl border border-cinema-red/50 bg-cinema-red/10 px-4 py-5 text-center" role="alert">
          <span className="mb-2 block text-3xl">🔗</span>
          <p className="text-sm text-cinema-error">{t('auth.validation.tokenMissing')}</p>
          <Link to="/forgot-password" className="mt-3 inline-block font-semibold text-cinema-accent hover:underline">
            {t('auth.forgot.submit')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')}>
      {done ? (
        <div className="rounded-xl border border-cinema-success/40 bg-cinema-success-surface/40 px-4 py-5 text-center" role="status">
          <span className="mb-2 block text-3xl">✅</span>
          <p className="mb-4 text-sm leading-relaxed text-cinema-success">{t('auth.reset.success')}</p>
          <Link to="/login" className="inline-block rounded-xl bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink transition hover:shadow-glow">
            {t('auth.reset.toLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="reset-password" className={authLabelClass}>
              {t('auth.password')}
            </label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
              aria-invalid={Boolean(errors.password)}
            />
            <FieldError message={errors.password} />
          </div>
          <div>
            <label htmlFor="reset-confirm" className={authLabelClass}>
              {t('auth.confirmPassword')}
            </label>
            <input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={authInputClass}
              aria-invalid={Boolean(errors.confirm)}
            />
            <FieldError message={errors.confirm} />
          </div>
          <button type="submit" disabled={submitting} className={`flex items-center justify-center gap-2 ${authButtonClass}`}>
            {submitting && <Spinner size={4} />}
            {submitting ? t('common.loading') : t('auth.reset.submit')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
