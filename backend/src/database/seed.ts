import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from './data-source';
import { PLANS } from './plans';
import {
  UserEntity,
  UserRoleEnum,
} from '../modules/users/user.entity';
import { ActorEntity } from '../modules/media/entities/actor.entity';
import { GenreEntity } from '../modules/media/entities/genre.entity';
import { MovieEntity } from '../modules/media/entities/movie.entity';
import { CountryEntity } from '../modules/media/entities/country.entity';
import { DirectorEntity } from '../modules/media/entities/director.entity';
import { RatingEntity } from '../modules/media/entities/rating.entity';
import { WatchProgressEntity } from '../modules/media/entities/watch-progress.entity';
import { SubscriptionPlanEntity } from '../modules/payments/entities/subscription-plan.entity';
import { slugify } from '../modules/media/media.constants';

const GENRES = [
  'Action', 'Drama', 'Comedy', 'Sci-Fi', 'Thriller',
  'Animation', 'Horror', 'Romance',
];

const ACTORS = [
  'Emma Stone', 'Ryan Gosling', 'Ana de Armas', 'Oscar Isaac',
  'Florence Pugh', 'Timothée Chalamet', 'Zendaya', 'Adam Driver',
  'Margot Robbie', 'Cillian Murphy', 'Any Taylor-Joy', 'Mahershala Ali',
];

interface SeedMovie {
  title: string;
  originalTitle?: string;
  year: number;
  country: string;
  ageRating: string;
  director: string;
  keywords: string[];
  genres: string[];
  actors: string[];
  viewCount: number;
  runtimeMinutes: number;
  trailerUrl?: string;
}

