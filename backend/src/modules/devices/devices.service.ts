import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  SubscriptionStatusEnum,
  SubscriptionTierEnum,
} from '../users/user.entity';
import { SubscriptionEntity } from '../payments/entities/subscription.entity';
import { PlanLimitsService } from '../payments/plan-limits.service';
import { DeviceSessionEntity } from './device-session.entity';

/** A device stops counting against the plan limit after this much silence. */
export const DEVICE_TTL_MS = 5 * 60 * 1000;

/**
 * In-process heartbeat throttle: streaming issues one request per video
 * chunk, so re-running the full advisory-lock registration for every chunk
 * is wasted DB work. A device that heartbeated this recently is trusted.
 */
const HEARTBEAT_THROTTLE_MS = 60 * 1000;

export interface DeviceSessionDto {
  deviceId: string;
  name: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface HeartbeatResult {
  activeDevices: number;
  maxDevices: number;
}

export class DeviceLimitError extends ConflictException {
  constructor(maxDevices: number, activeDevices: number) {
    super({
      statusCode: 409,
      code: 'DEVICE_LIMIT',
      message: `Device limit reached — your plan allows streaming on ${maxDevices} device${maxDevices > 1 ? 's' : ''} at a time (${activeDevices} already in use). Stop playback on another device or upgrade your plan.`,
      maxDevices,
      activeDevices,
    });
  }
}

/** Best-effort human label from a User-Agent string. */
function labelFromUserAgent(ua?: string): string | null {
  if (!ua) return null;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : null;
  const os =
    /Windows/i.test(ua) ? 'Windows'
    : /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux'
    : null;
  return [browser, os].filter(Boolean).join(' · ') || null;
}

/**
 * Concurrent-device enforcement: every streaming request heartbeats the
 * device it comes from; a heartbeat for a not-yet-registered device is
 * rejected with 409 DEVICE_LIMIT once the plan's maxDevices is reached.
 * Registration runs under a per-user advisory lock so parallel heartbeats
 * cannot both slip past the count check.
 */
@Injectable()
export class DevicesService {
  private readonly lastBeat = new Map<string, number>();

  constructor(
    private dataSource: DataSource,
    @InjectRepository(DeviceSessionEntity)
    private sessionsRepo: Repository<DeviceSessionEntity>,
    @InjectRepository(SubscriptionEntity)
    private subsRepo: Repository<SubscriptionEntity>,
    private planLimits: PlanLimitsService,
  ) {}

  private async activeTier(userId: number): Promise<SubscriptionTierEnum | null> {
    const active = await this.subsRepo.findOne({
      where: { userId, status: SubscriptionStatusEnum.ACTIVE },
      order: { endsAt: 'DESC' },
    });
    if (active && (!active.endsAt || active.endsAt.getTime() > Date.now())) {
      return active.tier;
    }
    return null;
  }

  /**
   * Registers (or refreshes) the calling device. Throws 409 DEVICE_LIMIT
   * when a new device would exceed the plan's concurrent-device limit.
   */
  async heartbeat(
    userId: number,
    deviceId: string,
    userAgent?: string,
  ): Promise<HeartbeatResult> {
    const tier = await this.activeTier(userId);
    if (!tier) throw new ForbiddenException('Active subscription required');
    const { maxDevices } = await this.planLimits.limitsFor(tier);
    const name = labelFromUserAgent(userAgent);
    const now = new Date();

    return this.dataSource.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock($1)', [userId]);

      const repo = em.getRepository(DeviceSessionEntity);
      // sessions silent for longer than the TTL no longer occupy a slot
      const cutoff = new Date(now.getTime() - DEVICE_TTL_MS);
      await repo
        .createQueryBuilder()
        .delete()
        .where('user_id = :userId AND last_seen_at < :cutoff', { userId, cutoff })
        .execute();

      const existing = await repo.findOne({ where: { userId, deviceId } });
      if (existing) {
        await repo.update(existing.id, { lastSeenAt: now, name: name ?? existing.name });
      } else {
        const active = await repo.count({ where: { userId } });
        if (active >= maxDevices) {
          throw new DeviceLimitError(maxDevices, active);
        }
        await repo.save(
          repo.create({ userId, deviceId, name, lastSeenAt: now }),
        );
      }

      return { activeDevices: await repo.count({ where: { userId } }), maxDevices };
    });
  }

  /**
   * Throttled variant for the streaming hot path: skips the registration
   * transaction when this device heartbeated moments ago. The limit is
   * still enforced on first contact and at least once per throttle window;
   * stale sessions expire via DEVICE_TTL_MS regardless.
   */
  async heartbeatThrottled(
    userId: number,
    deviceId: string,
    userAgent?: string,
  ): Promise<HeartbeatResult> {
    const key = `${userId}:${deviceId}`;
    const last = this.lastBeat.get(key);
    const now = Date.now();
    if (last !== undefined && now - last < HEARTBEAT_THROTTLE_MS) {
      // Keep the response cheap and allocation-free for chunk requests.
      return { activeDevices: -1, maxDevices: -1 };
    }
    const result = await this.heartbeat(userId, deviceId, userAgent);
    if (this.lastBeat.size > 10_000) this.lastBeat.clear();
    this.lastBeat.set(key, Date.now());
    return result;
  }

  /** Active devices of the user (stale ones pruned first). */
  async list(userId: number): Promise<{
    devices: DeviceSessionDto[];
    maxDevices: number;
  }> {
    const tier = await this.activeTier(userId);
    if (!tier) return { devices: [], maxDevices: 0 };
    const { maxDevices } = await this.planLimits.limitsFor(tier);

    const cutoff = new Date(Date.now() - DEVICE_TTL_MS);
    await this.sessionsRepo
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId AND last_seen_at < :cutoff', { userId, cutoff })
      .execute();

    const rows = await this.sessionsRepo.find({
      where: { userId },
      order: { lastSeenAt: 'DESC' },
    });
    return {
      devices: rows.map((r) => ({
        deviceId: r.deviceId,
        name: r.name,
        lastSeenAt: r.lastSeenAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      maxDevices,
    };
  }

  /** Frees a slot by ending a device session (used from the profile page). */
  async revoke(userId: number, deviceId: string): Promise<void> {
    this.lastBeat.delete(`${userId}:${deviceId}`);
    const result = await this.sessionsRepo.delete({ userId, deviceId });
    if (result.affected === 0) throw new NotFoundException('Device session not found');
  }

  /** Best-effort immediate end of a session (player closed / playback stopped). */
  async end(userId: number, deviceId: string): Promise<void> {
    this.lastBeat.delete(`${userId}:${deviceId}`);
    await this.sessionsRepo.delete({ userId, deviceId });
  }
}
