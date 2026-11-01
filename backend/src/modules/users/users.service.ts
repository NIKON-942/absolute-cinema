import { Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import {
  SubscriptionStatusEnum,
  UserEntity,
  UserRoleEnum,
} from './user.entity';
import { SubscriptionEntity } from '../payments/entities/subscription.entity';

export interface UserWithSubscription {
  user: UserEntity;
  activeSubscription: SubscriptionEntity | null;
  hasActiveSubscription: boolean;
}

export interface SerializedUser {
  id: number;
  email: string;
  name: string;
  role: string;
  isBlocked: boolean;
  avatarUrl: string | null;
  hasActiveSubscription: boolean;
  activeSubscription: {
    id: number;
    tier: string;
    period: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
  createdAt: string;
  lastLoginAt: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private usersRepo: Repository<UserEntity>,
    @InjectRepository(SubscriptionEntity)
    private subsRepo: Repository<SubscriptionEntity>,
    private dataSource: DataSource,
  ) {}

  async findWithSubscription(id: number): Promise<UserWithSubscription | null> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) return null;
    return this.attachSubscription(user);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepo.findOne({ where: { email: email.toLowerCase() } });
  }

  async attachSubscription(user: UserEntity): Promise<UserWithSubscription> {
    const active = await this.subsRepo.findOne({
      where: { userId: user.id, status: SubscriptionStatusEnum.ACTIVE },
      order: { endsAt: 'DESC' },
    });
    const stillValid =
      active && (!active.endsAt || active.endsAt.getTime() > Date.now());
    return {
      user,
      activeSubscription: stillValid ? active : null,
      hasActiveSubscription: Boolean(stillValid),
    };
  }

  serialize({ user, activeSubscription, hasActiveSubscription }: UserWithSubscription): SerializedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isBlocked: user.isBlocked,
      avatarUrl: user.avatarUrl ?? null,
      hasActiveSubscription,
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            tier: activeSubscription.tier,
            period: activeSubscription.period,
            status: activeSubscription.status,
            startsAt: activeSubscription.startsAt?.toISOString() ?? null,
            endsAt: activeSubscription.endsAt?.toISOString() ?? null,
          }
        : null,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  async list(search: string, page: number, limit: number) {
    const qb = this.usersRepo
      .createQueryBuilder('user')
      .orderBy('user.id', 'ASC');
    if (search) {
      qb.andWhere('(user.email ILIKE :s OR user.name ILIKE :s)', {
        s: `%${search}%`,
      });
    }
    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items: await Promise.all(
        items.map(async (u) => this.serialize(await this.attachSubscription(u))),
      ),
      total,
      page,
      limit,
    };
  }

  async updateMe(
    userId: number,
    data: {
      name?: string;
      password?: string;
      avatarUrl?: string | null;
      currentPassword?: string;
    },
  ) {
    const update: Partial<UserEntity> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.avatarUrl !== undefined) update.avatarUrl = data.avatarUrl;
    if (data.password !== undefined) {
      // Changing the password requires proving possession of the current one.
      const user = await this.usersRepo.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (!user.passwordHash) {
        throw new BadRequestException(
          'This account has no password set (Google sign-in only)',
        );
      }
      const ok =
        !!data.currentPassword &&
        (await bcrypt.compare(data.currentPassword, user.passwordHash));
      if (!ok) throw new UnauthorizedException('Current password is incorrect');
      update.passwordHash = await bcrypt.hash(data.password, 10);
      // Invalidate every JWT issued before now (stolen tokens included).
      await this.usersRepo.increment({ id: userId }, 'tokenVersion', 1);
    }
    if (Object.keys(update).length > 0) {
      await this.usersRepo.update(userId, update);
    }
    return this.requireWithSubscription(userId);
  }

  async setRole(userId: number, role: 'viewer' | 'admin') {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.role = role === 'admin' ? UserRoleEnum.ADMIN : UserRoleEnum.VIEWER;
    await this.usersRepo.save(user);
    return this.requireWithSubscription(userId);
  }

  async setBlocked(userId: number, isBlocked: boolean) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.isBlocked = isBlocked;
    await this.usersRepo.save(user);
    return this.requireWithSubscription(userId);
  }

  async remove(userId: number) {
    // Dependent rows must go first — their FKs are ON DELETE NO ACTION, so
    // deleting a user with ratings/history/orders would otherwise fail.
    await this.dataSource.transaction(async (em) => {
      await em.query('DELETE FROM ratings WHERE user_id = $1', [userId]);
      await em.query('DELETE FROM watch_progress WHERE user_id = $1', [userId]);
      await em.query('DELETE FROM user_favorites WHERE users_id = $1', [userId]);
      await em.query('DELETE FROM device_sessions WHERE user_id = $1', [userId]);
      await em.query('DELETE FROM payment_transactions WHERE user_id = $1', [
        userId,
      ]);
      await em.query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
    });
    const result = await this.usersRepo.delete(userId);
    if (result.affected === 0) throw new NotFoundException('User not found');
  }

  async requireWithSubscription(userId: number): Promise<UserWithSubscription> {
    const found = await this.findWithSubscription(userId);
    if (!found) throw new NotFoundException('User not found');
    return found;
  }

  async countUsers(): Promise<number> {
    return this.usersRepo.count();
  }

  async countUsersSince(date: Date): Promise<number> {
    return this.usersRepo
      .createQueryBuilder('u')
      .where('u.createdAt >= :date', { date })
      .getCount();
  }
}
