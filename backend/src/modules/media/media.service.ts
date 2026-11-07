import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, statSync } from 'fs';
import * as fs from 'fs';
import { basename, join } from 'path';
import { rm } from 'fs/promises';
import { EntityManager, In, Repository } from 'typeorm';
import { Request, Response } from 'express';
import { ActorEntity } from './entities/actor.entity';
import { GenreEntity } from './entities/genre.entity';
import { MovieEntity, VideoQuality } from './entities/movie.entity';
import { RatingEntity } from './entities/rating.entity';
import { WatchProgressEntity } from './entities/watch-progress.entity';
import { CountryEntity } from './entities/country.entity';
import { DirectorEntity } from './entities/director.entity';
import {
  MASTERS_DIR,
  POSTERS_DIR,
  VIDEOS_DIR,
} from './media.constants';
import { QUALITY_RANK } from '../payments/plan-limits.service';
import { TranscodeService } from './transcode.service';
import { validateUploadedVideo } from './upload-validation';
import { imageReference } from './image-upload';
import { movieInput, MovieInput, text, integer } from './media-input';

const QUALITY_COLUMNS: Record<VideoQuality, keyof MovieEntity> = {
  '480p': 'video480',
  '720p': 'video720',
  '1080p': 'video1080',
};

function posterUrl(path: string | null): string {
  if (!path) return '';
  return /^(https?:\/\/|\/api\/media\/posters\/)/i.test(path)
    ? path : `/api/media/posters/${path}`;
}

