import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { MovieEntity } from '../media/entities/movie.entity';
import { SubscriptionEntity } from '../payments/entities/subscription.entity';
import { PaymentTransactionEntity } from '../payments/entities/payment-transaction.entity';
import { SubscriptionStatusEnum } from '../users/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class AdminService {
  constructor(
    private usersService: UsersService,
    @InjectRepository(MovieEntity)
    private moviesRepo: Repository<MovieEntity>,
    @InjectRepository(SubscriptionEntity)
    private subsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PaymentTransactionEntity)
    private txRepo: Repository<PaymentTransactionEntity>,
  ) {}

  async analytics(days = 30) {
    const periodTo = new Date();
    const interval = new Date(periodTo.getTime() - days * 24 * 60 * 60 * 1000);

    const [totalUsers, totalMovies, activeSubscriptions] = await Promise.all([
      this.usersService.countUsers(),
      this.moviesRepo.count(),
      this.subsRepo.count({ where: { status: SubscriptionStatusEnum.ACTIVE, endsAt: MoreThan(periodTo) } }),
    ]);

    // Aggregate each source before joining: multiple genres/ratings must not
    // multiply playback counts. One latest rating action per user/movie in the window.
    const periodStats = `
      WITH views AS (
        SELECT movie_id, COUNT(*)::int AS views FROM playback_events
        WHERE created_at >= $1 AND created_at < $2 GROUP BY movie_id
      ), latest_ratings AS (
        SELECT DISTINCT ON (movie_id, user_id) movie_id, user_id, value
        FROM rating_events WHERE created_at >= $1 AND created_at < $2
        ORDER BY movie_id, user_id, created_at DESC, id DESC
      ), ratings AS (
        SELECT movie_id, SUM(value) AS rating_sum, COUNT(value) AS rating_count
        FROM latest_ratings GROUP BY movie_id
      ), stats AS (
        SELECT m.id, m.title, COALESCE(v.views, 0) AS views,
          COALESCE(r.rating_sum, 0) AS rating_sum, COALESCE(r.rating_count, 0) AS rating_count
        FROM movies m LEFT JOIN views v ON v.movie_id = m.id LEFT JOIN ratings r ON r.movie_id = m.id
      )`;
    const topRows = await this.moviesRepo.query(periodStats + `
      SELECT id, title, views AS "viewCount",
        COALESCE(ROUND(rating_sum::numeric / NULLIF(rating_count, 0), 1), 0) AS "averageRating"
      FROM stats WHERE views > 0 OR rating_count > 0
      ORDER BY views DESC, "averageRating" DESC, id ASC LIMIT 10
    `, [interval, periodTo]);
    const summary = await this.moviesRepo.query(periodStats + `
      SELECT COALESCE(SUM(views), 0)::int AS views,
        COALESCE(ROUND(SUM(rating_sum)::numeric / NULLIF(SUM(rating_count), 0), 1), 0) AS rating
      FROM stats
    `, [interval, periodTo]);

    const revenueRows = await this.txRepo.query(
      `
      SELECT TO_CHAR(DATE_TRUNC('month', updated_at), 'YYYY-MM') AS month,
             SUM(amount)::float AS total
        FROM payment_transactions
       WHERE status = 'paid' AND updated_at >= $1 AND updated_at < $2
       GROUP BY 1
       ORDER BY 1 DESC
    `,
      [interval, periodTo],
    );

    const genreRows = await this.moviesRepo.query(periodStats + `
      SELECT g.name AS genre, SUM(s.views)::int AS views, COUNT(s.id)::int AS movies,
        COALESCE(ROUND(SUM(s.rating_sum)::numeric / NULLIF(SUM(s.rating_count), 0), 1), 0) AS "averageRating"
      FROM genres g JOIN movie_genres mg ON mg.genres_id = g.id JOIN stats s ON s.id = mg.movies_id
      GROUP BY g.id, g.name ORDER BY views DESC, g.name ASC
    `, [interval, periodTo]);

    const newUsersRow = await this.usersService.countUsersSince(interval);

    return {
      totalUsers,
      totalMovies,
      activeSubscriptions,
      intervalDays: days,
      periodFrom: interval.toISOString(),
      periodTo: periodTo.toISOString(),
      viewsInPeriod: Number(summary[0].views),
      averageRatingInPeriod: Number(summary[0].rating),
      newUsersInPeriod: newUsersRow,
      topMovies: topRows.map((m: { id: number; title: string; viewCount: number; averageRating: number }) => ({
        id: Number(m.id),
        title: m.title,
        viewCount: Number(m.viewCount),
        averageRating: Number(m.averageRating),
      })),
      genrePopularity: genreRows.map((g: { genre: string; views: number; movies: number; averageRating: number }) => ({
        genre: g.genre,
        views: Number(g.views),
        movies: Number(g.movies),
        averageRating: Number(g.averageRating),
      })),
      revenueByMonth: revenueRows.map((r: { month: string; total: number }) => ({
        month: r.month,
        total: Number(r.total),
      })),
    };
  }
}
