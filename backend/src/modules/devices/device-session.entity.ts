import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';

/**
 * One row per (user, browser/device). The SPA generates a persistent
 * deviceId (localStorage UUID) and heartbeats it while streaming; rows not
 * refreshed within the TTL are treated as ended.
 */
@Entity('device_sessions')
@Index('idx_device_sessions_user_last_seen', ['userId', 'lastSeenAt'])
export class DeviceSessionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  /** Client-generated stable id (UUID) kept in localStorage. */
  @Column()
  deviceId: string;

  /** Human-readable label derived from the User-Agent. */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => UserEntity)
  user: UserEntity;
}
