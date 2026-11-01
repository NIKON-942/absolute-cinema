import 'reflect-metadata';
import { AppDataSource } from './data-source';

AppDataSource.initialize()
  .then(async () => {
    const migrations = await AppDataSource.runMigrations();
    console.log(
      `Migrations complete (${migrations.length} applied):`,
      migrations.map((m) => m.name).join(', ') || 'none pending',
    );
    await AppDataSource.destroy();
  })
  .catch((err) => {
    console.error('Migration run failed:', err);
    process.exit(1);
  });
