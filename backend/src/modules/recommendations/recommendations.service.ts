import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MovieEntity } from '../media/entities/movie.entity';
import { MediaService } from '../media/media.service';

/**
 * Content-based filtering (docs/6): scores candidate movies on metadata
 * overlap with the user's taste profile (ratings >= 6 weighted higher than
 * watch history), using a single optimized SQL query:
 *   shared genres +3 each, same director +2, shared actors +1 each,
 *   shared keywords +1 each — multiplied by the profile signal weight.
 * Users without history (or guests) fall back to popular + newest.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  private static readonly SQL = `
    WITH sig AS (
      SELECT r.movie_id AS mid, 2.0 AS w
        FROM ratings r
       WHERE r.user_id = $1 AND r.value >= 6
      UNION ALL
      SELECT p.movie_id, 1.0
        FROM watch_progress p
       WHERE p.user_id = $1
    ),
    genre_w AS (
      SELECT mg.genres_id AS gid, SUM(s.w) AS w
        FROM sig s JOIN movie_genres mg ON mg.movies_id = s.mid
       GROUP BY 1
    ),
    director_w AS (
      SELECT m.director_id AS d, SUM(s.w) AS w
        FROM sig s JOIN movies m ON m.id = s.mid
       WHERE m.director_id IS NOT NULL
       GROUP BY 1
    ),
    actor_w AS (
      SELECT ma.actors_id AS aid, SUM(s.w) AS w
        FROM sig s JOIN movie_actors ma ON ma.movies_id = s.mid
       GROUP BY 1
    ),
    keyword_w AS (
      SELECT k AS kw, SUM(s.w) AS w
        FROM sig s JOIN movies m ON m.id = s.mid, unnest(m.keywords) AS k
       GROUP BY 1
    ),
    scored AS (
      SELECT m.id,
        (COALESCE((SELECT SUM(gw.w) * 3 FROM movie_genres mg JOIN genre_w gw ON gw.gid = mg.genres_id WHERE mg.movies_id = m.id), 0)
       + COALESCE((SELECT dw.w * 2 FROM director_w dw WHERE dw.d = m.director_id), 0)
       + COALESCE((SELECT SUM(aw.w) * 1 FROM movie_actors ma JOIN actor_w aw ON aw.aid = ma.actors_id WHERE ma.movies_id = m.id), 0)
       + COALESCE((SELECT SUM(kww.w) * 1 FROM unnest(m.keywords) AS kk JOIN keyword_w kww ON kww.kw = kk), 0)
        ) AS score
        FROM movies m
       WHERE m.is_hidden = false AND m.id NOT IN (SELECT mid FROM sig)
    )
    SELECT s.id, s.score FROM scored s
     WHERE s.score > 0
     ORDER BY s.score DESC
     LIMIT 12
  `;

  constructor(
    private mediaService: MediaService,
    @InjectRepository(MovieEntity)
    private moviesRepo: Repository<MovieEntity>,
  ) {}

  async forUser(userId?: number) {
    if (userId) {
      try {
        const rows: Array<{ id: number; score: number }> =
          await this.moviesRepo.query(RecommendationsService.SQL, [userId]);
        const ids = rows.map((r) => Number(r.id));
        if (ids.length > 0) {
          const movies = await this.moviesRepo.find({
            where: { id: In(ids), isHidden: false },
            relations: ['genres', 'actors'],
          });
          const byId = new Map(movies.map((m) => [m.id, m]));
          const ordered = ids
            .map((id) => byId.get(id))
            .filter((m): m is MovieEntity => Boolean(m));
          return Promise.all(
            ordered.map((m) => this.mediaService.toDto(m, userId)),
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Recommendation query failed: ${message}`);
      }
    }
    return this.fallback(userId);
  }

  /** Cold-start fallback: blend of most popular and newest releases. */
  private async fallback(userId?: number) {
    const [popular, newest] = await Promise.all([
      this.moviesRepo.find({
        where: { isHidden: false },
        order: { viewCount: 'DESC' },
        take: 8,
        relations: ['genres', 'actors'],
      }),
      this.moviesRepo.find({
        where: { isHidden: false },
        order: { createdAt: 'DESC' },
        take: 8,
        relations: ['genres', 'actors'],
      }),
    ]);
    const merged: MovieEntity[] = [];
    const seen = new Set<number>();
    for (const m of [...popular, ...newest]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }
    return Promise.all(merged.slice(0, 12).map((m) => this.mediaService.toDto(m, userId)));
  }
}
