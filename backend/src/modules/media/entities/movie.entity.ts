import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActorEntity } from './actor.entity';
import { GenreEntity } from './genre.entity';
import { RatingEntity } from './rating.entity';
import { UserEntity } from '../../users/user.entity';

export type VideoQuality = '480p' | '720p' | '1080p';

export enum TranscodeStatusEnum {
  NONE = 'none',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('movies')
export class MovieEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ default: '' })
  originalTitle: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ default: '' })
  country: string;

  @Column({ default: '16+' })
  ageRating: string;

  @Column({ default: '' })
  director: string;

  @Column({ type: 'text', array: true, default: [] })
  keywords: string[];

  @Column({ type: 'varchar', nullable: true })
  posterPath: string | null;

  /** Single source of truth for uploads: local master file or remote URL. */
  @Column({ type: 'varchar', nullable: true })
  masterVideo: string | null;

  @Column({ type: 'varchar', nullable: true })
  pendingMasterVideo: string | null;

  /** Lifecycle of the background 480p/720p/1080p transcode job. */
  @Column({
    type: 'enum',
    enum: TranscodeStatusEnum,
    default: TranscodeStatusEnum.NONE,
  })
  transcodeStatus: TranscodeStatusEnum;

  @Column({ type: 'int', nullable: true })
  runtimeMinutes: number | null;

  @Column({ type: 'varchar', nullable: true })
  trailerUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  video480: string | null;

  @Column({ type: 'varchar', nullable: true })
  video720: string | null;

  @Column({ type: 'varchar', nullable: true })
  video1080: string | null;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToMany(() => GenreEntity, { eager: true })
  @JoinTable({ name: 'movie_genres' })
  genres: GenreEntity[];

  @ManyToMany(() => ActorEntity, { eager: true })
  @JoinTable({ name: 'movie_actors' })
  actors: ActorEntity[];

  @OneToMany(() => RatingEntity, (rating) => rating.movie)
  ratings: RatingEntity[];

  @ManyToMany(() => UserEntity, (user) => user.favorites)
  favoritedBy: UserEntity[];
}
