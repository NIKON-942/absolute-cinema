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
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
  UserEntity,
} from '../../users/user.entity';

@Entity('subscriptions')
@Index('idx_subscription_user_status', ['userId', 'status'])
export class SubscriptionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ type: 'enum', enum: SubscriptionTierEnum })
  tier: SubscriptionTierEnum;

  @Column({ type: 'enum', enum: SubscriptionPeriodEnum })
  period: SubscriptionPeriodEnum;

  @Column({ type: 'enum', enum: SubscriptionStatusEnum, default: SubscriptionStatusEnum.PENDING })
  status: SubscriptionStatusEnum;

  @Column({ type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', nullable: true, unique: true })
  stripeSubscriptionId: string | null;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => UserEntity)
  user: UserEntity;
}
