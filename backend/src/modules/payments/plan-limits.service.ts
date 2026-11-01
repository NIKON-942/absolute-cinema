import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VideoQuality } from '../media/entities/movie.entity';
import { SubscriptionTierEnum } from '../users/user.entity';
import { PlanLimits, SubscriptionPlanEntity } from './entities/subscription-plan.entity';

/** Ordered ranking used to compare a requested quality against a plan cap. */
export const QUALITY_RANK: Record<VideoQuality, number> = {
  '480p': 0,
  '720p': 1,
  '1080p': 2,
};

/** Fallback when a plan row is missing (fresh database before seeding). */
const DEFAULT_LIMITS: Record<SubscriptionTierEnum, PlanLimits> = {
  [SubscriptionTierEnum.BASIC]: { maxDevices: 1, maxQuality: '720p', prioritySupport: false },
  [SubscriptionTierEnum.PLUS]: { maxDevices: 2, maxQuality: '1080p', prioritySupport: false },
  [SubscriptionTierEnum.PREMIUM]: { maxDevices: 4, maxQuality: '1080p', prioritySupport: true },
};

/**
 * Resolves the enforcement limits (maxDevices / maxQuality) of a tier from
 * subscription_plans. Sits on the per-request streaming path, so rows are
 * cached in memory for a short TTL.
 */
@Injectable()
export class PlanLimitsService {
  /** Per-entry timestamps: a hot tier must not keep a cold tier stale. */
  private cache = new Map<SubscriptionTierEnum, { limits: PlanLimits; at: number }>();
  private readonly ttlMs = 30_000;

  constructor(
    @InjectRepository(SubscriptionPlanEntity)
    private plansRepo: Repository<SubscriptionPlanEntity>,
  ) {}

  async limitsFor(tier: SubscriptionTierEnum): Promise<PlanLimits> {
    const cached = this.cache.get(tier);
    if (!cached || Date.now() - cached.at > this.ttlMs) {
      const row = await this.plansRepo.findOne({ where: { tier } });
      if (row) {
        const limits: PlanLimits = {
          maxDevices: row.maxDevices,
          maxQuality: row.maxQuality,
          prioritySupport: row.prioritySupport,
        };
        this.cache.set(tier, { limits, at: Date.now() });
        return limits;
      }
    }
    return cached?.limits ?? DEFAULT_LIMITS[tier];
  }
}
