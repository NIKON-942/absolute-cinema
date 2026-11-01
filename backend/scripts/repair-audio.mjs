// Prepare and verify before publishing: --prepare MOVIE_ID, then --apply REPAIR_ID.
// Old MP4s are retained for --rollback REPAIR_ID. No video encoder is invoked.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const processing = require(process.env.MEDIA_PROCESSING_MODULE ?? '../dist/modules/media/media-processing.js');
const masters = resolve('storage/masters'), videos = resolve('storage/videos'), repairs = join(masters, '.repairs');
const columns = ['video480', 'video720', 'video1080'];
const localFile = (folder, name) => {
  if (typeof name !== 'string' || basename(name) !== name || !name || name === '.' || name === '..') throw Error('Expected a local media filename');
  return join(folder, name);
};
async function loadJournal(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid repair ID');
  return JSON.parse(await readFile(join(repairs, id, 'journal.json'), 'utf8'));
}
async function saveJournal(journal) {
  const file = join(repairs, journal.id, 'journal.json');
  await writeFile(`${file}.tmp`, JSON.stringify(journal, null, 2)); await rename(`${file}.tmp`, file);
}
async function prepare(db, movieId) {
  if (!Number.isSafeInteger(movieId) || movieId <= 0) throw Error('A movie ID is required');
  const lock = await db.query('SELECT pg_try_advisory_lock(134659, $1) AS locked', [movieId]);
  if (!lock.rows[0].locked) throw Error('Another repair is already running');
  const movie = (await db.query('SELECT id,title,master_video,transcode_status,video480,video720,video1080 FROM movies WHERE id=$1', [movieId])).rows[0];
  if (!movie || movie.transcode_status !== 'ready') throw Error('Movie must exist and be ready');
  const id = randomUUID(), directory = join(repairs, id);
  await mkdir(directory, { recursive: true });
  const journal = { id, movieId, title: movie.title, createdAt: new Date().toISOString(), state: 'preparing', master: movie.master_video,
    previous: Object.fromEntries(columns.map(column => [column, movie[column]])), next: {}, verification: [] };
  await saveJournal(journal);
  try {
    const source = localFile(masters, movie.master_video), audio = join(directory, 'web.m4a');
    const meta = await processing.probeMedia(source);
    if (!meta.audio) throw Error('Master has no audio');
    console.log(JSON.stringify({ stage: 'audio', repairId: id, movieId }));
    await processing.prepareWebAudio(source, audio, meta);
    const audioHash = await processing.streamHash(audio, 'a');
    for (const column of columns) {
      if (!movie[column]) continue;
      const old = localFile(videos, movie[column]); const oldMeta = await processing.probeMedia(old);
      const filename = `${movieId}-audio-${id}-${column.slice(5)}p.mp4`, output = localFile(videos, filename);
      journal.next[column] = filename; await saveJournal(journal);
      console.log(JSON.stringify({ stage: 'remux', repairId: id, quality: column }));
      await processing.renderWebVideo(old, output, oldMeta.height, oldMeta, audio, undefined, true);
      const newMeta = await processing.probeMedia(output);
      const before = await processing.streamHash(old, 'v'), after = await processing.streamHash(output, 'v');
      if (before !== after) throw Error(`Video packet hash changed for ${column}`);
      if (await processing.streamHash(output, 'a') !== audioHash) throw Error(`Audio hash mismatch for ${column}`);
      if (!newMeta.audio || newMeta.audio.codec !== 'aac' || newMeta.audio.channels > 2 || newMeta.width !== oldMeta.width || newMeta.height !== oldMeta.height
        || (oldMeta.duration && newMeta.duration && Math.abs(oldMeta.duration - newMeta.duration) > 0.15)) throw Error(`Invalid repaired rendition ${column}`);
      journal.verification.push({ quality: column, videoHash: after, audioHash, width: newMeta.width, height: newMeta.height,
        duration: newMeta.duration, audioChannels: newMeta.audio.channels });
      await saveJournal(journal);
    }
    if (!journal.verification.length) throw Error('Movie has no video renditions');
    journal.state = 'prepared'; await saveJournal(journal);
    console.log(JSON.stringify({ state: journal.state, repairId: id, movieId, verification: journal.verification }));
    return journal;
  } catch (error) {
    journal.state = 'failed'; journal.error = error.message; await saveJournal(journal);
    await Promise.all(Object.values(journal.next).map(file => rm(localFile(videos, file), { force: true })));
    throw error;
  }
}
async function publish(db, id, rollback = false) {
  const journal = await loadJournal(id);
  if (!(rollback ? ['prepared', 'applied', 'rolled-back'] : ['prepared', 'applied']).includes(journal.state)) throw Error('Repair is not in the expected state');
  const expected = rollback ? journal.next : journal.previous;
  const replacement = rollback ? journal.previous : journal.next;
  // Verify staged data again immediately before publication/rollback.
  for (const check of journal.verification) {
    const file = localFile(videos, replacement[check.quality]);
    if (await processing.streamHash(file, 'v') !== check.videoHash) throw Error('Staged video changed since verification');
    if (!rollback && await processing.streamHash(file, 'a') !== check.audioHash) throw Error('Staged audio changed since verification');
  }
  await db.query('BEGIN');
  try {
    const movie = (await db.query('SELECT master_video,transcode_status,video480,video720,video1080 FROM movies WHERE id=$1 FOR UPDATE', [journal.movieId])).rows[0];
    if (!movie || movie.master_video !== journal.master || movie.transcode_status !== 'ready') throw Error('Movie changed since preparation; nothing published');
    const same = files => columns.every(column => (movie[column] ?? null) === (files[column] ?? null));
    if (!same(replacement)) {
      if (!same(expected)) throw Error('Movie changed since preparation; nothing published');
      await db.query('UPDATE movies SET video480=$2, video720=$3, video1080=$4, updated_at=NOW() WHERE id=$1',
        [journal.movieId, ...columns.map(column => replacement[column] ?? null)]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  journal.state = rollback ? 'rolled-back' : 'applied'; journal.publishedAt = new Date().toISOString(); await saveJournal(journal);
  console.log(JSON.stringify({ state: journal.state, repairId: id, movieId: journal.movieId, retainedOriginals: journal.previous }));
}
export async function main(args = process.argv.slice(2)) {
  const [action, value] = args;
  if (!['--prepare', '--apply', '--rollback'].includes(action)) throw Error('Use --prepare MOVIE_ID, --apply REPAIR_ID, or --rollback REPAIR_ID');
  const db = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await db.connect();
  try { if (action === '--prepare') return await prepare(db, Number(value)); else await publish(db, value, action === '--rollback'); }
  finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
