import { MigrationInterface, QueryRunner } from 'typeorm';

export class MovieVisibility1793988000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE movies ADD COLUMN is_hidden boolean NOT NULL DEFAULT false');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE movies DROP COLUMN is_hidden');
  }
}
