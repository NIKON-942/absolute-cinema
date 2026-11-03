import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { authService } from '@/services/authService';
import { mediaService } from '@/services/mediaService';
import { usersService } from '@/services/usersService';
import { paymentsService } from '@/services/paymentsService';
import { devicesService } from '@/services/devicesService';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { MovieCard } from '@/components/MovieCard';
import { EmptyState } from '@/components/EmptyState';
import { Spinner } from '@/components/Spinner';
import { FieldError } from '@/components/AuthShell';
import { Modal } from '@/components/Modal';
import { ImageField } from '@/components/ImageField';
import { formatDate, formatDuration } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/url';
import { posterGradient } from '@/utils/format';
import { getDeviceId } from '@/utils/plans';
import { isValidPassword } from '@/utils/validation';
import type { DeviceSessionDto, MovieDto, WatchProgressDto } from '@/types';

const inputClass =
  'w-full rounded-lg border border-cinema-border bg-cinema-black/60 px-3.5 py-2.5 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-cinema-muted';

export default function Profile() {
  const { t, lang } = useLanguage();
  const { user, setUser, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const { success, error: errorToast } = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    password?: string;
    avatarUrl?: string;
    currentPassword?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const linkGoogle = async () => {
    setLinkingGoogle(true);
    try { const { url } = await authService.linkGoogle(); window.location.assign(url); }
    catch (err) { errorToast(extractServerMessage(err) ?? t('auth.google.unavailable')); setLinkingGoogle(false); }
  };

  const [favorites, setFavorites] = useState<MovieDto[] | null>(null);
  const [progress, setProgress] = useState<WatchProgressDto[] | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [devices, setDevices] = useState<DeviceSessionDto[] | null>(null);
  const [maxDevices, setMaxDevices] = useState(0);
  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const currentDeviceId = getDeviceId();

  const loadDevices = () => {
    devicesService
      .list()
      .then((d) => {
        setDevices(d.devices);
        setMaxDevices(d.maxDevices);
      })
      .catch(() => setDevices([]));
  };

  const onDisconnectDevice = async (deviceId: string) => {
    setBusyDevice(deviceId);
    try {
      await devicesService.revoke(deviceId);
      success(t('profile.devices.disconnected'));
      loadDevices();
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setBusyDevice(null);
    }
  };

  const onCancelSubscription = async () => {
    setCancelling(true);
    try {
      await paymentsService.cancelSubscription();
      const updated = await refreshMe();
      if (updated) setUser(updated);
      setCancelOpen(false);
      success(t('profile.subscription.cancelled'));
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    mediaService.favorites().then((f) => !cancelled && setFavorites(f)).catch(() => !cancelled && setFavorites([]));
    mediaService.progress().then((p) => !cancelled && setProgress(p)).catch(() => !cancelled && setProgress([]));
    if (user?.hasActiveSubscription) loadDevices();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.hasActiveSubscription]);

  if (!user) return null;

  const sub = user.activeSubscription;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = t('auth.validation.nameRequired');
    else if (name.trim().length < 2) next.name = t('auth.validation.nameMin');
    if (password && !isValidPassword(password)) next.password = t('auth.validation.passwordPattern');
    if (password && !currentPassword) next.currentPassword = t('profile.account.currentPasswordRequired');
    if (!avatarFile && avatarUrl.trim() && avatarUrl !== user.avatarUrl && !/^https?:\/\/.+/i.test(avatarUrl.trim())) next.avatarUrl = t('profile.account.avatarUrlInvalid');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const updated = await usersService.updateMe({
        name: name.trim(),
        file: avatarFile,
        ...(avatarUrl.trim() !== (user.avatarUrl ?? '') ? { avatarUrl: avatarUrl.trim() || null } : {}),
        ...(password ? { password, currentPassword } : {}),
      });
      setUser(updated);
      setAvatarUrl(updated.avatarUrl ?? '');
      setAvatarFile(null);
      setPassword('');
      setCurrentPassword('');
      success(t('profile.account.saved'));
      if (password) {
        logout();
        navigate('/login', { replace: true });
      }
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const onToggleFavorite = (movie: MovieDto, isFavorite: boolean) => {
    setFavorites((prev) => (prev ? (isFavorite ? prev.map((m) => (m.id === movie.id ? { ...m, isFavorite } : m)) : prev.filter((m) => m.id !== movie.id)) : prev));
  };

  const continueWatching = (progress ?? []).filter((p) => p.durationSeconds > 0 && p.positionSeconds < p.durationSeconds - 15);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-center gap-4">
        {user.avatarUrl ? (
          <img src={resolveMediaUrl(user.avatarUrl)} alt={user.name} className="h-16 w-16 rounded-2xl border border-cinema-border object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cinema-amber to-cinema-gold text-2xl font-black text-cinema-ink">
            {user.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold text-cinema-strong sm:text-3xl">{t('profile.title')}</h1>
          <p className="text-sm text-cinema-muted">{t('profile.subtitle')}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${user.hasActiveSubscription ? 'bg-cinema-success-surface/60 text-cinema-success' : 'bg-cinema-card text-cinema-muted'}`}>
          {user.hasActiveSubscription ? t('subscription.active') : t('subscription.none')}
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* account form */}
        <section className="rounded-2xl border border-cinema-border bg-cinema-panel/60 p-6">
          <h2 className="mb-5 text-lg font-bold text-cinema-text">{t('profile.account.title')}</h2>
          <div className="mb-5 rounded-xl border border-cinema-border bg-cinema-card/50 p-4">
            <p className="text-sm font-semibold text-cinema-text">{t(user.googleLinked ? 'auth.google.linked' : 'auth.google.linkHint')}</p>
            {!user.googleLinked && <button type="button" onClick={() => void linkGoogle()} disabled={linkingGoogle} className="mt-3 rounded-lg bg-cinema-amber px-4 py-2 text-sm font-bold text-cinema-ink disabled:opacity-60">{t(linkingGoogle ? 'common.loading' : 'auth.google.link')}</button>}
          </div>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="profile-name" className={labelClass}>
                {t('profile.account.name')}
              </label>
              <input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                aria-invalid={Boolean(errors.name)}
              />
              <FieldError message={errors.name} />
            </div>
            <div>
              <label className={labelClass}>{t('profile.account.email')}</label>
              <input type="email" value={user.email} readOnly className={`${inputClass} cursor-not-allowed opacity-60`} />
            </div>
            <div>
              <ImageField id="profile-avatar" label={t('profile.account.avatar')}
                value={avatarUrl} file={avatarFile} onFileChange={setAvatarFile} onUrlChange={setAvatarUrl} disabled={saving} />
              <FieldError message={errors.avatarUrl} />
            </div>
            <div>
              <label htmlFor="profile-password" className={labelClass}>
                {t('profile.account.newPassword')}{' '}
                <span className="font-normal normal-case text-cinema-muted">({t('common.optional')})</span>
              </label>
              <input
                id="profile-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
                aria-invalid={Boolean(errors.password)}
              />
              <FieldError message={errors.password} />
              <p className="mt-1.5 text-xs text-cinema-muted">{t('profile.account.passwordHint')}</p>
            </div>
            {password && (
              <div>
                <label htmlFor="profile-current-password" className={labelClass}>
                  {t('profile.account.currentPassword')}
                </label>
                <input
                  id="profile-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                  aria-invalid={Boolean(errors.currentPassword)}
                />
                <FieldError message={errors.currentPassword} />
              </div>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-cinema-amber px-5 py-2.5 text-sm font-bold text-cinema-ink transition hover:shadow-glow disabled:cursor-default disabled:opacity-60"
            >
              {saving && <Spinner size={4} />}
              {t('profile.account.save')}
            </button>
          </form>
        </section>

        {/* subscription card */}
        <section className="rounded-2xl border border-cinema-border bg-cinema-panel/60 p-6">
          <h2 className="mb-5 text-lg font-bold text-cinema-text">{t('profile.subscription.title')}</h2>
          {user.hasActiveSubscription && sub ? (
            <div>
              <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-cinema-amber/40 bg-gradient-to-r from-cinema-amber/15 to-transparent px-4 py-3">
                <div>
                  <p className="text-lg font-extrabold text-cinema-accent">{t('tier.' + sub.tier)}</p>
                  <p className="text-xs text-cinema-muted">{t('sub.period.' + sub.period)}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    sub.status === 'active' ? 'bg-cinema-success-surface/60 text-cinema-success' : 'bg-cinema-card text-cinema-muted'
                  }`}
                >
                  {t('sub.status.' + sub.status)}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt className="text-cinema-muted">{t('profile.subscription.startsAt')}</dt>
                <dd className="text-right font-semibold text-cinema-soft">{formatDate(sub.startsAt)}</dd>
                <dt className="text-cinema-muted">{t('profile.subscription.endsAt')}</dt>
                <dd className="text-right font-semibold text-cinema-soft">{formatDate(sub.endsAt)}</dd>
                <dt className="text-cinema-muted">{t('profile.subscription.autoRenew')}</dt>
                <dd className="text-right font-semibold text-cinema-soft">
                  {sub.autoRenew ? '✓' : '—'}
                </dd>
              </dl>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/plans"
                  className="inline-block rounded-xl border border-cinema-border px-5 py-2.5 text-sm font-semibold text-cinema-soft transition hover:border-cinema-amber/60 hover:text-cinema-accent"
                >
                  {t('plans.title')}
                </Link>
                {sub.status === 'active' && !sub.cancelAtPeriodEnd && (
                  <button
                    type="button"
                    onClick={() => setCancelOpen(true)}
                    className="cursor-pointer rounded-xl border border-cinema-red/50 px-5 py-2.5 text-sm font-semibold text-cinema-red transition hover:bg-cinema-red/10"
                  >
                    {t('profile.subscription.cancel')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="text-4xl">🔓</span>
              <p className="font-semibold text-cinema-text">{t('profile.subscription.none')}</p>
              <p className="max-w-xs text-sm text-cinema-muted">{t('profile.subscription.noneHint')}</p>
              <Link to="/plans" className="mt-2 rounded-xl bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink transition hover:shadow-glow">
                {t('profile.subscription.viewPlans')}
              </Link>
            </div>
          )}
        </section>

        {/* devices — concurrent-stream slots of the current plan */}
        {user.hasActiveSubscription && (
          <section className="rounded-2xl border border-cinema-border bg-cinema-panel/60 p-6 lg:col-span-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-cinema-text">{t('profile.devices.title')}</h2>
                <p className="text-xs text-cinema-muted">{t('profile.devices.subtitle')}</p>
              </div>
              {devices != null && maxDevices > 0 && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    devices.length >= maxDevices
                      ? 'bg-cinema-red/15 text-cinema-red'
                      : 'bg-cinema-success-surface/60 text-cinema-success'
                  }`}
                >
                  {t('profile.devices.count', { active: devices.length, max: maxDevices })}
                </span>
              )}
            </div>
            {devices === null ? (
              <div className="flex justify-center py-6">
                <Spinner size={6} />
              </div>
            ) : devices.length === 0 ? (
              <p className="py-4 text-sm text-cinema-muted">{t('profile.devices.empty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-cinema-border">
                {devices.map((d) => {
                  const isCurrent = d.deviceId === currentDeviceId;
                  return (
                    <li key={d.deviceId} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cinema-card text-base">
                        {isCurrent ? '💻' : '📺'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-cinema-text">
                          {d.name || t('profile.devices.unknown')}
                          {isCurrent && (
                            <span className="ml-2 rounded-full bg-cinema-amber/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cinema-accent">
                              {t('profile.devices.current')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-cinema-muted">
                          {t('profile.devices.lastSeen', {
                            time: new Date(d.lastSeenAt).toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onDisconnectDevice(d.deviceId)}
                        disabled={busyDevice !== null}
                        className="cursor-pointer rounded-lg border border-cinema-border px-3.5 py-1.5 text-xs font-semibold text-cinema-soft transition hover:border-cinema-red/60 hover:text-cinema-red disabled:cursor-default disabled:opacity-60"
                      >
                        {busyDevice === d.deviceId ? <Spinner size={3.5} /> : t('profile.devices.disconnect')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {devices != null && maxDevices > 0 && devices.length >= maxDevices && (
              <p className="mt-3 rounded-lg border border-cinema-amber/30 bg-cinema-amber/10 px-3.5 py-2.5 text-xs text-cinema-accent">
                {t('profile.devices.full')}{' '}
                <Link to="/plans" className="font-bold underline underline-offset-2">
                  {t('watch.upgradeCta')}
                </Link>
              </p>
            )}
          </section>
        )}
      </div>

      {/* continue watching */}
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-bold text-cinema-text">{t('profile.continue.title')}</h2>
        {progress === null ? (
          <div className="flex justify-center py-8">
            <Spinner size={8} />
          </div>
        ) : continueWatching.length === 0 ? (
          <EmptyState icon="⏳" title={t('profile.continue.empty')} subtitle={t('profile.continue.emptyHint')} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {continueWatching.map((p) => {
              const percent = Math.min(100, (p.positionSeconds / p.durationSeconds) * 100);
              const left = Math.max(0, p.durationSeconds - p.positionSeconds);
              return (
                <li key={p.movieId}>
                  <Link
                    to={`/movie/${p.movieId}`}
                    className="group flex gap-4 rounded-2xl border border-cinema-border bg-cinema-panel/60 p-3 transition hover:border-cinema-amber/50 hover:bg-cinema-panel"
                  >
                    <div className="w-20 shrink-0 overflow-hidden rounded-lg border border-cinema-border">
                      {p.posterUrl ? (
                        <img src={resolveMediaUrl(p.posterUrl)} alt="" className="aspect-[2/3] w-full object-cover" loading="lazy" />
                      ) : (
                        <div className={`aspect-[2/3] w-full bg-gradient-to-br ${posterGradient(p.movieId)}`} />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="truncate font-semibold text-cinema-text transition group-hover:text-cinema-accent" title={p.movieTitle}>
                        {p.movieTitle}
                      </h3>
                      <p className="mt-0.5 text-xs text-cinema-muted">
                        {t('profile.continue.lastWatched', {
                          date: new Date(p.updatedAt).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US'),
                        })}
                      </p>
                      <div className="mt-auto">
                        <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-cinema-card">
                          <div className="h-full rounded-full bg-cinema-amber" style={{ width: `${percent}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-cinema-muted">{t('profile.continue.left', { time: formatDuration(left) })}</span>
                          <span className="font-bold text-cinema-accent">{t('profile.continue.resume')} ▸</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* favorites */}
      <section className="mt-10 pb-6">
        <h2 className="mb-4 text-lg font-bold text-cinema-text">{t('profile.favorites.title')}</h2>
        {favorites === null ? (
          <div className="flex justify-center py-8">
            <Spinner size={8} />
          </div>
        ) : favorites.length === 0 ? (
          <EmptyState icon="❤️" title={t('profile.favorites.empty')} subtitle={t('profile.favorites.emptyHint')} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {favorites.map((m) => (
              <div key={m.id} className="flex">
                <MovieCard movie={m} onToggleFavorite={onToggleFavorite} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* cancel subscription confirmation */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('profile.subscription.cancel')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="cursor-pointer rounded-lg border border-cinema-border px-4 py-2 text-sm font-semibold text-cinema-soft transition hover:border-cinema-amber/60 disabled:opacity-60"
              disabled={cancelling}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void onCancelSubscription()}
              className="cursor-pointer rounded-lg bg-cinema-danger px-4 py-2 text-sm font-bold text-white transition hover:bg-cinema-danger/90 disabled:opacity-60"
              disabled={cancelling}
            >
              {cancelling ? t('common.loading') : t('common.confirm')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-cinema-soft">{t('profile.subscription.cancelConfirm')}</p>
      </Modal>
    </div>
  );
}
