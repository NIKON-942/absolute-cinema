import { ArrowLeft, Mail } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/context/ToastContext';
import { authService } from '@/services/authService';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { AuthShell, FieldError, authInputClass, authLabelClass, authButtonClass } from '@/components/AuthShell';
import { Spinner } from '@/components/Spinner';
import { isValidEmail } from '@/utils/validation';

export default function ForgotPassword() {
  const { t } = useLanguage();
  const { error: errorToast } = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('auth.validation.emailRequired'));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t('auth.validation.emailInvalid'));
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await authService.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Link to="/login" className="font-semibold text-cinema-accent hover:underline">
          <ArrowLeft size={16} aria-hidden="true" className="inline-block shrink-0 align-middle" /> {t('auth.forgot.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-xl border border-cinema-success/40 bg-cinema-success-surface/40 px-4 py-5 text-center" role="status">
          <span className="mb-2 block text-3xl"><Mail size="1em" aria-hidden="true" className="inline-block shrink-0 align-middle" /></span>
          <p className="text-sm leading-relaxed text-cinema-success">{t('auth.forgot.sent')}</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className={authLabelClass}>
              {t('auth.email')}
            </label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
              placeholder="you@example.com"
              aria-invalid={Boolean(error)}
            />
            <FieldError message={error} />
          </div>
          <button type="submit" disabled={submitting} className={`flex items-center justify-center gap-2 ${authButtonClass}`}>
            {submitting && <Spinner size={4} />}
            {submitting ? t('common.loading') : t('auth.forgot.submit')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
