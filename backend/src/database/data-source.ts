import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';

loadEnv({ path: '.env' });
loadEnv({ path: '../.env' });

// Resolve beside this module so ts-node and the compiled production CLI both work.
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'cinema',
  password: process.env.DB_PASSWORD ?? 'cinema',
  database: process.env.DB_NAME ?? 'absolutecinema',
  namingStrategy: new SnakeNamingStrategy(),
  entities: [join(__dirname, '../modules/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
  logging: false,
});
