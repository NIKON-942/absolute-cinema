import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MovieEntity } from './movie.entity';
import { UserEntity } from '../../users/user.entity';

@Entity('watch_progress')
@Index('uq_progress_user_movie', ['userId', 'movieId'], { unique: true })
export class WatchProgressEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column()
  movieId: number;

  @Column({ type: 'double precision', default: 0 })
  positionSeconds: number;

  @Column({ type: 'double precision', default: 0 })
  durationSeconds: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @ManyToOne(() => MovieEntity)
  movie: MovieEntity;
}
