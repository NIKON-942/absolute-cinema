import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { EntityManager, LessThan, Repository } from 'typeorm';
import Stripe from 'stripe';
import { AppConfig } from '../../config/configuration';
import { SubscriptionPeriodEnum, SubscriptionStatusEnum, SubscriptionTierEnum, UserEntity } from '../users/user.entity';
import { MailService } from '../mail/mail.service';
import { PaymentTransactionEntity, TransactionStatusEnum } from './entities/payment-transaction.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionPlanEntity } from './entities/subscription-plan.entity';

/** Calendar billing clamps January 31 to February's last day. */
export function billingEnd(start: Date, period: SubscriptionPeriodEnum): Date {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (period === SubscriptionPeriodEnum.MONTHLY ? 1 : 12));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}

/** Start of the paid period that ends at `endsAt` (inverse of billingEnd). */
export function periodStart(endsAt: Date, period: SubscriptionPeriodEnum, startsAt: Date | null): Date {
  const start = new Date(endsAt);
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - (period === SubscriptionPeriodEnum.MONTHLY ? 1 : 12));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, last));
  return startsAt && startsAt.getTime() > start.getTime() ? startsAt : start;
}

/** Money for the unused part of a paid period, rounded down to whole cents. */
export function unusedPortion(amount: number, start: Date, end: Date, now: Date): number {
  const total = end.getTime() - start.getTime();
  if (!(total > 0) || !(amount > 0)) return 0;
  const left = Math.min(total, Math.max(0, end.getTime() - now.getTime()));
  return Math.floor((amount * 100 * left) / total) / 100;
}

