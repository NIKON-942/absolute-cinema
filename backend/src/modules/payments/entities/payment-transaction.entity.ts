import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  SubscriptionPeriodEnum,
  SubscriptionTierEnum,
  UserEntity,
} from '../../users/user.entity';
import { SubscriptionEntity } from './subscription.entity';

export enum TransactionStatusEnum {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('payment_transactions')
@Index('idx_transaction_status_created', ['status', 'createdAt'])
export class PaymentTransactionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  sessionId: string;

  /** NULL after the account was deleted; the payment record itself is kept. */
  @Column({ type: 'int', nullable: true })
  userId: number | null;

  /** ID of the deleted account (pseudonym; no personal data is kept). */
  @Column({ type: 'int', nullable: true })
  formerUserId: number | null;

  @Column({ type: 'int', nullable: true })
  subscriptionId: number | null;

  @Column({ type: 'enum', enum: SubscriptionTierEnum })
  tier: SubscriptionTierEnum;

  @Column({ type: 'enum', enum: SubscriptionPeriodEnum })
  period: SubscriptionPeriodEnum;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: string;

  @Column({ default: 'usd' })
  currency: string;

  @Column({ type: 'enum', enum: TransactionStatusEnum, default: TransactionStatusEnum.PENDING })
  status: TransactionStatusEnum;

  @Column({ type: 'varchar', nullable: true })
  cancellationReason: 'expired' | 'user_cancelled' | 'superseded' | 'user_deleted' | null;

  /** Each Checkout can have at most one successor in its retry chain. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  retryOf: string | null;

  @Column({ type: 'int', default: 0 })
  retries: number;

  @Column({ type: 'varchar', nullable: true })
  stripeCheckoutId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /** Money returned for the unused part of this payment's period on a plan switch. */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 })
  refundedAmount: string;

  /** `failed`: the new plan was activated but the provider refused the refund. */
  @Column({ type: 'varchar', nullable: true })
  refundStatus: 'refunded' | 'failed' | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  stripeRefundId: string | null;

  /** Session ID of the order that replaced this payment's subscription. */
  @Column({ type: 'varchar', nullable: true })
  refundedBySessionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @ManyToOne(() => SubscriptionEntity, (sub) => sub.id, { nullable: true })
  subscription: SubscriptionEntity | null;
}
