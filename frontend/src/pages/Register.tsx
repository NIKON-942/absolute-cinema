import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { AuthShell, GoogleButton, FieldError, authInputClass, authLabelClass, authButtonClass } from '@/components/AuthShell';
import { Spinner } from '@/components/Spinner';
import { isValidEmail, isValidPassword } from '@/utils/validation';

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export default function Register() {
  const { t } = useLanguage();
  const { register } = useAuth();
  const { error: errorToast, success } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const validate = (): boolean => {
    const next: FormErrors = {};
    if (!name.trim()) next.name = t('auth.validation.nameRequired');
    else if (name.trim().length < 2) next.name = t('auth.validation.nameMin');
    if (!email.trim()) next.email = t('auth.validation.emailRequired');
    else if (!isValidEmail(email)) next.email = t('auth.validation.emailInvalid');
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
      await register({ name: name.trim(), email: email.trim(), password });
      success(t('auth.register.submit'));
      navigate(from, { replace: true });
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.register.title')}
      subtitle={t('auth.register.subtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-cinema-amber hover:underline">
            {t('nav.login')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="reg-name" className={authLabelClass}>
            {t('auth.name')}
          </label>
          <input
            id="reg-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={authInputClass}
            aria-invalid={Boolean(errors.name)}
          />
          <FieldError message={errors.name} />
        </div>

        <div>
          <label htmlFor="reg-email" className={authLabelClass}>
            {t('auth.email')}
          </label>
          <input
            id="reg-email"
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
          <label htmlFor="reg-password" className={authLabelClass}>
            {t('auth.password')}
          </label>
          <input
            id="reg-password"
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
          <label htmlFor="reg-confirm" className={authLabelClass}>
            {t('auth.confirmPassword')}
          </label>
          <input
            id="reg-confirm"
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
          {submitting ? t('common.loading') : t('auth.register.submit')}
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
