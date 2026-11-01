import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SubscriptionPeriodEnum, SubscriptionTierEnum } from '../../users/user.entity';
import { VideoQuality } from '../../media/entities/movie.entity';

/** What a plan enforces: how many concurrent devices may stream and the
 *  highest playback quality they are allowed to request. */
export interface PlanLimits {
  maxDevices: number;
  maxQuality: VideoQuality;
  prioritySupport: boolean;
}

@Entity('subscription_plans')
export class SubscriptionPlanEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: SubscriptionTierEnum, unique: true })
  tier: SubscriptionTierEnum;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  monthlyPrice: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  yearlyPrice: string;

  @Column({ default: 'usd' })
  currency: string;

  @Column({ type: 'int', default: 1 })
  maxDevices: number;

  @Column({ type: 'enum', enum: ['480p', '720p', '1080p'], default: '720p' })
  maxQuality: VideoQuality;

  @Column({ default: false })
  prioritySupport: boolean;
}
