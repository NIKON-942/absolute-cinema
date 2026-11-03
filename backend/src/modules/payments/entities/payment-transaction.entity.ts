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

  @Column()
  userId: number;

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

  @Column({ type: 'int', default: 0 })
  retries: number;

  @Column({ type: 'varchar', nullable: true })
  stripeCheckoutId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @ManyToOne(() => SubscriptionEntity, (sub) => sub.id, { nullable: true })
  subscription: SubscriptionEntity | null;
}
