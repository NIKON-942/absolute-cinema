import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
assert.equal(process.env.ALLOW_SMOKE_FIXTURES, 'true');
assert.equal(process.env.DB_NAME, 'cinema_review');
const require = createRequire(import.meta.url);
const { AppDataSource: db } = require('../dist/database/data-source.js');
await db.initialize();
try {
  const [state] = await db.query("SELECT to_regclass('public.migrations') AS existing");
  assert.equal(state.existing, null, 'Migration fixture requires a fresh disposable database');
  const index = db.migrations.findIndex(m => /MediaRequirements/.test(m.constructor.name));
  assert.ok(index >= 0);
  const [latest] = db.migrations.splice(index, 1);
  assert.match(latest.constructor.name, /MediaRequirements/);
  await db.runMigrations();
  await db.query("INSERT INTO countries (name) VALUES ('Existing country')");
  const [legacy] = await db.query(`INSERT INTO movies (title, year, country, director, view_count)
    VALUES ('Legacy migration fixture', 2025, '  Existing country  ', 'Unlisted director', 72) RETURNING id`);
  const [empty] = await db.query("INSERT INTO movies (title, year) VALUES ('Empty references', 2026) RETURNING id");
  db.migrations.push(latest);
  await db.runMigrations();
  const query = `SELECT c.name AS country, d.name AS director, m.view_count FROM movies m
    LEFT JOIN countries c ON c.id = m.country_id LEFT JOIN directors d ON d.id = m.director_id WHERE m.id = $1`;
  assert.deepEqual((await db.query(query, [legacy.id]))[0], { country: 'Existing country', director: 'Unlisted director', view_count: 72 });
  assert.equal((await db.query(query, [empty.id]))[0].country, null);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM playback_events'))[0].count, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM rating_events'))[0].count, 0);
  assert.equal((await db.runMigrations()).length, 0);
  await db.undoLastMigration();
  const [restored] = await db.query('SELECT country, director, view_count FROM movies WHERE id = $1', [legacy.id]);
  assert.deepEqual(restored, { country: 'Existing country', director: 'Unlisted director', view_count: 72 });
  await db.runMigrations();
  console.log('PASS legacy dictionary backfill, empty references, lifetime counts, no invented events, repeatability and rollback');
} finally { await db.destroy(); }