export interface MovieDto {
  id: number;
  title: string;
  isHidden: boolean;
  originalTitle: string;
  description: string;
  year: number;
  country: string;
  countryId: number | null;
  ageRating: string;
  director: string;
  directorId: number | null;
  runtimeMinutes: number | null;
  trailerUrl: string | null;
  keywords: string[];
  posterUrl: string;
  masterVideoUrl: string | null;
  transcodeStatus: 'none' | 'processing' | 'ready' | 'failed';
  genres: { id: number; name: string }[];
  actors: { id: number; name: string; photoUrl?: string }[];
  viewCount: number;
  averageRating: number;
  userRating: number | null;
  isFavorite: boolean;
  availableQualities: VideoQuality[];
  createdAt: string;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(MovieEntity)
    private moviesRepo: Repository<MovieEntity>,
    @InjectRepository(GenreEntity)
    private genresRepo: Repository<GenreEntity>,
    @InjectRepository(ActorEntity)
    private actorsRepo: Repository<ActorEntity>,
    @InjectRepository(CountryEntity)
    private countriesRepo: Repository<CountryEntity>,
    @InjectRepository(DirectorEntity)
    private directorsRepo: Repository<DirectorEntity>,
    @InjectRepository(RatingEntity)
    private ratingsRepo: Repository<RatingEntity>,
    @InjectRepository(WatchProgressEntity)
    private progressRepo: Repository<WatchProgressEntity>,
    private transcodeService: TranscodeService,
  ) {}

  // ---------- catalog ----------

  async listMovies(filters: {
    search?: string;
    genre?: string;
    genreIds?: number[];
    year?: string;
    yearFrom?: string;
    yearTo?: string;
    country?: string;
    ageRating?: string;
    sort?: string;
    page: number;
    limit: number;
  }, userId?: number, visibility: 'published' | 'hidden' | 'all' = 'published') {
    const qb = this.moviesRepo
      .createQueryBuilder('movie')
      .leftJoinAndSelect('movie.genres', 'genre')
      .leftJoinAndSelect('movie.actors', 'actor')
      .leftJoinAndSelect('movie.countryRecord', 'countryRecord')
      .leftJoinAndSelect('movie.directorRecord', 'directorRecord');

    if (visibility !== 'all') {
      qb.andWhere('movie.isHidden = :isHidden', { isHidden: visibility === 'hidden' });
    }

    if (filters.search) {
      qb.andWhere(
        '(movie.title ILIKE :s OR movie.originalTitle ILIKE :s OR movie.description ILIKE :s)',
        { s: `%${filters.search}%` },
      );
    }
    if (filters.genreIds?.length) {
      // EXISTS filters the movie without trimming its loaded genre collection.
      qb.andWhere(`EXISTS (SELECT 1 FROM movie_genres mg WHERE mg.movies_id = movie.id AND mg.genres_id IN (:...genreIds))`, { genreIds: filters.genreIds });
    } else if (filters.genre) {
      qb.andWhere('EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genres_id WHERE mg.movies_id = movie.id AND g.name = :genre)', { genre: filters.genre });
    }
    if (filters.year && /^\d{4}$/.test(filters.year)) {
      qb.andWhere('movie.year = :year', { year: parseInt(filters.year, 10) });
    }
    if (filters.yearFrom && /^\d{4}$/.test(filters.yearFrom)) {
      qb.andWhere('movie.year >= :yearFrom', {
        yearFrom: parseInt(filters.yearFrom, 10),
      });
    }
    if (filters.yearTo && /^\d{4}$/.test(filters.yearTo)) {
      qb.andWhere('movie.year <= :yearTo', {
        yearTo: parseInt(filters.yearTo, 10),
      });
    }
    if (filters.country) {
      qb.andWhere('countryRecord.name ILIKE :c', { c: `%${filters.country}%` });
    }
    if (filters.ageRating) {
      qb.andWhere('movie.ageRating = :ar', { ar: filters.ageRating });
    }

    const avg = qb
      .subQuery()
      .select('COALESCE(AVG(r.value), 0)')
      .from(RatingEntity, 'r')
      .where('r.movieId = movie.id')
      .getQuery();

    switch (filters.sort) {
      case 'rating':
        qb.addSelect(avg, 'catalog_rating').orderBy('catalog_rating', 'DESC');
        break;
      case 'newest':
        qb.orderBy('movie.createdAt', 'DESC');
        break;
      case 'popularity':
      default:
        qb.orderBy('movie.viewCount', 'DESC');
    }

    qb.addOrderBy('movie.id', 'ASC');
    qb.skip((filters.page - 1) * filters.limit).take(filters.limit);
    const [items, total] = await qb.getManyAndCount();
    return {
      items: await Promise.all(items.map((m) => this.toDto(m, userId))),
      total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  async getMovie(id: number, userId?: number, includeHidden = false): Promise<MovieDto> {
    const movie = await this.moviesRepo.findOne({
      where: { id, ...(includeHidden ? {} : { isHidden: false }) },
      relations: ['genres', 'actors'],
    });
    if (!movie) throw new NotFoundException('Movie not found');
    return this.toDto(movie, userId);
  }

  async getMovieEntity(id: number): Promise<MovieEntity> {
    const movie = await this.moviesRepo.findOne({ where: { id } });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
  }

  /** Public access must check visibility even when the caller knows the ID. */
  async getPublishedMovieEntity(id: number): Promise<MovieEntity> {
    const movie = await this.moviesRepo.findOne({ where: { id, isHidden: false } });
    if (!movie) throw new NotFoundException('Movie not found');
    return movie;
  }

  async setVisibility(id: number, isHidden: boolean): Promise<MovieDto> {
    const result = await this.moviesRepo.update(id, { isHidden });
    if (!result.affected) throw new NotFoundException('Movie not found');
    return this.getMovie(id, undefined, true);
  }

  async genres(): Promise<GenreEntity[]> {
    return this.genresRepo.find({ order: { name: 'ASC' } });
  }

  async actors(): Promise<ActorEntity[]> {
    return this.actorsRepo.find({ order: { name: 'ASC' } });
  }

  async countries(): Promise<CountryEntity[]> {
    return this.countriesRepo.find({ order: { name: 'ASC' } });
  }

  async directors(): Promise<DirectorEntity[]> {
    return this.directorsRepo.find({ order: { name: 'ASC' } });
  }

  /** FR-33: related movies — most shared genres, then popularity. */
  async similar(movieId: number, userId?: number): Promise<MovieDto[]> {
    const base = await this.moviesRepo.findOne({
      where: { id: movieId, isHidden: false },
      relations: ['genres'],
    });
    if (!base) throw new NotFoundException('Movie not found');
    const genreIds = base.genres.map((g) => g.id);

    const qb = this.moviesRepo
      .createQueryBuilder('movie')
      .leftJoinAndSelect('movie.genres', 'genre')
      .leftJoinAndSelect('movie.actors', 'actor')
      .leftJoinAndSelect('movie.countryRecord', 'countryRecord')
      .leftJoinAndSelect('movie.directorRecord', 'directorRecord')
      .where('movie.id != :id', { id: movieId })
      .andWhere('movie.isHidden = :isHidden', { isHidden: false });

    if (genreIds.length > 0) {
      qb.andWhere('genre.id IN (:...genreIds)', { genreIds }).addSelect(
        (sub) =>
          sub
            .select('COUNT(mg2.genres_id)')
            .from('movie_genres', 'mg2')
            .where('mg2.movies_id = movie.id')
            .andWhere('mg2.genres_id IN (:...genreIds)', { genreIds }),
        'shared_genres',
      );
      qb.orderBy('shared_genres', 'DESC');
    } else if (base.directorId) {
      qb.andWhere('movie.directorId = :directorId', { directorId: base.directorId });
    }

    qb.addOrderBy('movie.viewCount', 'DESC').take(8);
    const movies = await qb.getMany();
    return Promise.all(movies.map((m) => this.toDto(m, userId)));
  }

  // ---------- favorites / ratings / progress ----------

  async toggleFavorite(movieId: number, userId: number) {
    await this.getPublishedMovieEntity(movieId);
    // Single-statement writes on the join table — the previous
    // load-modify-save of the whole favoritedBy relation lost updates when
    // two requests toggled concurrently.
    const existing = await this.moviesRepo.query(
      'SELECT 1 FROM user_favorites WHERE movies_id = $1 AND users_id = $2',
      [movieId, userId],
    );
    const has = Array.isArray(existing) && existing.length > 0;
    if (has) {
      await this.moviesRepo.query(
        'DELETE FROM user_favorites WHERE movies_id = $1 AND users_id = $2',
        [movieId, userId],
      );
    } else {
      await this.moviesRepo.query(
        'INSERT INTO user_favorites (movies_id, users_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [movieId, userId],
      );
    }
    return { isFavorite: !has };
  }

  async favorites(userId: number) {
    const movies = await this.moviesRepo
      .createQueryBuilder('movie')
      .innerJoin('user_favorites', 'uf', 'uf.movies_id = movie.id')
      .where('uf.users_id = :userId', { userId })
      .andWhere('movie.isHidden = :isHidden', { isHidden: false })
      .leftJoinAndSelect('movie.genres', 'genre')
      .leftJoinAndSelect('movie.actors', 'actor')
      .leftJoinAndSelect('movie.countryRecord', 'countryRecord')
      .leftJoinAndSelect('movie.directorRecord', 'directorRecord')
      .getMany();
    return Promise.all(movies.map((m) => this.toDto(m, userId)));
  }

  async setRating(movieId: number, userId: number, value: number) {
    await this.getPublishedMovieEntity(movieId);
    integer(value, 'rating', 1, 10);
    await this.moviesRepo.manager.transaction(async em => {
      await em.query('SELECT pg_advisory_xact_lock($1, $2)', [movieId, userId]);
      await em.upsert(RatingEntity, { movieId, userId, value }, ['movieId', 'userId']);
      await em.query('INSERT INTO rating_events (movie_id, user_id, value, created_at) VALUES ($1, $2, $3, clock_timestamp())', [movieId, userId, value]);
    });
    return {
      averageRating: await this.averageRating(movieId),
      userRating: value,
    };
  }

  async deleteRating(movieId: number, userId: number) {
    await this.getPublishedMovieEntity(movieId);
    await this.moviesRepo.manager.transaction(async em => {
      // Serialize updates and removals of the same user's rating.
      await em.query('SELECT pg_advisory_xact_lock($1, $2)', [movieId, userId]);
      const removed = await em.delete(RatingEntity, { movieId, userId });
      if (removed.affected) await em.query('INSERT INTO rating_events (movie_id, user_id, value, created_at) VALUES ($1, $2, NULL, clock_timestamp())', [movieId, userId]);
    });
    return {
      averageRating: await this.averageRating(movieId),
      userRating: null,
    };
  }

  async saveProgress(
    movieId: number,
    userId: number,
    positionSeconds: number,
    durationSeconds: number,
  ) {
    await this.getPublishedMovieEntity(movieId);
    let progress = await this.progressRepo.findOne({
      where: { movieId, userId },
    });
    if (!progress) {
      progress = this.progressRepo.create({ movieId, userId });
    }
    progress.positionSeconds = positionSeconds;
    progress.durationSeconds = durationSeconds;
    await this.progressRepo.save(progress);
    return { message: 'Progress saved' };
  }

  async listProgress(userId: number) {
    const rows = await this.progressRepo.find({
      where: { userId, movie: { isHidden: false } },
      relations: ['movie'],
      order: { updatedAt: 'DESC' },
    });
    return rows.map((r) => ({
      movieId: r.movieId,
      movieTitle: r.movie.title,
      year: r.movie.year,
      genres: (r.movie.genres ?? []).map((g) => ({ id: g.id, name: g.name })),
      posterUrl: posterUrl(r.movie.posterPath),
      positionSeconds: r.positionSeconds,
      durationSeconds: r.durationSeconds,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------- streaming ----------

  /**
   * A rendition is streamable only when its path is linked in the DB, i.e.
   * its transcode fully finished — never a file ffmpeg is still writing.
   */
  resolveVideoFile(movie: MovieEntity, quality: VideoQuality): string | null {
    const linked = movie[QUALITY_COLUMNS[quality]] as string | null;
    if (!linked) return null;
    if (/^https?:\/\//i.test(linked)) return linked; // remote URL
    const path = join(VIDEOS_DIR, linked);
    return existsSync(path) ? path : null;
  }

  availableQualities(movie: MovieEntity): VideoQuality[] {
    return (['480p', '720p', '1080p'] as VideoQuality[]).filter(
      (q) => this.resolveVideoFile(movie, q) !== null,
    );
  }

  /**
   * Falls back to the best ready quality when the requested one is not
   * available yet (e.g. still transcoding); never falls back above the
   * plan's max quality; null when nothing is ready.
   */
  private resolveStreamableFile(
    movie: MovieEntity,
    quality: VideoQuality,
    maxQuality?: VideoQuality,
  ): string | null {
    let filePath = this.resolveVideoFile(movie, quality);
    if (!filePath) {
      const inPlan = this.availableQualities(movie).filter(
        (q) => !maxQuality || QUALITY_RANK[q] <= QUALITY_RANK[maxQuality],
      );
      const bestReady = inPlan.pop();
      if (!bestReady) return null;
      filePath = this.resolveVideoFile(movie, bestReady);
    }
    return filePath;
  }

  /** Streams the file honoring HTTP Range requests (206 Partial Content). */
  stream(
    movie: MovieEntity,
    quality: VideoQuality,
    rangeHeader: string | undefined,
    req: Request,
    res: Response,
    maxQuality?: VideoQuality,
  ): void {
    const filePath = this.resolveStreamableFile(movie, quality, maxQuality);
    if (!filePath) {
      throw new ConflictException(
        'Video is being processed — no quality is ready yet',
      );
    }

    if (/^https?:\/\//i.test(filePath)) {
      // remote asset configured by URL (FR-29) — let the client fetch it
      res.redirect(filePath);
      return;
    }

    const size = statSync(filePath).size;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');

    let start = 0;
    let end = size - 1;
    let partial = false;

    if (rangeHeader) {
      // Anchored: multi-range ("bytes=0-1,5-9") and malformed units don't
      // match and are ignored per RFC 9110 (full body is served instead).
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      const satisfiable =
        match && (match[1] !== '' || match[2] !== '') &&
        !(match[1] === '' && match[2] === '0');
      if (!satisfiable || !match) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      if (match[1] === '') {
        // Suffix form "bytes=-N" → the FINAL N bytes, not the first ones.
        const suffixLength = parseInt(match[2], 10);
        start = Math.max(0, size - suffixLength);
        end = size - 1;
      } else {
        start = parseInt(match[1], 10);
        end = match[2]
          ? Math.min(parseInt(match[2], 10), size - 1)
          : size - 1;
        if (end < start) {
          res.status(416).setHeader('Content-Range', `bytes */${size}`);
          res.end();
          return;
        }
      }
      partial = true;
    }

    res.status(partial ? 206 : 200);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  headStream(
    movie: MovieEntity,
    quality: VideoQuality,
    res: Response,
    maxQuality?: VideoQuality,
  ): void {
    const filePath = this.resolveStreamableFile(movie, quality, maxQuality);
    if (!filePath) {
      throw new ConflictException(
        'Video is being processed — no quality is ready yet',
      );
    }
    if (/^https?:\/\//i.test(filePath)) {
      res.redirect(302, filePath);
      return;
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', statSync(filePath).size);
    res.status(200).end();
  }

  /** The client reports an actual Play event. Range requests never count views. */
  async recordPlayback(movieId: number, userId: number, playbackId: string) {
    if (typeof playbackId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(playbackId)) {
      throw new BadRequestException('playbackId must contain 16–100 letters, digits, underscores or hyphens');
    }
    await this.getPublishedMovieEntity(movieId);
    await this.moviesRepo.manager.transaction(async em => {
      const rows = await em.query(`INSERT INTO playback_events (movie_id, user_id, playback_id)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`, [movieId, userId, playbackId]);
      if (rows.length) await em.increment(MovieEntity, { id: movieId }, 'viewCount', 1);
    });
    return { message: 'Playback recorded' };
  }

  async averageRating(movieId: number): Promise<number> {
    const row = await this.ratingsRepo
      .createQueryBuilder('r')
      .select('COALESCE(AVG(r.value), 0)', 'avg')
      .where('r.movieId = :movieId', { movieId })
      .getRawOne<{ avg: string | number }>();
    return Math.round(Number(row?.avg ?? 0) * 10) / 10;
  }

  async toDto(movie: MovieEntity, userId?: number): Promise<MovieDto> {
    const [averageRating, userRating, isFavorite] = await Promise.all([
      this.averageRating(movie.id),
      userId
        ? this.ratingsRepo
            .findOne({ where: { movieId: movie.id, userId } })
            .then((r) => r?.value ?? null)
        : Promise.resolve(null),
      userId
        ? this.moviesRepo
            .createQueryBuilder('movie')
            .innerJoin('user_favorites', 'uf', 'uf.movies_id = movie.id')
            .where('movie.id = :id AND uf.users_id = :userId', {
              id: movie.id,
              userId,
            })
            .getExists()
        : Promise.resolve(false),
    ]);

    return {
      id: movie.id,
      title: movie.title,
      isHidden: movie.isHidden ?? false,
      originalTitle: movie.originalTitle,
      description: movie.description,
      year: movie.year,
      country: movie.country,
      countryId: movie.countryId ?? null,
      ageRating: movie.ageRating,
      director: movie.director,
      directorId: movie.directorId ?? null,
      runtimeMinutes: movie.runtimeMinutes ?? null,
      trailerUrl: movie.trailerUrl ?? null,
      keywords: movie.keywords ?? [],
      posterUrl: posterUrl(movie.posterPath),
      masterVideoUrl: movie.masterVideo
        ? /^https?:\/\//i.test(movie.masterVideo)
          ? movie.masterVideo
          : null
        : null,
      transcodeStatus: movie.transcodeStatus ?? 'none',
      genres: (movie.genres ?? []).map((g) => ({ id: g.id, name: g.name })),
      actors: (movie.actors ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        photoUrl: a.photoUrl ?? undefined,
      })),
      viewCount: movie.viewCount,
      averageRating,
      userRating,
      isFavorite,
      availableQualities: this.availableQualities(movie),
      createdAt: movie.createdAt.toISOString(),
    };
  }

  // ---------- admin CRUD ----------

  private async references(input: MovieInput, em: EntityManager): Promise<Partial<MovieEntity>> {
    const patch: Partial<MovieEntity> = {};
    for (const [field, entity] of [['country', CountryEntity], ['director', DirectorEntity]] as const) {
      const key = `${field}Id` as 'countryId' | 'directorId';
      if (input[key] !== undefined || input[field] !== undefined) {
        const id = input[key];
        const name = input[field];
        if (id === null || name === '') { patch[key] = null; continue; }
        const row = await em.findOne(entity as typeof CountryEntity, {
          where: id !== undefined ? { id } : { name }, lock: { mode: 'pessimistic_read' },
        });
        if (!row) throw new BadRequestException(`${field}: referenced record does not exist`);
        patch[key] = row.id;
      }
    }
    for (const [key, field, entity] of [['genreIds', 'genres', GenreEntity], ['actorIds', 'actors', ActorEntity]] as const) {
      const ids = input[key];
      if (ids === undefined) continue;
      const rows = ids.length ? await em.find(entity as typeof GenreEntity, { where: { id: In(ids) }, lock: { mode: 'pessimistic_read' } }) : [];
      if (rows.length !== ids.length) throw new BadRequestException(`${key}: one or more referenced records do not exist`);
      if (field === 'genres') patch.genres = rows;
      else patch.actors = rows as ActorEntity[];
    }
    return patch;
  }

  private metadata(input: MovieInput): Partial<MovieEntity> {
    const { country, director, genreIds, actorIds, posterUrl, masterVideoUrl, ...fields } = input;
    // Uploaded movie posters are stored as filenames; the API exposes a URL.
    return { ...fields, ...(posterUrl !== undefined
      ? { posterPath: posterUrl?.replace(/^\/api\/media\/posters\//i, '') ?? null } : {}) };
  }

  async posterIsUsed(filename: string): Promise<boolean> {
    return await this.moviesRepo.countBy({ posterPath: filename }) > 0;
  }

  async createMovie(body: Record<string, unknown>, posterPath?: string | null) {
    const input = movieInput(body, true);
    const saved = await this.moviesRepo.manager.transaction(async em => {
      const movie = em.create(MovieEntity, { ...this.metadata(input), ...await this.references(input, em),
        ...(posterPath ? { posterPath } : {}) });
      return em.save(movie);
    });
    if (input.masterVideoUrl) await this.setMasterVideoUrl(saved.id, input.masterVideoUrl);
    return this.getMovie(saved.id, undefined, true);
  }

  /**
   * FR-29/master pipeline: registers an uploaded master file (already stored
   * in storage/masters by the controller) and kicks off background
   * transcoding into 480p/720p/1080p.
   */
  async attachMasterVideo(id: number, masterFilename: string): Promise<MovieDto> {
    const movie = await this.getMovieEntity(id);
    try {
      validateUploadedVideo(await this.transcodeService.probe(join(MASTERS_DIR, masterFilename)), masterFilename);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Uploaded file is not a valid MP4 or WebM video');
    }
    await this.transcodeService.enqueue(movie.id, masterFilename);
    return this.getMovie(id, undefined, true);
  }

  /** Same pipeline, but the master is a remote URL (ffmpeg reads it directly). */
  async setMasterVideoUrl(id: number, url: string): Promise<MovieDto> {
    await this.getMovieEntity(id);
    await this.transcodeService.enqueue(id, url);
    return this.getMovie(id, undefined, true);
  }

  async transcodeJob(movieId: number) {
    const movie = await this.getMovieEntity(movieId);
    const job = this.transcodeService.jobInfo(movieId);
    if (job) return job;
    return {
      movieId,
      status: movie.transcodeStatus,
      qualities: ['480p', '720p', '1080p'].filter(q => movie[QUALITY_COLUMNS[q as VideoQuality]]),
      progress: movie.transcodeStatus === 'ready' ? 100 : null,
      phase: movie.transcodeStatus === 'processing' ? 'unavailable' : movie.transcodeStatus,
      currentQuality: null,
      targetQualities: [],
    };
  }

  async updateMovie(
    id: number,
    body: Record<string, unknown>,
    posterPath?: string | null,
  ) {
    const input = movieInput(body, false);
    await this.moviesRepo.manager.transaction(async em => {
      const movie = await em.findOne(MovieEntity, { where: { id }, lock: { mode: 'pessimistic_write' }, loadEagerRelations: false });
      if (!movie) throw new NotFoundException('Movie not found');
      Object.assign(movie, this.metadata(input), await this.references(input, em), posterPath ? { posterPath } : {});
      await em.save(movie);
    });
    if (input.masterVideoUrl) await this.setMasterVideoUrl(id, input.masterVideoUrl);
    return this.getMovie(id, undefined, true);
  }

  async removeMovie(id: number) {
    const movie = await this.moviesRepo.manager.transaction(async em => {
      const movie = await em.findOne(MovieEntity, { where: { id }, lock: { mode: 'pessimistic_write' }, loadEagerRelations: false });
      if (!movie) throw new NotFoundException('Movie not found');
      if (movie.transcodeStatus === 'processing') throw new ConflictException('Wait for video conversion before deleting this movie');
      await em.delete(WatchProgressEntity, { movieId: id });
      await em.delete(RatingEntity, { movieId: id });
      await em.query('DELETE FROM user_favorites WHERE movies_id = $1', [id]);
      await em.delete(MovieEntity, id);
      return movie;
    });
    // Delete only owned local basenames, and only after the DB commit.
    const files = [[MASTERS_DIR, movie.masterVideo], [POSTERS_DIR, movie.posterPath],
      ...[movie.video480, movie.video720, movie.video1080].map(file => [VIDEOS_DIR, file])];
    for (const [directory, file] of files) {
      if (directory && file && basename(file) === file && !['.', '..'].includes(file)) {
        await rm(join(directory, file), { force: true }).catch(() => undefined);
      }
    }
  }

  // ---------- genres / actors ----------

  private async saveDictionary<T extends GenreEntity>(repo: Repository<T>, name: string, id?: number, extra: Record<string, unknown> = {}) {
    const cleaned = text(name, 'name', 255, true).replace(/\s+/g, ' ');
    const duplicate = repo.createQueryBuilder('entry')
      .where("LOWER(REGEXP_REPLACE(TRIM(entry.name), '[[:space:]]+', ' ', 'g')) = LOWER(:name)", { name: cleaned });
    if (id !== undefined) duplicate.andWhere('entry.id != :id', { id });
    if (await duplicate.getOne()) throw new ConflictException('A record with this name already exists');
    try {
      if (id !== undefined) {
        const result = await repo.update(id, { name: cleaned, ...extra } as any);
        if (!result.affected) throw new NotFoundException('Dictionary record not found');
        return repo.findOneByOrFail({ id } as any);
      }
      return await repo.save(repo.create({ name: cleaned, ...extra } as any));
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('A record with this name already exists');
      throw error;
    }
  }

  private async deleteDictionary(entity: typeof GenreEntity | typeof ActorEntity | typeof CountryEntity | typeof DirectorEntity, id: number, join?: { table: string; column: string }) {
    try {
      await this.moviesRepo.manager.transaction(async em => {
        const row = await em.findOne(entity as typeof GenreEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException('Dictionary record not found');
        if (join) {
          const used = await em.query(`SELECT 1 FROM ${join.table} WHERE ${join.column} = $1 LIMIT 1`, [id]);
          if (used.length) throw new ConflictException('This record is used by movies. Reassign those movies before deleting it.');
        }
        await em.delete(entity, id);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23503') throw new ConflictException('This record is used by movies. Reassign those movies before deleting it.');
      throw error;
    }
  }

  createGenre(name: string) { return this.saveDictionary(this.genresRepo, name); }
  updateGenre(id: number, name: string) { return this.saveDictionary(this.genresRepo, name, id); }
  deleteGenre(id: number) { return this.deleteDictionary(GenreEntity, id, { table: 'movie_genres', column: 'genres_id' }); }
  createActor(name: string, photoUrl?: string) { return this.saveDictionary(this.actorsRepo, name, undefined, { photoUrl: imageReference(photoUrl) ?? null }); }
  updateActor(id: number, name: string, photoUrl?: string) { return this.saveDictionary(this.actorsRepo, name, id, photoUrl !== undefined ? { photoUrl: imageReference(photoUrl) } : {}); }
  deleteActor(id: number) { return this.deleteDictionary(ActorEntity, id, { table: 'movie_actors', column: 'actors_id' }); }
  createCountry(name: string) { return this.saveDictionary(this.countriesRepo, name); }
  updateCountry(id: number, name: string) { return this.saveDictionary(this.countriesRepo, name, id); }
  deleteCountry(id: number) { return this.deleteDictionary(CountryEntity, id); }
  createDirector(name: string) { return this.saveDictionary(this.directorsRepo, name); }
  updateDirector(id: number, name: string) { return this.saveDictionary(this.directorsRepo, name, id); }
  deleteDirector(id: number) { return this.deleteDictionary(DirectorEntity, id); }
}
