import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    const interval = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalUsers, totalMovies, activeSubscriptions] = await Promise.all([
      this.usersService.countUsers(),
      this.moviesRepo.count(),
      this.subsRepo.count({ where: { status: SubscriptionStatusEnum.ACTIVE } }),
    ]);

    const topRows = await this.moviesRepo.query(`
      SELECT m.id, m.title, m.view_count AS "viewCount",
             COALESCE((SELECT ROUND(AVG(r.value)::numeric, 1)
                         FROM ratings r WHERE r.movie_id = m.id), 0) AS "averageRating"
        FROM movies m
       ORDER BY m.view_count DESC
       LIMIT 10
    `);

    const revenueRows = await this.txRepo.query(
      `
      SELECT TO_CHAR(DATE_TRUNC('month', updated_at), 'YYYY-MM') AS month,
             SUM(amount)::float AS total
        FROM payment_transactions
       WHERE status = 'paid' AND updated_at >= $1
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12
    `,
      [interval],
    );

    // FR-44: genre popularity (aggregate views + average audience rating)
    const genreRows = await this.moviesRepo.query(`
      SELECT g.name AS genre,
             COALESCE(SUM(m.view_count), 0)::int AS views,
             COUNT(m.id)::int AS movies,
             COALESCE(ROUND(AVG(
               (SELECT AVG(r.value) FROM ratings r WHERE r.movie_id = m.id)
             )::numeric, 1), 0) AS "averageRating"
        FROM genres g
        JOIN movie_genres mg ON mg.genres_id = g.id
        JOIN movies m ON m.id = mg.movies_id
       GROUP BY g.name
       ORDER BY views DESC
    `);

    const newUsersRow = await this.usersService.countUsersSince(interval);

    return {
      totalUsers,
      totalMovies,
      activeSubscriptions,
      intervalDays: days,
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
