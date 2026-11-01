/** Synthetic HTTP Range fixture for an isolated CI database, never production. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import bcrypt from 'bcrypt';

if (process.env.ALLOW_SMOKE_FIXTURES !== 'true') {
  throw new Error('Set ALLOW_SMOKE_FIXTURES=true only for an isolated test database');
}
const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
await client.connect();
try {
  // Byte-range tests need a deterministic file, not a complete video encode.
  const directory = join(process.cwd(), 'storage', 'videos');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'ci-range.mp4'), Buffer.alloc(4096, 42));
  await client.query(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)',
    [process.env.SMOKE_EMAIL ?? 'viewer@cinema.local', 'CI Viewer',
      await bcrypt.hash(process.env.SMOKE_PASSWORD ?? 'Viewer12345', 10)],
  );
  await client.query(`
    INSERT INTO movies (title, year, video480, video720, video1080, transcode_status)
    VALUES ('CI Range Fixture', 2026, 'ci-range.mp4', 'ci-range.mp4', 'ci-range.mp4', 'ready')
  `);
  console.log('Isolated CI fixtures created');
} finally {
  await client.end();
}