const MOVIES: SeedMovie[] = [
  {
    title: 'Neon Horizon', originalTitle: 'Neon Horizon', year: 2024, country: 'USA',
    ageRating: '16+', director: 'Denis Villeneuve',
    keywords: ['cyberpunk', 'dystopia', 'future', 'ai'],
    genres: ['Sci-Fi', 'Thriller'], actors: ['Ryan Gosling', 'Ana de Armas', 'Oscar Isaac'],
    viewCount: 1520,
    runtimeMinutes: 128,
  },
  {
    title: 'The Silent Harbor', originalTitle: 'Тиха гавань', year: 2023, country: 'Ukraine',
    ageRating: '12+', director: 'Miroslav Slaboshpytskiy',
    keywords: ['drama', 'sea', 'family', 'loss'],
    genres: ['Drama'], actors: ['Mahershala Ali', 'Florence Pugh'],
    viewCount: 340,
    runtimeMinutes: 141,
  },
  {
    title: 'Paper Moons', originalTitle: 'Paper Moons', year: 2022, country: 'UK',
    ageRating: '12+', director: 'Greta Gerwig',
    keywords: ['coming of age', 'friendship', 'summer'],
    genres: ['Comedy', 'Drama'], actors: ['Timothée Chalamet', 'Emma Stone'],
    viewCount: 980,
    runtimeMinutes: 118,
  },
  {
    title: 'Midnight Circuit', originalTitle: 'Midnight Circuit', year: 2021, country: 'USA',
    ageRating: '18+', director: 'Denis Villeneuve',
    keywords: ['heist', 'cyberpunk', 'night', 'crime'],
    genres: ['Action', 'Thriller'], actors: ['Adam Driver', 'Zendaya'],
    viewCount: 2210,
    runtimeMinutes: 132,
  },
  {
    title: 'Gardens of Mars', originalTitle: 'Gardens of Mars', year: 2024, country: 'Canada',
    ageRating: '16+', director: 'James Cameron',
    keywords: ['space', 'colony', 'survival', 'ai'],
    genres: ['Sci-Fi', 'Drama'], actors: ['Margot Robbie', 'Oscar Isaac'],
    viewCount: 1750,
    runtimeMinutes: 156,
  },
  {
    title: 'The Last Winter', originalTitle: 'Остання зима', year: 2020, country: 'Ukraine',
    ageRating: '16+', director: 'Miroslav Slaboshpytskiy',
    keywords: ['war', 'winter', 'survival', 'family'],
    genres: ['Drama', 'Thriller'], actors: ['Florence Pugh', 'Cillian Murphy'],
    viewCount: 640,
    runtimeMinutes: 149,
  },
  {
    title: 'Pixel Dreams', originalTitle: 'Pixel Dreams', year: 2023, country: 'Japan',
    ageRating: '6+', director: 'Hayao Miyazaki',
    keywords: ['animation', 'adventure', 'dreams', 'magic'],
    genres: ['Animation', 'Comedy'], actors: ['Emma Stone', 'Any Taylor-Joy'],
    viewCount: 3100,
    runtimeMinutes: 102,
  },
  {
    title: 'Crimson Lake', originalTitle: 'Crimson Lake', year: 2019, country: 'USA',
    ageRating: '18+', director: 'Jordan Peele',
    keywords: ['horror', 'mystery', 'lake', 'cult'],
    genres: ['Horror', 'Thriller'], actors: ['Any Taylor-Joy', 'Cillian Murphy'],
    viewCount: 1290,
    runtimeMinutes: 96,
  },
  {
    title: 'Letters from Lisbon', originalTitle: 'Letters from Lisbon', year: 2022, country: 'Portugal',
    ageRating: '12+', director: 'Richard Linklater',
    keywords: ['romance', 'letters', 'travel', 'second chances'],
    genres: ['Romance', 'Drama'], actors: ['Emma Stone', 'Ryan Gosling'],
    viewCount: 870,
    runtimeMinutes: 124,
  },
  {
    title: 'Iron Skies', originalTitle: 'Iron Skies', year: 2021, country: 'Germany',
    ageRating: '16+', director: 'Edward Berger',
    keywords: ['war', 'pilots', 'honor', 'history'],
    genres: ['Action', 'Drama'], actors: ['Adam Driver', 'Mahershala Ali'],
    viewCount: 1120,
    runtimeMinutes: 138,
  },
  {
    title: 'Quantum Lovers', originalTitle: 'Quantum Lovers', year: 2024, country: 'USA',
    ageRating: '16+', director: 'Denis Villeneuve',
    keywords: ['time travel', 'romance', 'parallel worlds', 'ai'],
    genres: ['Sci-Fi', 'Romance'], actors: ['Zendaya', 'Timothée Chalamet'],
    viewCount: 2650,
    runtimeMinutes: 145,
  },
  {
    title: 'Laughing Waters', originalTitle: 'Laughing Waters', year: 2020, country: 'Australia',
    ageRating: '6+', director: 'Taika Waititi',
    keywords: ['comedy', 'summer', 'small town', 'family'],
    genres: ['Comedy'], actors: ['Margot Robbie', 'Any Taylor-Joy'],
    viewCount: 1980,
    runtimeMinutes: 111,
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed is disabled in production. Use bootstrap:prod for plans and the first administrator.');
  }
  await AppDataSource.initialize();
  const ds = AppDataSource;

  const usersRepo = ds.getRepository(UserEntity);
  const genresRepo = ds.getRepository(GenreEntity);
  const actorsRepo = ds.getRepository(ActorEntity);
  const moviesRepo = ds.getRepository(MovieEntity);
  const plansRepo = ds.getRepository(SubscriptionPlanEntity);

  // ----- plans -----
  for (const plan of PLANS) {
    const existing = await plansRepo.findOne({ where: { tier: plan.tier } });
    if (existing) {
      existing.monthlyPrice = plan.monthlyPrice;
      existing.yearlyPrice = plan.yearlyPrice;
      existing.maxDevices = plan.maxDevices;
      existing.maxQuality = plan.maxQuality;
      existing.prioritySupport = Boolean(plan.prioritySupport);
      await plansRepo.save(existing);
    } else {
      await plansRepo.save(plansRepo.create({ ...plan, currency: 'usd' }));
    }
  }

  // ----- users -----
  async function upsertUser(email: string, name: string, password: string, role: UserRoleEnum) {
    let user = await usersRepo.findOne({ where: { email } });
    if (!user) {
      user = await usersRepo.save(
        usersRepo.create({
          email,
          name,
          passwordHash: await bcrypt.hash(password, 10),
          role,
        }),
      );
    }
    return user;
  }
  const admin = await upsertUser('admin@cinema.local', 'Admin', 'Admin12345', UserRoleEnum.ADMIN);
  const viewer = await upsertUser('viewer@cinema.local', 'Demo Viewer', 'Viewer12345', UserRoleEnum.VIEWER);
  console.log(`users ok: admin=#${admin.id}, viewer=#${viewer.id}`);
  console.warn(
    'Seed uses well-known demo credentials (admin@cinema.local / Admin12345) — rotate them before any real deployment.',
  );

  // ----- genres / actors -----
  const genreMap = new Map<string, GenreEntity>();
  for (const name of GENRES) {
    let g = await genresRepo.findOne({ where: { name } });
    if (!g) g = await genresRepo.save(genresRepo.create({ name }));
    genreMap.set(name, g);
  }
  const actorMap = new Map<string, ActorEntity>();
  for (const name of ACTORS) {
    let a = await actorsRepo.findOne({ where: { name } });
    if (!a) a = await actorsRepo.save(actorsRepo.create({ name }));
    actorMap.set(name, a);
  }

  // ----- countries / directors (FR-38, FR-39) -----
  const countriesRepo = ds.getRepository(CountryEntity);
  const directorsRepo = ds.getRepository(DirectorEntity);
  const COUNTRIES = [
    'USA', 'Ukraine', 'UK', 'Canada', 'Japan', 'Portugal', 'Germany',
    'Australia', 'France', 'Poland', 'Spain', 'South Korea',
  ];
  for (const name of COUNTRIES) {
    if (!(await countriesRepo.findOne({ where: { name } }))) {
      await countriesRepo.save(countriesRepo.create({ name }));
    }
  }
  const DIRECTORS = [...new Set(MOVIES.map((m) => m.director))];
  for (const name of DIRECTORS) {
    if (!(await directorsRepo.findOne({ where: { name } }))) {
      await directorsRepo.save(directorsRepo.create({ name }));
    }
  }
  console.log(`dictionaries ok: ${COUNTRIES.length} countries, ${DIRECTORS.length} directors`);

  // ----- movies -----
  let movieCount = 0;
  for (const m of MOVIES) {
    const existing = await moviesRepo.findOne({ where: { title: m.title } });
    if (existing) {
      // backfill fields added after the first seed run
      if (existing.runtimeMinutes == null) {
        await moviesRepo.update(existing.id, { runtimeMinutes: m.runtimeMinutes });
      }
      continue;
    }
    await moviesRepo.save(
      moviesRepo.create({
        title: m.title,
        originalTitle: m.originalTitle ?? m.title,
        description:
          `${m.title} (${m.year}) — a ${m.genres.join('/').toLowerCase()} film directed by ${m.director}. ` +
          `Set in ${m.country}, it explores themes of ${m.keywords.slice(0, 3).join(', ')} ` +
          'through the eyes of unforgettable characters.',
        year: m.year,
        country: m.country,
        ageRating: m.ageRating,
        director: m.director,
        runtimeMinutes: m.runtimeMinutes,
        keywords: m.keywords,
        posterPath: `${slugify(m.title)}.svg`, // created by scripts/generate-videos.mjs
        viewCount: m.viewCount,
        genres: m.genres.map((g) => genreMap.get(g)!).filter(Boolean),
        actors: m.actors.map((a) => actorMap.get(a)!).filter(Boolean),
      }),
    );
    movieCount++;
  }
  const total = await moviesRepo.count();
  console.log(`movies ok: ${movieCount} created, ${total} total`);

  // ----- demo taste signals for the viewer (drives recommendations) -----
  const ratingsRepo = ds.getRepository(RatingEntity);
  const progressRepo = ds.getRepository(WatchProgressEntity);
  const neon = await moviesRepo.findOne({ where: { title: 'Neon Horizon' } });
  const midnight = await moviesRepo.findOne({ where: { title: 'Midnight Circuit' } });
  const pixel = await moviesRepo.findOne({ where: { title: 'Pixel Dreams' } });

  if (neon && !(await ratingsRepo.findOne({ where: { userId: viewer.id, movieId: neon.id } }))) {
    await ratingsRepo.save(
      ratingsRepo.create({ userId: viewer.id, movieId: neon.id, value: 9 }),
    );
  }
  if (midnight && !(await progressRepo.findOne({ where: { userId: viewer.id, movieId: midnight.id } }))) {
    await progressRepo.save(
      progressRepo.create({
        userId: viewer.id,
        movieId: midnight.id,
        positionSeconds: 240,
        durationSeconds: 1800,
      }),
    );
  }
  if (pixel && !(await progressRepo.findOne({ where: { userId: viewer.id, movieId: pixel.id } }))) {
    await progressRepo.save(
      progressRepo.create({
        userId: viewer.id,
        movieId: pixel.id,
        positionSeconds: 60,
        durationSeconds: 1800,
      }),
    );
  }
  console.log('demo ratings/watch progress ok');

  await ds.destroy();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
