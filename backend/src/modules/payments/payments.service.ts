import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import Stripe from 'stripe';
import { AppConfig } from '../../config/configuration';
import {
  SubscriptionPeriodEnum,
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
} from '../users/user.entity';
import { MailService } from '../mail/mail.service';
import {
  PaymentTransactionEntity,
  TransactionStatusEnum,
} from './entities/payment-transaction.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionPlanEntity } from './entities/subscription-plan.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe | null = null;

  constructor(
    private config: ConfigService<AppConfig, true>,
    private mail: MailService,
    @InjectRepository(SubscriptionPlanEntity)
    private plansRepo: Repository<SubscriptionPlanEntity>,
    @InjectRepository(SubscriptionEntity)
    private subsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentTransactionEntity)
    private txRepo: Repository<PaymentTransactionEntity>,
  ) {
    const cfg = config.get('stripe', { infer: true })!;
    if (cfg.enabled && cfg.secretKey) {
      this.stripe = new Stripe(cfg.secretKey, {
        apiVersion: '2026-10-28.endive',
      });
    }
  }

  async plans() {
    const plans = await this.plansRepo.find({ order: { monthlyPrice: 'ASC' } });
    return plans.map((p) => ({
      tier: p.tier,
      monthlyPrice: parseFloat(p.monthlyPrice),
      yearlyPrice: parseFloat(p.yearlyPrice),
      currency: p.currency,
      maxDevices: p.maxDevices,
      maxQuality: p.maxQuality,
      prioritySupport: p.prioritySupport,
      features: [], // localized client-side by tier key
    }));
  }

  async createCheckout(userId: number, tier: SubscriptionTierEnum, period: SubscriptionPeriodEnum) {
    const plan = await this.plansRepo.findOne({ where: { tier } });
    if (!plan) throw new BadRequestException('Unknown subscription tier');

    const amount = parseFloat(
      period === SubscriptionPeriodEnum.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice,
    );

    // one pending order at a time per user
    await this.txRepo.update(
      { userId, status: TransactionStatusEnum.PENDING },
      { status: TransactionStatusEnum.CANCELLED },
    );
    await this.subsRepo.update(
      { userId, status: SubscriptionStatusEnum.PENDING },
      { status: SubscriptionStatusEnum.CANCELLED },
    );

    const subscription = await this.subsRepo.save(
      this.subsRepo.create({ userId, tier, period, status: SubscriptionStatusEnum.PENDING }),
    );

    const sessionId = randomUUID();
    await this.txRepo.save(
      this.txRepo.create({
        sessionId,
        userId,
        subscriptionId: subscription.id,
        tier,
        period,
        amount: amount.toFixed(2),
        currency: plan.currency,
        status: TransactionStatusEnum.PENDING,
      }),
    );

    if (this.stripe) {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: plan.currency,
              unit_amount: Math.round(amount * 100),
              recurring: {
                interval:
                  period === SubscriptionPeriodEnum.MONTHLY ? 'month' : 'year',
              },
              product_data: {
                name: `AbsoluteCinema ${tier} (${period})`,
              },
            },
          },
        ],
        success_url: `${this.config.get('clientUrl', { infer: true })}/?payment=success&session_id=${sessionId}`,
        cancel_url: `${this.config.get('clientUrl', { infer: true })}/plans?payment=cancelled`,
        client_reference_id: sessionId,
        metadata: { sessionId },
      });
      return { checkoutUrl: session.url };
    }

    // mock mode: the SPA renders a fake gateway at this route
    return { checkoutUrl: `/mock-checkout/${sessionId}` };
  }

  /**
   * Shared success path for the Stripe webhook and the mock simulator.
   * `expectedUserId` (mock endpoints) additionally asserts ownership of the
   * order. The PAID flip is a conditional update on status='pending', so two
   * concurrent completions can never both activate a subscription.
   */
  async complete(
    sessionId: string,
    expectedUserId?: number,
  ): Promise<{ message: string }> {
    const tx = await this.txRepo.findOne({ where: { sessionId } });
    if (!tx || (expectedUserId !== undefined && tx.userId !== expectedUserId)) {
      // Same response for missing and foreign orders — no existence oracle.
      throw new NotFoundException('Order not found');
    }
    if (tx.status === TransactionStatusEnum.PAID) {
      return { message: 'Payment already processed' };
    }
    if (tx.status !== TransactionStatusEnum.PENDING) {
      throw new BadRequestException(`Order is ${tx.status}`);
    }

    const now = new Date();
    const endsAt = new Date(now);
    if (tx.period === SubscriptionPeriodEnum.MONTHLY) {
      endsAt.setMonth(endsAt.getMonth() + 1);
    } else {
      endsAt.setFullYear(endsAt.getFullYear() + 1);
    }

    // Conditional update: wins exactly once even when the webhook races us.
    const paidUpdate = await this.txRepo.update(
      { id: tx.id, status: TransactionStatusEnum.PENDING },
      { status: TransactionStatusEnum.PAID },
    );
    if ((paidUpdate.affected ?? 0) === 0) {
      return { message: 'Payment already processed' };
    }

    // expire any previously active subscription, activate the new one
    await this.subsRepo.update(
      { userId: tx.userId, status: SubscriptionStatusEnum.ACTIVE },
      { status: SubscriptionStatusEnum.EXPIRED },
    );
    if (tx.subscriptionId) {
      await this.subsRepo.update(tx.subscriptionId, {
        status: SubscriptionStatusEnum.ACTIVE,
        startsAt: now,
        endsAt,
      });
    }

    const user = await this.txRepo
      .createQueryBuilder('tx')
      .relation(PaymentTransactionEntity, 'user')
      .of(tx.id)
      .loadOne();
    if (user) {
      this.mail.sendReceipt(user.email, {
        tier: tx.tier,
        period: tx.period,
        amount: parseFloat(tx.amount),
        currency: tx.currency,
        endsAt,
      });
    }
    return { message: 'Payment completed — subscription is now active' };
  }

  async cancel(
    sessionId: string,
    expectedUserId?: number,
  ): Promise<{ message: string }> {
    const tx = await this.txRepo.findOne({ where: { sessionId } });
    if (!tx || (expectedUserId !== undefined && tx.userId !== expectedUserId)) {
      throw new NotFoundException('Order not found');
    }
    // Conditional update — never clobbers an order that just turned PAID.
    const cancelled = await this.txRepo.update(
      { id: tx.id, status: TransactionStatusEnum.PENDING },
      { status: TransactionStatusEnum.CANCELLED },
    );
    if (
      (cancelled.affected ?? 0) > 0 &&
      tx.subscriptionId
    ) {
      await this.subsRepo.update(tx.subscriptionId, {
        status: SubscriptionStatusEnum.CANCELLED,
      });
    }
    return { message: 'Payment cancelled' };
  }

  /**
   * User-initiated subscription cancellation: revokes the active
   * subscription (and any pending checkout) immediately.
   */
  async cancelSubscription(userId: number): Promise<{ message: string }> {
    const active = await this.subsRepo.findOne({
      where: { userId, status: SubscriptionStatusEnum.ACTIVE },
      order: { endsAt: 'DESC' },
    });
    if (!active) throw new BadRequestException('No active subscription to cancel');

    await this.subsRepo.update(active.id, { status: SubscriptionStatusEnum.CANCELLED });
    await this.txRepo.update(
      { userId, status: TransactionStatusEnum.PENDING },
      { status: TransactionStatusEnum.CANCELLED },
    );
    return { message: 'Subscription cancelled' };
  }

  async handleWebhook(
    payload: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    if (!this.stripe) {
      // mock mode: nothing to verify, the mock-complete endpoint drives state
      return { received: true };
    }
    const secret = this.config.get('stripe', { infer: true })!.webhookSecret;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload as Buffer, signature ?? '', secret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Webhook signature verification failed: ${message}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.metadata?.sessionId ?? session.client_reference_id;
      if (sessionId) await this.complete(sessionId);
    }
    return { received: true };
  }

  /**
   * docs/6 payment lifecycle: pending orders older than 20 minutes are
   * retried up to 3 times, then marked failed and the pending subscription
   * is cancelled. Each retry restarts the 20-minute window.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePendingOrders(): Promise<void> {
    const staleCutoff = new Date(Date.now() - 20 * 60 * 1000);
    // Filter in SQL via idx_transaction_status_created — never scan all
    // pending orders just to discard most of them in JS.
    const stale = await this.txRepo.find({
      where: {
        status: TransactionStatusEnum.PENDING,
        createdAt: LessThan(staleCutoff),
      },
    });
    for (const tx of stale) {
      if (tx.retries < 3) {
        // Conditional on status='pending' so a webhook that completes the
        // order between find and update can't be overwritten by a retry.
        const bumped = await this.txRepo.update(
          { id: tx.id, status: TransactionStatusEnum.PENDING },
          { retries: tx.retries + 1, createdAt: new Date() }, // restart window
        );
        if ((bumped.affected ?? 0) > 0) {
          this.logger.log(
            `Retry ${tx.retries + 1}/3 for pending order ${tx.sessionId}`,
          );
        }
      } else {
        const failed = await this.txRepo.update(
          { id: tx.id, status: TransactionStatusEnum.PENDING },
          { status: TransactionStatusEnum.FAILED },
        );
        if ((failed.affected ?? 0) > 0) {
          if (tx.subscriptionId) {
            // Also conditional — never cancel an already-ACTIVE subscription.
            await this.subsRepo.update(
              { id: tx.subscriptionId, status: SubscriptionStatusEnum.PENDING },
              { status: SubscriptionStatusEnum.CANCELLED },
            );
          }
          this.logger.warn(`Order ${tx.sessionId} failed after 3 retries`);
        }
      }
    }
  }

  /** Subscriptions whose endsAt passed stop counting as ACTIVE. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireFinishedSubscriptions(): Promise<void> {
    await this.subsRepo.update(
      {
        status: SubscriptionStatusEnum.ACTIVE,
        endsAt: LessThan(new Date()),
      },
      { status: SubscriptionStatusEnum.EXPIRED },
    );
  }

  assertMockMode() {
    if (this.stripe) {
      throw new NotFoundException('Mock endpoints are disabled when Stripe is enabled');
    }
  }
}
