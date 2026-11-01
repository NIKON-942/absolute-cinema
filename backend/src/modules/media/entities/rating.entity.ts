import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { MovieEntity } from './movie.entity';
import { UserEntity } from '../../users/user.entity';

@Entity('ratings')
@Index('uq_rating_user_movie', ['userId', 'movieId'], { unique: true })
export class RatingEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column()
  movieId: number;

  /** 1..10 */
  @Column({ type: 'smallint' })
  value: number;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @ManyToOne(() => MovieEntity, (movie) => movie.ratings)
  movie: MovieEntity;
}
