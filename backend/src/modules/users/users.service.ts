import { escapeLike } from '../../common/helpers/escape-like';
import { Injectable, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  SubscriptionStatusEnum,
  UserEntity,
  UserRoleEnum,
} from './user.entity';
import { SubscriptionEntity } from '../payments/entities/subscription.entity';
import { imageReference, removeImageIfUnused } from '../media/image-upload';

// user together with his current subscription
export interface UserWithSubscription {
  user: UserEntity;
  activeSubscription: SubscriptionEntity | null;
  hasActiveSubscription: boolean;
}

// user data that is sent to the frontend (no password hash and tokens)
export interface SerializedUser {
  id: number;
  email: string;
  name: string;
  role: string;
  isBlocked: boolean;
  avatarUrl: string | null;
  googleLinked: boolean;
  hasActiveSubscription: boolean;
  activeSubscription: {
    id: number;
    tier: string;
    period: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    cancelAtPeriodEnd: boolean;
    autoRenew: boolean;
  } | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Work with users: profile, roles, blocking, deleting. */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private usersRepo: Repository<UserEntity>,
    @InjectRepository(SubscriptionEntity)
    private subsRepo: Repository<SubscriptionEntity>,
    private dataSource: DataSource,
  ) {}

  /** Finds a user by id and adds the subscription. */
  async findWithSubscription(id: number): Promise<UserWithSubscription | null> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) return null;
    return this.attachSubscription(user);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepo.findOne({ where: { email: email.toLowerCase() } });
  }

  /** Finds the active subscription that has not expired yet. */
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

  /** Turns a user into a safe object for the API response. */
  serialize({ user, activeSubscription, hasActiveSubscription }: UserWithSubscription): SerializedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isBlocked: user.isBlocked,
      avatarUrl: user.avatarUrl ?? null,
      googleLinked: Boolean(user.googleId),
      hasActiveSubscription,
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            tier: activeSubscription.tier,
            period: activeSubscription.period,
            status: activeSubscription.status,
            startsAt: activeSubscription.startsAt?.toISOString() ?? null,
            endsAt: activeSubscription.endsAt?.toISOString() ?? null,
            cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
            autoRenew: Boolean(activeSubscription.stripeSubscriptionId && !activeSubscription.cancelAtPeriodEnd),
          }
        : null,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  /** Paginated user list for the admin panel, can search by e-mail, name or id. */
  async list(search: string, page: number, limit: number) {
    const qb = this.usersRepo
      .createQueryBuilder('user')
      .orderBy('user.id', 'ASC');
    if (search) {
      qb.andWhere(`(user.email ILIKE :s ESCAPE '\\' OR user.name ILIKE :s ESCAPE '\\' OR CAST(user.id AS TEXT) = :id)`, {
        s: `%${escapeLike(search)}%`,
        id: search.trim(),
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

  /** Changes the own profile. A new password needs the current one and logs out other sessions. */
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
    if (data.avatarUrl !== undefined) update.avatarUrl = imageReference(data.avatarUrl);
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
      if (!ok) throw new BadRequestException('Current password is incorrect');
      update.passwordHash = await bcrypt.hash(data.password, 10);
      // Invalidate every JWT issued before now (stolen tokens included).
    }
    const previousAvatar = update.avatarUrl !== undefined
      ? (await this.usersRepo.findOne({ where: { id: userId }, select: { id: true, avatarUrl: true } }))?.avatarUrl : null;
    if (Object.keys(update).length > 0) {
      await this.usersRepo.createQueryBuilder().update().set({ ...update,
        ...(data.password !== undefined ? { tokenVersion: () => 'token_version + 1', resetTokenHash: null, resetTokenExpiresAt: null } : {}),
      }).where('id = :userId', { userId }).execute();
    }
    if (previousAvatar) await removeImageIfUnused(this.dataSource, previousAvatar);
    return this.requireWithSubscription(userId);
  }

  /** Changes the role. Only a head admin can do it. */
  async setRole(userId: number, role: 'viewer' | 'admin' | 'head_admin', actorId: number) {
    if (!Object.values(UserRoleEnum).includes(role as UserRoleEnum)) throw new BadRequestException('Invalid role');
    await this.dataSource.transaction(async em => {
      const user = await this.authorizeManagement(em, actorId, userId, true, role !== 'head_admin');
      await em.update(UserEntity, user.id, { role: role as UserRoleEnum });
    });
    return this.requireWithSubscription(userId);
  }

  /** Blocks or unblocks the user. */
  async setBlocked(userId: number, isBlocked: boolean, actorId: number) {
    await this.dataSource.transaction(async em => {
      const user = await this.authorizeManagement(em, actorId, userId, false, isBlocked);
      await em.update(UserEntity, user.id, { isBlocked });
    });
    return this.requireWithSubscription(userId);
  }

  /**
   * `release` runs after the authorization checks and before any row is
   * deleted (payments use it to cancel the Stripe subscription and detach the
   * payment history, which is kept).
   */
  async remove(userId: number, actorId: number, release?: (em: EntityManager) => Promise<void>) {
    // Dependent rows must go first — their FKs are ON DELETE NO ACTION, so
    // deleting a user with ratings/history would otherwise fail.
    await this.dataSource.transaction(async (em) => {
      await this.authorizeManagement(em, actorId, userId, false, true);
      await release?.(em);
      await em.query('DELETE FROM ratings WHERE user_id = $1', [userId]);
      await em.query('DELETE FROM watch_progress WHERE user_id = $1', [userId]);
      await em.query('DELETE FROM user_favorites WHERE users_id = $1', [userId]);
      await em.query('DELETE FROM device_sessions WHERE user_id = $1', [userId]);
      await em.query('DELETE FROM subscriptions WHERE user_id = $1', [userId]);
      const result = await em.delete(UserEntity, userId);
      if (result.affected === 0) throw new NotFoundException('User not found');
    });
  }

  // checks that the admin may do this action with this user (not himself, not the last head admin)
  private async authorizeManagement(em: EntityManager, actorId: number, userId: number, changesRole: boolean, removesAccess: boolean): Promise<UserEntity> {
    if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new ForbiddenException('Administrative access required');
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new BadRequestException('Invalid user ID');
    // Re-read both identities after the lock: a request admitted by a guard
    // may have lost its privileges while another management request committed.
    await em.query('SELECT pg_advisory_xact_lock(1702, 1)');
    const actor = await em.findOneBy(UserEntity, { id: actorId });
    if (!actor || actor.isBlocked || ![UserRoleEnum.ADMIN, UserRoleEnum.HEAD_ADMIN].includes(actor.role)) {
      throw new ForbiddenException('Administrative access required');
    }
    if (actorId === userId) throw new ForbiddenException('You cannot change your own administrative access');
    const user = await em.findOneBy(UserEntity, { id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (actor.role !== UserRoleEnum.HEAD_ADMIN && (changesRole || user.role !== UserRoleEnum.VIEWER)) {
      throw new ForbiddenException('Only a head administrator can manage administrative access');
    }
    if (removesAccess && user.role === UserRoleEnum.HEAD_ADMIN && !user.isBlocked
      && await em.countBy(UserEntity, { role: UserRoleEnum.HEAD_ADMIN, isBlocked: false }) <= 1) {
      throw new BadRequestException('Cannot remove access from the last active head administrator');
    }
    return user;
  }

  /** Same as findWithSubscription, but throws 404 if there is no user. */
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
