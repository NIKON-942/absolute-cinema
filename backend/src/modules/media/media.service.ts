import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, statSync } from 'fs';
import * as fs from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
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

const QUALITY_COLUMNS: Record<VideoQuality, keyof MovieEntity> = {
  '480p': 'video480',
  '720p': 'video720',
  '1080p': 'video1080',
};

export interface MovieDto {
  id: number;
  title: string;
  originalTitle: string;
  description: string;
  year: number;
  country: string;
  ageRating: string;
  director: string;
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
    year?: string;
    yearFrom?: string;
    yearTo?: string;
    country?: string;
    ageRating?: string;
    sort?: string;
    page: number;
    limit: number;
  }) {
    const qb = this.moviesRepo
      .createQueryBuilder('movie')
      .leftJoinAndSelect('movie.genres', 'genre')
      .leftJoinAndSelect('movie.actors', 'actor');

    if (filters.search) {
      qb.andWhere(
        '(movie.title ILIKE :s OR movie.originalTitle ILIKE :s OR movie.description ILIKE :s)',
        { s: `%${filters.search}%` },
      );
    }
    if (filters.genre) {
      qb.andWhere('genre.name = :genre', { genre: filters.genre });
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
      qb.andWhere('movie.country ILIKE :c', { c: `%${filters.country}%` });
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
        qb.orderBy(`${avg} DESC`);
        break;
      case 'newest':
        qb.orderBy('movie.createdAt', 'DESC');
        break;
      case 'popularity':
      default:
        qb.orderBy('movie.viewCount', 'DESC');
    }

    qb.skip((filters.page - 1) * filters.limit).take(filters.limit);
    const [items, total] = await qb.getManyAndCount();
    return {
      items: await Promise.all(items.map((m) => this.toDto(m))),
      total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  async getMovie(id: number, userId?: number): Promise<MovieDto> {
    const movie = await this.moviesRepo.findOne({
      where: { id },
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
      where: { id: movieId },
      relations: ['genres'],
    });
    if (!base) throw new NotFoundException('Movie not found');
    const genreIds = base.genres.map((g) => g.id);

    const qb = this.moviesRepo
      .createQueryBuilder('movie')
      .leftJoinAndSelect('movie.genres', 'genre')
      .leftJoinAndSelect('movie.actors', 'actor')
      .where('movie.id != :id', { id: movieId });

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
    } else if (base.director) {
      qb.andWhere('movie.director = :director', { director: base.director });
    }

    qb.addOrderBy('movie.viewCount', 'DESC').take(8);
    const movies = await qb.getMany();
    return Promise.all(movies.map((m) => this.toDto(m, userId)));
  }

  // ---------- favorites / ratings / progress ----------

  async toggleFavorite(movieId: number, userId: number) {
    const movie = await this.moviesRepo.findOne({ where: { id: movieId } });
    if (!movie) throw new NotFoundException('Movie not found');
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
      .leftJoinAndSelect('movie.genres', 'genre')
      .leftJoinAndSelect('movie.actors', 'actor')
      .getMany();
    return Promise.all(movies.map((m) => this.toDto(m, userId)));
  }

  async setRating(movieId: number, userId: number, value: number) {
    const movie = await this.moviesRepo.findOne({ where: { id: movieId } });
    if (!movie) throw new NotFoundException('Movie not found');
    let rating = await this.ratingsRepo.findOne({
      where: { movieId, userId },
    });
    if (rating) {
      rating.value = value;
    } else {
      rating = this.ratingsRepo.create({ movieId, userId, value });
    }
    await this.ratingsRepo.save(rating);
    return {
      averageRating: await this.averageRating(movieId),
      userRating: value,
    };
  }

  async deleteRating(movieId: number, userId: number) {
    await this.ratingsRepo.delete({ movieId, userId });
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
      where: { userId },
      relations: ['movie'],
      order: { updatedAt: 'DESC' },
    });
    return rows.map((r) => ({
      movieId: r.movieId,
      movieTitle: r.movie.title,
      year: r.movie.year,
      genres: (r.movie.genres ?? []).map((g) => ({ id: g.id, name: g.name })),
      posterUrl: r.movie.posterPath
        ? `/api/media/posters/${r.movie.posterPath}`
        : '',
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
      this.bumpViews(movie);
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

    if (start === 0) {
      this.bumpViews(movie);
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

  /** Counts a playback session once per stream start. */
  private bumpViews(movie: MovieEntity): void {
    this.moviesRepo
      .increment({ id: movie.id }, 'viewCount', 1)
      .catch(() => undefined);
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
      originalTitle: movie.originalTitle,
      description: movie.description,
      year: movie.year,
      country: movie.country,
      ageRating: movie.ageRating,
      director: movie.director,
      runtimeMinutes: movie.runtimeMinutes ?? null,
      trailerUrl: movie.trailerUrl ?? null,
      keywords: movie.keywords ?? [],
      posterUrl: movie.posterPath
        ? /^https?:\/\//i.test(movie.posterPath)
          ? movie.posterPath
          : `/api/media/posters/${movie.posterPath}`
        : '',
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

  private parseIdList(value: unknown): number[] {
    if (Array.isArray(value)) {
      return value.map((v) => parseInt(String(v), 10)).filter(Number.isFinite);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter(Number.isFinite);
    }
    return [];
  }

  async createMovie(body: Record<string, unknown>, posterPath?: string | null) {
    const posterFromBody = String(body.posterUrl ?? '').trim();
    const poster = posterPath ?? (/^https?:\/\//i.test(posterFromBody) ? posterFromBody : null);
    const movie = this.moviesRepo.create({
      title: String(body.title ?? '').trim(),
      originalTitle: String(body.originalTitle ?? ''),
      description: String(body.description ?? ''),
      year: parseInt(String(body.year ?? '0'), 10),
      country: String(body.country ?? ''),
      ageRating: String(body.ageRating ?? '16+'),
      director: String(body.director ?? ''),
      runtimeMinutes: body.runtimeMinutes ? parseInt(String(body.runtimeMinutes), 10) : null,
      trailerUrl: String(body.trailerUrl ?? '').trim() || null,
      keywords: String(body.keywords ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      posterPath: poster,
    });
    if (!movie.title || !Number.isFinite(movie.year) || movie.year <= 0) {
      throw new BadRequestException('Title and a valid year are required');
    }
    const genreIds = this.parseIdList(body.genreIds);
    const actorIds = this.parseIdList(body.actorIds);
    if (genreIds.length > 0) {
      movie.genres = await this.genresRepo.findByIds(genreIds);
    }
    if (actorIds.length > 0) {
      movie.actors = await this.actorsRepo.findByIds(actorIds);
    }
    // Validate before saving — a bad URL must not leave a half-created movie.
    const masterUrl = String(body.masterVideoUrl ?? '').trim();
    if (masterUrl && !/^https?:\/\//i.test(masterUrl)) {
      throw new BadRequestException('masterVideoUrl must be an http(s) URL');
    }
    const saved = await this.moviesRepo.save(movie);
    if (masterUrl) {
      await this.setMasterVideoUrl(saved.id, masterUrl);
    }
    return this.getMovie(saved.id);
  }

  /**
   * FR-29/master pipeline: registers an uploaded master file (already stored
   * in storage/masters by the controller) and kicks off background
   * transcoding into 480p/720p/1080p.
   */
  async attachMasterVideo(id: number, masterFilename: string): Promise<MovieDto> {
    const movie = await this.getMovieEntity(id);
    movie.masterVideo = masterFilename;
    await this.moviesRepo.update(id, { masterVideo: masterFilename });
    this.transcodeService.enqueue(id, masterFilename);
    return this.getMovie(id);
  }

  /** Same pipeline, but the master is a remote URL (ffmpeg reads it directly). */
  async setMasterVideoUrl(id: number, url: string): Promise<MovieDto> {
    await this.moviesRepo.update(id, { masterVideo: url });
    this.transcodeService.enqueue(id, url);
    return this.getMovie(id);
  }

  transcodeJob(movieId: number) {
    return (
      this.transcodeService.jobInfo(movieId) ?? {
        movieId,
        status: 'none' as const,
        qualities: [],
      }
    );
  }

  async updateMovie(
    id: number,
    body: Record<string, unknown>,
    posterPath?: string | null,
  ) {
    const movie = await this.moviesRepo.findOne({
      where: { id },
      relations: ['genres', 'actors'],
    });
    if (!movie) throw new NotFoundException('Movie not found');

    if (body.title !== undefined) movie.title = String(body.title);
    if (body.originalTitle !== undefined)
      movie.originalTitle = String(body.originalTitle);
    if (body.description !== undefined)
      movie.description = String(body.description);
    if (body.year !== undefined) movie.year = parseInt(String(body.year), 10);
    if (body.country !== undefined) movie.country = String(body.country);
    if (body.ageRating !== undefined)
      movie.ageRating = String(body.ageRating);
    if (body.director !== undefined) movie.director = String(body.director);
    if (body.runtimeMinutes !== undefined) {
      movie.runtimeMinutes = body.runtimeMinutes
        ? parseInt(String(body.runtimeMinutes), 10)
        : null;
    }
    if (body.trailerUrl !== undefined) {
      movie.trailerUrl = String(body.trailerUrl).trim() || null;
    }
    if (posterPath) {
      movie.posterPath = posterPath;
    } else if (body.posterUrl !== undefined) {
      const url = String(body.posterUrl).trim();
      movie.posterPath = /^https?:\/\//i.test(url) ? url : movie.posterPath;
    }
    if (body.keywords !== undefined) {
      movie.keywords = String(body.keywords)
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    }
    if (body.genreIds !== undefined) {
      movie.genres = await this.genresRepo.findByIds(
        this.parseIdList(body.genreIds),
      );
    }
    if (body.actorIds !== undefined) {
      movie.actors = await this.actorsRepo.findByIds(
        this.parseIdList(body.actorIds),
      );
    }
    // Validate before saving so a bad URL doesn't half-apply the update.
    const masterUrl = String(body.masterVideoUrl ?? '').trim();
    if (masterUrl && !/^https?:\/\//i.test(masterUrl)) {
      throw new BadRequestException('masterVideoUrl must be an http(s) URL');
    }
    await this.moviesRepo.save(movie);
    if (masterUrl) {
      await this.setMasterVideoUrl(id, masterUrl);
    }
    return this.getMovie(id);
  }

  async removeMovie(id: number) {
    // Clear dependent rows first — progress/ratings/favorites would otherwise
    // violate their foreign keys when a watched movie is deleted.
    await this.progressRepo.delete({ movieId: id });
    await this.ratingsRepo.delete({ movieId: id });
    await this.moviesRepo.query(
      'DELETE FROM user_favorites WHERE movies_id = $1',
      [id],
    );
    const result = await this.moviesRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Movie not found');
  }

  // ---------- genres / actors ----------

  async createGenre(name: string) {
    return this.genresRepo.save({ name: name.trim() });
  }

  async updateGenre(id: number, name: string) {
    await this.genresRepo.update(id, { name: name.trim() });
    const genre = await this.genresRepo.findOne({ where: { id } });
    if (!genre) throw new NotFoundException('Genre not found');
    return genre;
  }

  async deleteGenre(id: number) {
    const result = await this.genresRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Genre not found');
  }

  async createActor(name: string, photoUrl?: string) {
    return this.actorsRepo.save({ name: name.trim(), photoUrl: photoUrl ?? null });
  }

  async updateActor(id: number, name: string, photoUrl?: string) {
    await this.actorsRepo.update(id, {
      name: name.trim(),
      ...(photoUrl !== undefined ? { photoUrl } : {}),
    });
    const actor = await this.actorsRepo.findOne({ where: { id } });
    if (!actor) throw new NotFoundException('Actor not found');
    return actor;
  }

  async deleteActor(id: number) {
    const result = await this.actorsRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Actor not found');
  }

  // ---------- countries / directors (FR-38, FR-39) ----------

  async createCountry(name: string) {
    return this.countriesRepo.save({ name: name.trim() });
  }

  async updateCountry(id: number, name: string) {
    await this.countriesRepo.update(id, { name: name.trim() });
    const country = await this.countriesRepo.findOne({ where: { id } });
    if (!country) throw new NotFoundException('Country not found');
    return country;
  }

  async deleteCountry(id: number) {
    const result = await this.countriesRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Country not found');
  }

  async createDirector(name: string) {
    return this.directorsRepo.save({ name: name.trim() });
  }

  async updateDirector(id: number, name: string) {
    await this.directorsRepo.update(id, { name: name.trim() });
    const director = await this.directorsRepo.findOne({ where: { id } });
    if (!director) throw new NotFoundException('Director not found');
    return director;
  }

  async deleteDirector(id: number) {
    const result = await this.directorsRepo.delete(id);
    if (result.affected === 0)
      throw new NotFoundException('Director not found');
  }
}
