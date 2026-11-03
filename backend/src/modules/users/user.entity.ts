import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MovieEntity } from '../media/entities/movie.entity';

export enum UserRoleEnum {
  VIEWER = 'viewer',
  ADMIN = 'admin',
}

export enum SubscriptionTierEnum {
  BASIC = 'basic',
  PLUS = 'plus',
  PREMIUM = 'premium',
}

export enum SubscriptionPeriodEnum {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum SubscriptionStatusEnum {
  PENDING = 'pending',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Entity('users')
@Index('uq_users_google_id', ['googleId'], { unique: true, where: 'google_id IS NOT NULL' })
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar', nullable: true })
  googleId: string | null;

  @Column({ type: 'enum', enum: UserRoleEnum, default: UserRoleEnum.VIEWER })
  role: UserRoleEnum;

  @Column({ default: false })
  isBlocked: boolean;

  @Column({ type: 'varchar', nullable: true })
  resetTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetTokenExpiresAt: Date | null;

  /** Bumped on logout so already-issued JWTs fail validation (revocation). */
  @Column({ type: 'int', default: 0 })
  tokenVersion: number;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  loginLockedUntil: Date | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToMany(() => MovieEntity, (movie) => movie.favoritedBy)
  @JoinTable({ name: 'user_favorites' })
  favorites: MovieEntity[];
}
