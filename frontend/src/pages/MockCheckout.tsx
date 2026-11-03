import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { paymentsService } from '@/services/paymentsService';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { Spinner } from '@/components/Spinner';
import { formatPrice } from '@/utils/format';
import { posterGradient } from '@/utils/format';
import type { SubscriptionPeriod, SubscriptionTier } from '@/types';

/** Info forwarded from the plans page so the mock gateway can show a receipt. */
interface CheckoutState {
  tier?: SubscriptionTier;
  period?: SubscriptionPeriod;
  price?: number;
}

type Phase = 'form' | 'paying' | 'success' | 'cancelled';

export default function MockCheckout() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const { t } = useLanguage();
  const { refreshMe } = useAuth();
  const { error: errorToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as CheckoutState | null) ?? {};

  const [phase, setPhase] = useState<Phase>('form');
  const [cancelting, setCancelting] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);

  // after success: refresh the session (subscription became active), then go home
  useEffect(() => {
    if (phase !== 'success') return;
    void refreshMe();
    const timer = window.setTimeout(() => navigate('/', { replace: true }), 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // after cancel: brief message, then back to plans
  useEffect(() => {
    if (phase !== 'cancelled') return;
    const timer = window.setTimeout(() => navigate('/plans', { replace: true }), 1800);
    return () => window.clearTimeout(timer);
  }, [phase, navigate]);

  const payNow = async (e: FormEvent) => {
    e.preventDefault();
    setPhase('paying');
    try {
      await paymentsService.mockComplete(sessionId);
      setPhase('success');
    } catch (err) {
      setPhase('form');
      setPaymentFailed(true);
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    }
  };

  const cancelPayment = async () => {
    setCancelting(true);
    try {
      await paymentsService.mockCancel(sessionId);
      setPhase('cancelled');
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setCancelting(false);
    }
  };

  const priceText = state.price != null ? formatPrice(state.price) : null;

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg animate-fadeIn overflow-hidden rounded-2xl border border-cinema-border bg-cinema-panel shadow-card">
        {/* fake gateway header */}
        <div className={`flex items-center gap-3 border-b border-cinema-border bg-gradient-to-r px-6 py-4 ${posterGradient(sessionId)}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cinema-black/70 text-lg">💳</span>
          <div className="flex-1">
            <h1 className="text-base font-extrabold text-cinema-text">{t('checkout.title')}</h1>
            <p className="text-[11px] text-cinema-muted">{t('checkout.mockBadge')}</p>
          </div>
          <span className="rounded-full bg-cinema-black/60 px-2.5 py-1 font-mono text-[10px] text-cinema-muted">
            #{sessionId.slice(0, 12)}
          </span>
        </div>

        {phase === 'success' ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-16 w-16 animate-popIn items-center justify-center rounded-full bg-cinema-success/20 text-3xl text-cinema-success">✓</span>
            <h2 className="text-xl font-extrabold text-cinema-strong">{t('checkout.successTitle')}</h2>
            <p className="text-sm text-cinema-muted">{t('checkout.successText')}</p>
            <Spinner size={5} />
          </div>
        ) : phase === 'cancelled' ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-16 w-16 animate-popIn items-center justify-center rounded-full bg-cinema-card text-3xl">🚫</span>
            <h2 className="text-xl font-extrabold text-cinema-strong">{t('checkout.cancelledTitle')}</h2>
            <p className="text-sm text-cinema-muted">{t('checkout.cancelledText')}</p>
            <p className="text-xs text-cinema-muted">{t('checkout.cancelledRedirect')}</p>
          </div>
        ) : (
          <div className="px-6 py-6">
            {/* order summary */}
            <section className="mb-6 rounded-xl border border-cinema-border bg-cinema-black/50 p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-cinema-muted">{t('checkout.orderSummary')}</h2>
              <dl className="space-y-2 text-sm">
                {state.tier && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-cinema-muted">{t('checkout.plan')}</dt>
                    <dd className="font-semibold text-cinema-text">{t('tier.' + state.tier)}</dd>
                  </div>
                )}
                {state.period && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-cinema-muted">{t('checkout.period')}</dt>
                    <dd className="font-semibold text-cinema-text">
                      {t('plans.' + state.period)}
                      {priceText && (
                        <span className="text-cinema-muted">
                          {' '}
                          ({priceText}
                          {state.period === 'monthly' ? t('plans.perMonth') : t('plans.perYear')})
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {priceText && (
                  <div className="flex justify-between gap-4 border-t border-cinema-border pt-2">
                    <dt className="font-bold text-cinema-text">{t('checkout.total')}</dt>
                    <dd className="text-lg font-extrabold text-cinema-accent">{priceText}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* mock card form — prefilled test card, locked on purpose */}
            {paymentFailed && (
              <Link to={`/plans?retry=${sessionId}`} className="mb-4 block text-center underline">
                {t('checkout.retryPayment')}
              </Link>
            )}
            <form onSubmit={payNow}>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-cinema-muted">{t('checkout.cardDetails')}</h2>
              <fieldset disabled={phase === 'paying'} className="space-y-3 opacity-80">
                <div>
                  <label htmlFor="mock-card" className="sr-only">
                    {t('checkout.cardNumber')}
                  </label>
                  <input
                    id="mock-card"
                    type="text"
                    readOnly
                    value="4242 4242 4242 4242"
                    className="w-full cursor-not-allowed rounded-xl border border-cinema-border bg-cinema-black/70 px-4 py-3 font-mono text-sm tracking-widest text-cinema-soft"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="mock-expiry" className="sr-only">
                      {t('checkout.expiry')}
                    </label>
                    <input
                      id="mock-expiry"
                      type="text"
                      readOnly
                      value="12 / 34"
                      className="w-full cursor-not-allowed rounded-xl border border-cinema-border bg-cinema-black/70 px-4 py-3 font-mono text-sm text-cinema-soft"
                    />
                  </div>
                  <div>
                    <label htmlFor="mock-cvc" className="sr-only">
                      {t('checkout.cvc')}
                    </label>
                    <input
                      id="mock-cvc"
                      type="text"
                      readOnly
                      value="123"
                      className="w-full cursor-not-allowed rounded-xl border border-cinema-border bg-cinema-black/70 px-4 py-3 font-mono text-sm text-cinema-soft"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="mock-name" className="sr-only">
                    {t('checkout.cardName')}
                  </label>
                  <input
                    id="mock-name"
                    type="text"
                    readOnly
                    value="TEST CARD / ABSOLUTECINEMA"
                    className="w-full cursor-not-allowed rounded-xl border border-cinema-border bg-cinema-black/70 px-4 py-3 font-mono text-sm text-cinema-soft"
                  />
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={phase === 'paying'}
                className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-cinema-amber px-4 py-3.5 font-bold text-cinema-ink transition hover:shadow-glow disabled:cursor-default disabled:opacity-60"
              >
                {phase === 'paying' && <Spinner size={4} />}
                {phase === 'paying' ? t('checkout.processing') : `${t('checkout.payNow')}${priceText ? ` · ${priceText}` : ''}`}
              </button>
              <button
                type="button"
                onClick={cancelPayment}
                disabled={cancelting}
                className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-cinema-border px-4 py-3 text-sm font-semibold text-cinema-muted transition hover:border-cinema-red/50 hover:text-cinema-red disabled:cursor-default disabled:opacity-60"
              >
                {cancelting && <Spinner size={4} />}
                {t('checkout.cancelPayment')}
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-cinema-muted">
              <Link to="/plans" className="underline transition hover:text-cinema-accent">
                {t('nav.plans')}
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
