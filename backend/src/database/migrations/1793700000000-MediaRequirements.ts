import { MigrationInterface, QueryRunner } from 'typeorm';

export class MediaRequirements1793700000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    for (const [field, table] of [['country', 'countries'], ['director', 'directors']]) {
      await q.query(`INSERT INTO ${table} (name) SELECT DISTINCT btrim(${field}) FROM movies WHERE btrim(${field}) <> '' ON CONFLICT (name) DO NOTHING`);
      await q.query(`ALTER TABLE movies ADD ${field}_id integer REFERENCES ${table}(id) ON DELETE RESTRICT`);
      await q.query(`UPDATE movies m SET ${field}_id = d.id FROM ${table} d WHERE d.name = btrim(m.${field})`);
      await q.query(`CREATE INDEX idx_movies_${field} ON movies (${field}_id)`);
      await q.query(`ALTER TABLE movies DROP COLUMN ${field}`);
    }
    await q.query(`CREATE TABLE playback_events (
      id bigserial PRIMARY KEY,
      movie_id integer NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      playback_id varchar(100) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(movie_id, user_id, playback_id)
    )`);
    await q.query('CREATE INDEX idx_playback_events_period ON playback_events (created_at, movie_id)');
    await q.query(`CREATE TABLE rating_events (
      id bigserial PRIMARY KEY,
      movie_id integer NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value smallint CHECK (value BETWEEN 1 AND 10),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX idx_rating_events_period ON rating_events (created_at, movie_id, user_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE rating_events, playback_events');
    for (const [field, table] of [['country', 'countries'], ['director', 'directors']]) {
      await q.query(`ALTER TABLE movies ADD ${field} varchar NOT NULL DEFAULT ''`);
      await q.query(`UPDATE movies m SET ${field} = d.name FROM ${table} d WHERE m.${field}_id = d.id`);
      await q.query(`ALTER TABLE movies DROP COLUMN ${field}_id`);
    }
  }
}
