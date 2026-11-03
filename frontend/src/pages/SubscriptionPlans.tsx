import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { paymentsService } from '@/services/paymentsService';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { formatDate, formatPrice } from '@/utils/format';
import type { PlanDto, SubscriptionPeriod, SubscriptionTier } from '@/types';

const TIER_ORDER: SubscriptionTier[] = ['basic', 'plus', 'premium'];
const PERIODS: SubscriptionPeriod[] = ['monthly', 'yearly'];
const FEATURE_COUNT = 4;

export default function SubscriptionPlans() {
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const { error: errorToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const retryId = searchParams.get('retry');
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (!retryId) return;
    setRetrying(true);
    try {
      const { checkoutUrl } = await paymentsService.retry(retryId);
      if (checkoutUrl.startsWith('/')) navigate(checkoutUrl);
      else window.location.assign(checkoutUrl);
    } catch (err) { errorToast(extractServerMessage(err) ?? t(errorStatusKey(err))); }
    finally { setRetrying(false); }
  };

  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [period, setPeriod] = useState<SubscriptionPeriod>('monthly');
  const [busyTier, setBusyTier] = useState<SubscriptionTier | null>(null);

  const activeSub = user?.activeSubscription ?? null;
  const hasActive = Boolean(user?.hasActiveSubscription && activeSub?.status === 'active');

  const load = () => {
    setLoadError(false);
    paymentsService
      .plans()
      .then(setPlans)
      .catch(() => setLoadError(true));
  };

  useEffect(load, []);

  /** yearly vs 12×monthly savings, rounded to a whole percent */
  const savingsPercent = (plan: PlanDto): number =>
    Math.max(0, Math.round((1 - plan.yearlyPrice / (plan.monthlyPrice * 12)) * 100));

  const checkout = async (tier: SubscriptionTier) => {
    setBusyTier(tier);
    try {
      const { checkoutUrl } = await paymentsService.checkout(tier, period);
      if (checkoutUrl.startsWith('/mock-checkout')) {
        const price = period === 'monthly' ? plans?.find((p) => p.tier === tier)?.monthlyPrice : plans?.find((p) => p.tier === tier)?.yearlyPrice;
        navigate(checkoutUrl, { state: { tier, period, price } });
      } else {
        window.location.href = checkoutUrl;
      }
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-extrabold text-cinema-strong sm:text-4xl">{t('plans.title')}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-cinema-muted sm:text-base">{t('plans.subtitle')}</p>
      </header>

      {/* current subscription notice */}
      {retryId && isAuthenticated && (
        <div className="mb-6 text-center">
          <button type="button" onClick={() => void retry()} disabled={retrying}
            className="rounded-xl border border-cinema-border px-5 py-3 font-bold disabled:opacity-50">
            {t('checkout.retryPayment')}
          </button>
        </div>
      )}
      {hasActive && activeSub && (
        <div className="mx-auto mb-8 flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-cinema-success/40 bg-cinema-success-surface/30 px-6 py-4 text-center sm:flex-row sm:text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cinema-success/20 text-lg">✓</span>
          <div className="flex-1 text-sm text-cinema-success">
            <p className="font-bold">
              {t('tier.' + activeSub.tier)} · {t('sub.period.' + activeSub.period)}
            </p>
            <p className="text-cinema-success">
              {t('profile.subscription.endsAt')}: {formatDate(activeSub.endsAt)} · {t(activeSub.autoRenew ? 'profile.subscription.autoRenew' : 'profile.subscription.noRenew')}
            </p>
          </div>
          <span className="rounded-full bg-cinema-success/20 px-3 py-1 text-xs font-bold text-cinema-success">
            {t('sub.status.active')}
          </span>
        </div>
      )}

      {/* period toggle */}
      <div className="mb-10 flex justify-center">
        <div className="inline-flex rounded-xl border border-cinema-border bg-cinema-panel p-1" role="group" aria-label={t('plans.subtitle')}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`cursor-pointer rounded-lg px-5 py-2 text-sm font-bold transition sm:px-7 ${
                period === p ? 'bg-cinema-amber text-cinema-ink shadow-glow' : 'text-cinema-soft hover:text-cinema-text'
              }`}
            >
              {t('plans.' + p)}
            </button>
          ))}
        </div>
      </div>

      {/* plans */}
      {loadError ? (
        <EmptyState
          icon="⚠️"
          title={t('plans.loadError')}
          action={
            <button type="button" onClick={load} className="cursor-pointer rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink">
              {t('common.retry')}
            </button>
          }
        />
      ) : plans === null ? (
        <div className="flex justify-center py-16">
          <Spinner size={10} />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          {TIER_ORDER.map((tier) => {
            const plan = plans.find((p) => p.tier === tier);
            if (!plan) return null;
            const price = period === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice;
            const isPopular = tier === 'plus';
            const isCurrent = hasActive && activeSub?.tier === tier;
            const busy = busyTier === tier;

            return (
              <article
                key={tier}
                className={`relative flex flex-col rounded-2xl border bg-cinema-panel p-6 transition ${
                  isPopular
                    ? 'border-cinema-amber/60 shadow-glow md:-translate-y-2'
                    : 'border-cinema-border hover:border-cinema-amber/30'
                }`}
              >
                {isPopular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-cinema-amber px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-cinema-ink">
                    ★ {t('plans.popular')}
                  </span>
                )}

                <h2 className="text-lg font-extrabold uppercase tracking-wide text-cinema-text">{t('tier.' + tier)}</h2>

                <div className="mb-1 mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-cinema-strong">{formatPrice(price)}</span>
                  <span className="text-sm font-semibold text-cinema-muted">
                    {period === 'monthly' ? t('plans.perMonth') : t('plans.perYear')}
                  </span>
                </div>
                <p className="mb-5 text-xs text-cinema-muted">
                  {period === 'monthly'
                    ? t('plans.billedMonthly', { price: formatPrice(plan.monthlyPrice) })
                    : t('plans.billedYearly', { price: formatPrice(plan.yearlyPrice) })}
                </p>

                {period === 'yearly' && savingsPercent(plan) > 0 && (
                  <span className="mb-4 inline-block w-fit rounded-full bg-cinema-success/15 px-3 py-1 text-xs font-bold text-cinema-success">
                    {t('plans.saveBadge', { percent: savingsPercent(plan) })}
                  </span>
                )}

                <ul className="mb-8 flex-1 space-y-3">
                  {Array.from({ length: FEATURE_COUNT }, (_, i) => i + 1).map((n) => (
                    <li key={n} className="flex items-start gap-2.5 text-sm text-cinema-soft">
                      <svg className="mt-0.5 shrink-0 text-cinema-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                        <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t(`plans.features.${tier}.${n}`)}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <span className="flex items-center justify-center gap-2 rounded-xl border border-cinema-success/50 bg-cinema-success/10 px-4 py-3 text-sm font-bold text-cinema-success">
                    ✓ {t('plans.current')}
                  </span>
                ) : isAuthenticated ? (
                  <button
                    type="button"
                    disabled={busyTier !== null}
                    onClick={() => checkout(tier)}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-default disabled:opacity-60 ${
                      isPopular
                        ? 'bg-cinema-amber text-cinema-ink hover:shadow-glow'
                        : 'border border-cinema-border bg-cinema-card text-cinema-text hover:border-cinema-amber/60 hover:text-cinema-accent'
                    }`}
                  >
                    {busy && <Spinner size={4} />}
                    {busy ? t('plans.processing') : t('plans.choose', { tier: t('tier.' + tier) })}
                  </button>
                ) : (
                  <a
                    href={`/login?from=/plans`}
                    className="flex items-center justify-center rounded-xl border border-cinema-border bg-cinema-card px-4 py-3 text-sm font-bold text-cinema-text transition hover:border-cinema-amber/60 hover:text-cinema-accent"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/login', { state: { from: '/plans' } });
                    }}
                  >
                    {t('plans.choose', { tier: t('tier.' + tier) })}
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}

      {hasActive && plans != null && (
        <p className="mx-auto mt-8 max-w-xl text-center text-xs text-cinema-muted">{t('plans.activeNotice')}</p>
      )}
    </div>
  );
}