export interface RefundQuote {
  subscription: SubscriptionEntity;
  /** Null when nothing can be returned (no paid payment on record, or nothing left). */
  refund: { transaction: PaymentTransactionEntity; amount: number; currency: string; remainingDays: number } | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe | null = null;
  constructor(
    private config: ConfigService<AppConfig, true>, private mail: MailService,
    @InjectRepository(SubscriptionPlanEntity) private plansRepo: Repository<SubscriptionPlanEntity>,
    @InjectRepository(SubscriptionEntity) private subsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentTransactionEntity) private txRepo: Repository<PaymentTransactionEntity>,
  ) {
    const cfg = config.get('stripe', { infer: true })!;
    if (cfg.enabled) {
      if (!cfg.secretKey || !cfg.webhookSecret) throw new Error('Stripe is enabled: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required');
      this.stripe = new Stripe(cfg.secretKey, { apiVersion: '2026-10-28.endive' });
    }
  }

  async plans() {
    return (await this.plansRepo.find({ order: { monthlyPrice: 'ASC' } })).map(p => ({
      tier: p.tier, monthlyPrice: Number(p.monthlyPrice), yearlyPrice: Number(p.yearlyPrice),
      currency: p.currency, maxDevices: p.maxDevices, maxQuality: p.maxQuality, prioritySupport: p.prioritySupport, features: [],
    }));
  }

  private async lock(em: EntityManager, userId: number) {
    await em.query('SELECT pg_advisory_xact_lock(1701, $1)', [userId]);
  }

  private async expireCheckout(tx: PaymentTransactionEntity): Promise<Stripe.Checkout.Session | null> {
    if (!this.stripe || !tx.stripeCheckoutId) return null;
    const session = await this.stripe.checkout.sessions.retrieve(tx.stripeCheckoutId);
    if (session.status === 'complete') return session;
    if (session.status === 'open') {
      try { await this.stripe.checkout.sessions.expire(session.id); }
      catch (error) {
        // Payment can finish between retrieve and expire. Never cancel it locally.
        const current = await this.stripe.checkout.sessions.retrieve(session.id);
        if (current.status === 'complete') return current;
        if (current.status !== 'expired') throw error;
      }
    }
    return null;
  }

  /**
   * The user's current paid subscription and what the unused part of its latest
   * payment is worth. Used both for the confirmation preview and the actual refund.
   */
  private async refundQuote(em: EntityManager, userId: number, now = new Date()): Promise<RefundQuote | null> {
    const subscription = await em.findOne(SubscriptionEntity, { where: { userId, status: SubscriptionStatusEnum.ACTIVE }, order: { endsAt: 'DESC' } });
    if (!subscription || (subscription.endsAt && subscription.endsAt.getTime() <= now.getTime())) return null;
    // With Stripe enabled only money that went through Stripe can be returned.
    const refundable = !subscription.endsAt || (this.stripe ? Boolean(subscription.stripeSubscriptionId) : true);
    const transaction = refundable && subscription.endsAt
      ? await em.findOne(PaymentTransactionEntity, { where: { subscriptionId: subscription.id, status: TransactionStatusEnum.PAID }, order: { id: 'DESC' } })
      : null;
    if (!transaction || Number(transaction.refundedAmount) > 0) return { subscription, refund: null };
    const amount = unusedPortion(Number(transaction.amount), periodStart(subscription.endsAt!, subscription.period, subscription.startsAt), subscription.endsAt!, now);
    if (amount <= 0) return { subscription, refund: null };
    return { subscription, refund: { transaction, amount, currency: transaction.currency,
      remainingDays: Math.max(1, Math.ceil((subscription.endsAt!.getTime() - now.getTime()) / 86_400_000)) } };
  }

  /** What switching to `tier`/`period` will cost and refund; shown before the user confirms. */
  async switchPreview(userId: number, tier: SubscriptionTierEnum, period: SubscriptionPeriodEnum) {
    const plan = await this.plansRepo.findOne({ where: { tier } });
    if (!plan) throw new BadRequestException('Unknown subscription tier');
    const quote = await this.refundQuote(this.txRepo.manager, userId);
    return {
      active: Boolean(quote),
      current: quote ? { tier: quote.subscription.tier, period: quote.subscription.period, endsAt: quote.subscription.endsAt?.toISOString() ?? null } : null,
      refund: quote?.refund ? { amount: quote.refund.amount, currency: quote.refund.currency, remainingDays: quote.refund.remainingDays } : null,
      newPrice: Number(period === SubscriptionPeriodEnum.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice),
      currency: plan.currency,
    };
  }

  /** Refunds the latest paid Stripe invoice of a subscription (idempotent per payment). */
  private async stripeRefund(stripeSubscriptionId: string, cents: number, key: string, newSessionId: string): Promise<string> {
    const invoice = (await this.stripe!.invoices.list({ subscription: stripeSubscriptionId, status: 'paid', limit: 1 })).data[0];
    if (!invoice) throw new Error('No paid Stripe invoice to refund');
    const payment = (await this.stripe!.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 1 })).data[0]?.payment;
    const intent = typeof payment?.payment_intent === 'string' ? payment.payment_intent : payment?.payment_intent?.id;
    if (!intent) throw new Error('Paid Stripe invoice has no payment intent');
    const refund = await this.stripe!.refunds.create({ payment_intent: intent, amount: cents, reason: 'requested_by_customer',
      metadata: { replacedBySessionId: newSessionId } }, { idempotencyKey: key });
    return refund.id;
  }

  /**
   * Returns the unused part of the replaced subscription. A provider failure
   * never undoes the new activation (the customer has already paid); it is
   * recorded as `failed` and logged for manual follow-up.
   */
  private async issueRefund(em: EntityManager, quote: RefundQuote, newSessionId: string): Promise<{ amount: number; currency: string } | null> {
    const refund = quote.refund;
    if (!refund) return null;
    let stripeRefundId: string | null = null;
    let failed = false;
    try {
      if (this.stripe && quote.subscription.stripeSubscriptionId) {
        stripeRefundId = await this.stripeRefund(quote.subscription.stripeSubscriptionId, Math.round(refund.amount * 100), `refund-tx-${refund.transaction.id}`, newSessionId);
      }
    } catch (error) {
      failed = true;
      this.logger.error(`Refund of ${refund.amount.toFixed(2)} ${refund.currency} for payment #${refund.transaction.id} failed: ${String(error)}`);
    }
    await em.update(PaymentTransactionEntity, refund.transaction.id, failed
      ? { refundStatus: 'failed', refundedBySessionId: newSessionId }
      : { refundStatus: 'refunded', refundedAmount: refund.amount.toFixed(2), refundedAt: new Date(), stripeRefundId, refundedBySessionId: newSessionId });
    return failed ? null : { amount: refund.amount, currency: refund.currency };
  }

  async createCheckout(userId: number, tier: SubscriptionTierEnum, period: SubscriptionPeriodEnum, retryOf?: string) {
    const plan = await this.plansRepo.findOne({ where: { tier } });
    if (!plan) throw new BadRequestException('Unknown subscription tier');
    return this.txRepo.manager.transaction(async em => {
      await this.lock(em, userId);
      let retries = 0;
      if (retryOf) {
        const previous = await em.findOne(PaymentTransactionEntity, { where: { sessionId: retryOf, userId } });
        if (!previous) throw new NotFoundException('Order not found');
        const retryable = previous.status === TransactionStatusEnum.FAILED ||
          (previous.status === TransactionStatusEnum.CANCELLED &&
            (previous.cancellationReason === 'expired' || previous.cancellationReason === 'user_cancelled'));
        if (!retryable || previous.retries >= 2 || await em.existsBy(PaymentTransactionEntity, { retryOf })) {
          throw new BadRequestException('This order cannot be retried (maximum 3 Checkout sessions)');
        }
        retries = previous.retries + 1;
      }
      const pending = await em.find(PaymentTransactionEntity, { where: { userId, status: TransactionStatusEnum.PENDING } });
      for (const order of pending) {
        if (await this.expireCheckout(order)) throw new ConflictException('Payment is being confirmed; wait for confirmation');
      }
      await em.update(PaymentTransactionEntity, { userId, status: TransactionStatusEnum.PENDING }, { status: TransactionStatusEnum.CANCELLED, cancellationReason: 'superseded' });
      await em.update(SubscriptionEntity, { userId, status: SubscriptionStatusEnum.PENDING }, { status: SubscriptionStatusEnum.CANCELLED });
      const subscription = await em.save(SubscriptionEntity, em.create(SubscriptionEntity, { userId, tier, period, status: SubscriptionStatusEnum.PENDING }));
      const sessionId = randomUUID();
      const amount = period === SubscriptionPeriodEnum.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice;
      const tx = await em.save(PaymentTransactionEntity, em.create(PaymentTransactionEntity, {
        sessionId, userId, subscriptionId: subscription.id, tier, period, amount,
        currency: plan.currency, status: TransactionStatusEnum.PENDING, retries, retryOf: retryOf ?? null, expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      }));
      if (!this.stripe) return { checkoutUrl: `/mock-checkout/${sessionId}` };
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription', allowed_payment_method_types: ['card'], client_reference_id: sessionId, metadata: { sessionId },
        subscription_data: { metadata: { sessionId } },
        line_items: [{ quantity: 1, price_data: { currency: plan.currency, unit_amount: Math.round(Number(amount) * 100),
          recurring: { interval: period === SubscriptionPeriodEnum.MONTHLY ? 'month' : 'year' }, product_data: { name: `AbsoluteCinema ${tier} (${period})` } } }],
        success_url: `${this.config.get('clientUrl', { infer: true })}/?payment=success`,
        cancel_url: `${this.config.get('clientUrl', { infer: true })}/plans?retry=${sessionId}`,
      }, { idempotencyKey: sessionId });
      await em.update(PaymentTransactionEntity, tx.id, { stripeCheckoutId: session.id });
      if (!session.url) throw new Error('Stripe did not return a checkout URL');
      return { checkoutUrl: session.url };
    });
  }

  async retry(userId: number, sessionId: string) {
    const tx = await this.txRepo.findOne({ where: { userId, sessionId } });
    if (!tx) throw new NotFoundException('Order not found');
    if (tx.status === TransactionStatusEnum.PENDING) await this.cancel(sessionId, userId);
    return this.createCheckout(userId, tx.tier, tx.period, sessionId);
  }

  async complete(sessionId: string, expectedUserId?: number, external?: Stripe.Subscription): Promise<{ message: string; refund: { amount: number; currency: string } | null }> {
    const owner = await this.txRepo.findOne({ where: { sessionId } });
    if (!owner || owner.userId === null || (expectedUserId !== undefined && owner.userId !== expectedUserId)) throw new NotFoundException('Order not found');
    const ownerId: number = owner.userId;
    const receipt = await this.txRepo.manager.transaction(async em => {
      await this.lock(em, ownerId);
      const tx = await em.findOneByOrFail(PaymentTransactionEntity, { id: owner.id });
      if (tx.status === TransactionStatusEnum.PAID) return null;
      if ((!external && tx.status !== TransactionStatusEnum.PENDING) || !tx.subscriptionId) throw new BadRequestException(`Order is ${tx.status}`);
      if (!external && tx.expiresAt && tx.expiresAt.getTime() <= Date.now()) throw new BadRequestException('Order expired; retry payment');
      const active = await em.find(SubscriptionEntity, { where: { userId: ownerId, status: SubscriptionStatusEnum.ACTIVE } });
      for (const old of active) {
        if (this.stripe && old.stripeSubscriptionId && old.stripeSubscriptionId !== external?.id) {
          const current = await this.stripe.subscriptions.retrieve(old.stripeSubscriptionId);
          if (current.status !== 'canceled') await this.stripe.subscriptions.cancel(current.id);
        }
      }
      const now = new Date();
      // Value the unused part of the replaced period before its subscription is expired.
      const quote = await this.refundQuote(em, ownerId, now);
      const sameStripeSubscription = Boolean(external && quote?.subscription.stripeSubscriptionId === external.id);
      const item = external?.items.data[0];
      if (external && !item) throw new Error('Stripe subscription has no billing period');
      const endsAt = item ? new Date(item.current_period_end * 1000) : billingEnd(now, tx.period);
      await em.update(SubscriptionEntity, { userId: ownerId, status: SubscriptionStatusEnum.ACTIVE }, { status: SubscriptionStatusEnum.EXPIRED });
      await em.update(SubscriptionEntity, tx.subscriptionId, { status: SubscriptionStatusEnum.ACTIVE,
        startsAt: item ? new Date(item.current_period_start * 1000) : now, endsAt,
        stripeSubscriptionId: external?.id ?? null, cancelAtPeriodEnd: external?.cancel_at_period_end ?? false });
      const refund = quote && !sameStripeSubscription ? await this.issueRefund(em, quote, tx.sessionId) : null;
      await em.update(PaymentTransactionEntity, tx.id, { status: TransactionStatusEnum.PAID, cancellationReason: null });
      const user = await em.findOneBy(UserEntity, { id: ownerId });
      return user ? { email: user.email, tx, endsAt, refund } : null;
    });
    if (receipt) this.mail.sendReceipt(receipt.email, { tier: receipt.tx.tier, period: receipt.tx.period,
      amount: Number(receipt.tx.amount), currency: receipt.tx.currency, endsAt: receipt.endsAt, refund: receipt.refund });
    return { message: receipt ? 'Payment completed — subscription is now active' : 'Payment already processed', refund: receipt?.refund ?? null };
  }

  private async failOrder(sessionId: string) {
    await this.closeOrder(sessionId, TransactionStatusEnum.FAILED);
  }

  private async closeOrder(sessionId: string, status: TransactionStatusEnum.FAILED | TransactionStatusEnum.CANCELLED,
    cancellationReason: PaymentTransactionEntity['cancellationReason'] = null, expectedUserId?: number) {
    const owner = await this.txRepo.findOne({ where: { sessionId } });
    if (!owner || owner.userId === null || (expectedUserId !== undefined && owner.userId !== expectedUserId)) throw new NotFoundException('Order not found');
    const ownerId: number = owner.userId;
    const completed = await this.txRepo.manager.transaction(async em => {
      await this.lock(em, ownerId);
      const tx = await em.findOneByOrFail(PaymentTransactionEntity, { id: owner.id });
      if (tx.status !== TransactionStatusEnum.PENDING) return;
      const session = await this.expireCheckout(tx);
      if (session && (session.payment_status === 'paid' || status !== TransactionStatusEnum.FAILED)) return session;
      const reason = cancellationReason === 'user_cancelled' && tx.expiresAt && tx.expiresAt.getTime() <= Date.now()
        ? 'expired' : cancellationReason;
      await em.update(PaymentTransactionEntity, tx.id, { status, cancellationReason: reason });
      if (tx.subscriptionId) await em.update(SubscriptionEntity, { id: tx.subscriptionId, status: SubscriptionStatusEnum.PENDING }, { status: SubscriptionStatusEnum.CANCELLED });
    });
    // Completion takes the same user lock, so reconcile after the transaction ends.
    if (completed) {
      await this.completedCheckout(completed);
      if (completed.payment_status !== 'paid') throw new ConflictException('Payment is being confirmed; wait for confirmation');
    }
  }

  async cancel(sessionId: string, expectedUserId?: number) {
    await this.closeOrder(sessionId, TransactionStatusEnum.CANCELLED, 'user_cancelled', expectedUserId);
    const tx = await this.txRepo.findOneByOrFail({ sessionId });
    return { message: tx.status === TransactionStatusEnum.PAID ? 'Payment already confirmed' : 'Payment cancelled',
      status: tx.status, cancellationReason: tx.cancellationReason,
      canRetry: tx.retries < 2 && (tx.status === TransactionStatusEnum.FAILED ||
        (tx.status === TransactionStatusEnum.CANCELLED &&
          (tx.cancellationReason === 'expired' || tx.cancellationReason === 'user_cancelled'))) &&
        !await this.txRepo.existsBy({ retryOf: sessionId }) };
  }

  /**
   * Called while an administrator deletes an account (inside the deletion
   * transaction): closes open orders, cancels the Stripe subscriptions and
   * detaches the payment history from the account. Returns warnings for
   * problems that must not block the deletion.
   */
  async detachUser(em: EntityManager, userId: number): Promise<string[]> {
    const warnings: string[] = [];
    await this.lock(em, userId);
    const pending = await em.find(PaymentTransactionEntity, { where: { userId, status: TransactionStatusEnum.PENDING } });
    for (const order of pending) {
      // A paid but unconfirmed Checkout must be settled first, or the money would be orphaned.
      if (await this.expireCheckout(order)) throw new ConflictException('A payment is being confirmed; try deleting this user again shortly');
    }
    await em.update(PaymentTransactionEntity, { userId, status: TransactionStatusEnum.PENDING }, { status: TransactionStatusEnum.CANCELLED, cancellationReason: 'user_deleted' });
    if (this.stripe) {
      const subscriptions = await em.find(SubscriptionEntity, { where: { userId } });
      const ids = [...new Set(subscriptions.map(sub => sub.stripeSubscriptionId).filter((id): id is string => Boolean(id)))];
      for (const id of ids) {
        try {
          const current = await this.stripe.subscriptions.retrieve(id);
          if (current.status !== 'canceled') await this.stripe.subscriptions.cancel(id);
        } catch (error) {
          if ((error as { code?: string }).code === 'resource_missing') continue; // already gone at the provider
          warnings.push('stripe_cancel_failed');
          this.logger.error(`Could not cancel Stripe subscription ${id} of deleted user #${userId}; cancel it manually: ${String(error)}`);
        }
      }
    }
    // Keep the financial records, drop the link to the person.
    await em.query('UPDATE payment_transactions SET former_user_id = user_id, user_id = NULL, subscription_id = NULL WHERE user_id = $1', [userId]);
    return warnings;
  }

  async cancelSubscription(userId: number): Promise<{ message: string }> {
    await this.subsRepo.manager.transaction(async em => {
      await this.lock(em, userId);
      const active = await em.findOne(SubscriptionEntity, { where: { userId, status: SubscriptionStatusEnum.ACTIVE }, order: { endsAt: 'DESC' } });
      if (!active || (active.endsAt && active.endsAt.getTime() <= Date.now())) throw new BadRequestException('No active subscription to cancel');
      if (this.stripe && active.stripeSubscriptionId) await this.stripe.subscriptions.update(active.stripeSubscriptionId, { cancel_at_period_end: true });
      // ТЗ: retain paid access when cancelling automatic renewal.
      await em.update(SubscriptionEntity, active.id, { cancelAtPeriodEnd: true });
      const pending = await em.find(PaymentTransactionEntity, { where: { userId, status: TransactionStatusEnum.PENDING } });
      for (const tx of pending) {
        if (await this.expireCheckout(tx)) throw new ConflictException('Payment is being confirmed; wait for confirmation');
      }
      await em.update(PaymentTransactionEntity, { userId, status: TransactionStatusEnum.PENDING }, { status: TransactionStatusEnum.CANCELLED, cancellationReason: 'user_cancelled' });
      await em.update(SubscriptionEntity, { userId, status: SubscriptionStatusEnum.PENDING }, { status: SubscriptionStatusEnum.CANCELLED });
    });
    return { message: 'Automatic renewal cancelled; access remains until the paid period ends' };
  }

  private async completedCheckout(session: Stripe.Checkout.Session) {
    if (!this.stripe || session.payment_status !== 'paid') return;
    const sessionId = session.metadata?.sessionId ?? session.client_reference_id;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!sessionId || !subscriptionId) throw new BadRequestException('Checkout has no local order or subscription');
    const tx = await this.txRepo.findOneBy({ sessionId });
    if (!tx || tx.stripeCheckoutId !== session.id) throw new BadRequestException('Checkout does not match the order');
    if (tx.userId === null) { this.logger.warn(`Ignoring payment for order ${sessionId}: the account was deleted`); return; }
    await this.complete(sessionId, undefined, await this.stripe.subscriptions.retrieve(subscriptionId));
  }

  private async paidInvoice(invoice: Stripe.Invoice) {
    if (!this.stripe) return;
    const value = invoice.parent?.subscription_details?.subscription;
    const stripeId = typeof value === 'string' ? value : value?.id;
    if (!stripeId) return;
    const external = await this.stripe.subscriptions.retrieve(stripeId);
    const sessionId = external.metadata.sessionId;
    if (sessionId) {
      const initial = await this.txRepo.findOneBy({ sessionId });
      if (initial && initial.userId === null) return; // account deleted; its payment history is kept
      if (initial?.stripeCheckoutId && initial.status !== TransactionStatusEnum.PAID) {
        await this.completedCheckout(await this.stripe.checkout.sessions.retrieve(initial.stripeCheckoutId));
      }
    }
    const owner = await this.subsRepo.findOneBy({ stripeSubscriptionId: stripeId });
    if (!owner) {
      if (!sessionId) return; // another application on the same Stripe account
      throw new Error('Invoice subscription has not been linked yet; retry webhook');
    }
    if (invoice.billing_reason === 'subscription_create') return;
    await this.txRepo.manager.transaction(async em => {
      await this.lock(em, owner.userId);
      const key = `invoice:${invoice.id}`;
      if (await em.existsBy(PaymentTransactionEntity, { sessionId: key })) return;
      const sub = await em.findOneByOrFail(SubscriptionEntity, { id: owner.id });
      await em.save(PaymentTransactionEntity, em.create(PaymentTransactionEntity, { sessionId: key, userId: sub.userId,
        subscriptionId: sub.id, tier: sub.tier, period: sub.period, amount: (invoice.amount_paid / 100).toFixed(2),
        currency: invoice.currency, status: TransactionStatusEnum.PAID }));
      if (external.status === 'canceled' || sub.status === SubscriptionStatusEnum.CANCELLED) return;
      const periodEnd = Math.max(...invoice.lines.data.filter(line => line.parent?.type === 'subscription_item_details').map(line => line.period.end));
      if (!Number.isFinite(periodEnd)) throw new Error('Paid invoice has no subscription period');
      const endsAt = new Date(Math.max(sub.endsAt?.getTime() ?? 0, periodEnd * 1000));
      await em.update(SubscriptionEntity, sub.id, { endsAt, status: SubscriptionStatusEnum.ACTIVE, cancelAtPeriodEnd: external.cancel_at_period_end });
    });
  }

  async handleWebhook(payload: Buffer | undefined, signature: string | undefined): Promise<{ received: boolean }> {
    if (!this.stripe) return { received: true };
    let event: Stripe.Event;
    try { event = this.stripe.webhooks.constructEvent(payload as Buffer, signature ?? '', this.config.get('stripe', { infer: true })!.webhookSecret); }
    catch { throw new BadRequestException('Invalid webhook signature'); }
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.completedCheckout(event.data.object as Stripe.Checkout.Session); break;
      case 'invoice.paid': await this.paidInvoice(event.data.object as Stripe.Invoice); break;
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const sessionId = session.metadata?.sessionId ?? session.client_reference_id;
        const tx = sessionId ? await this.txRepo.findOneBy({ sessionId }) : null;
        if (tx && tx.userId !== null && tx.stripeCheckoutId === session.id) {
          if (event.type === 'checkout.session.expired') await this.closeOrder(tx.sessionId, TransactionStatusEnum.CANCELLED, 'expired');
          else await this.failOrder(tx.sessionId);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Retrieve current provider state rather than trusting old snapshots.
        const external = await this.stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id);
        const sub = await this.subsRepo.findOneBy({ stripeSubscriptionId: external.id });
        if (sub) await this.subsRepo.manager.transaction(async em => {
          await this.lock(em, sub.userId);
          await em.update(SubscriptionEntity, sub.id, { cancelAtPeriodEnd: external.cancel_at_period_end,
            ...(external.status === 'canceled' ? { status: SubscriptionStatusEnum.CANCELLED } : {}) });
        });
        break;
      }
    }
    return { received: true };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePendingOrders(): Promise<void> {
    const stale = await this.txRepo.find({ where: { status: TransactionStatusEnum.PENDING, expiresAt: LessThan(new Date()) } });
    for (const tx of stale) {
      try {
        await this.closeOrder(tx.sessionId, TransactionStatusEnum.CANCELLED, 'expired');
      } catch (error) { this.logger.warn(`Could not reconcile order ${tx.sessionId}: ${String(error)}`); }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireFinishedSubscriptions(): Promise<void> {
    await this.subsRepo.update({ status: SubscriptionStatusEnum.ACTIVE, endsAt: LessThan(new Date()) }, { status: SubscriptionStatusEnum.EXPIRED });
  }

  assertMockMode() {
    if (this.stripe) throw new NotFoundException('Mock endpoints are disabled when Stripe is enabled');
  }
}
