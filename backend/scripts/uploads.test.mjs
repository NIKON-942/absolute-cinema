import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const originalCwd = process.cwd();
const testRoot = resolve(originalCwd, '.tmp/upload-unit');
await mkdir(testRoot, { recursive: true });
const directory = await mkdtemp(join(testRoot, 'run-'));
process.chdir(directory);
const { UploadsService, UPLOAD_CHUNK_SIZE: CHUNK } = require(resolve(originalCwd, 'dist/modules/media/uploads.service.js'));
after(async () => { process.chdir(originalCwd); await rm(directory, { recursive: true, force: true }); });
const hex = bytes => createHash('sha256').update(bytes).digest('hex');
const checksum = bytes => `sha256 ${createHash('sha256').update(bytes).digest('base64')}`;
const manifest = bytes => ({ filename: 'movie.mp4', size: bytes.length, sha256: hex(bytes),
  chunks: Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, i) => hex(bytes.subarray(i * CHUNK, (i + 1) * CHUNK))) });
const request = bytes => Object.assign(Readable.from([bytes]), { headers: { 'content-length': String(bytes.length) } });
function fixture() {
  let attached = 0, probed = 0;
  const movie = { id: 1, masterVideo: 'old.mp4', transcodeStatus: 'ready' };
  const job = { status: 'none' };
  const media = { getMovie: async () => movie, getMovieEntity: async () => movie,
    transcodeJob: async () => job, attachMasterVideo: async () => { attached++; job.status = 'processing'; } };
  const transcode = { probe: async () => { probed++; return { height: 720, duration: 1 }; } };
  return { service: new UploadsService(media, transcode), media, transcode, movie, job, counts: () => ({ attached, probed }) };
}
let movieId = 0;
async function create(f, bytes) { return f.service.create(++movieId, 10, manifest(bytes)); }
async function settle(service, id) {
  for (let i = 0; i < 200; i++) {
    const state = await service.status(id, 10);
    if (state.state !== 'verifying') return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Verification did not settle');
}

test('checksum mismatch leaves durable offset unchanged; resume survives a service restart and lost response', async () => {
  const f = fixture(); const bytes = Buffer.alloc(CHUNK + 137, 17); const u = await create(f, bytes);
  await assert.rejects(f.service.status(u.id, 11), /not found/);
  await assert.rejects(f.service.append(u.id, 10, 0, checksum(Buffer.from('wrong')), request(bytes.subarray(0, CHUNK))), e => e.getStatus() === 460);
  assert.equal((await f.service.status(u.id, 10)).offset, 0);
  await f.service.append(u.id, 10, 0, checksum(bytes.subarray(0, CHUNK)), request(bytes.subarray(0, CHUNK)));
  // New service instance reads the committed position from disk.
  const recovered = new UploadsService(f.media, f.transcode);
  assert.equal((await recovered.status(u.id, 10)).offset, CHUNK);
  await assert.rejects(recovered.append(u.id, 10, 0, checksum(bytes.subarray(0, CHUNK)), request(bytes.subarray(0, CHUNK))), e => e.getStatus() === 409);
  await recovered.append(u.id, 10, CHUNK, checksum(bytes.subarray(CHUNK)), request(bytes.subarray(CHUNK)));
  await recovered.complete(u.id, 10);
  assert.equal((await settle(recovered, u.id)).state, 'processing');
  await recovered.complete(u.id, 10); // Lost finalize response must be safe to retry.
  assert.deepEqual(f.counts(), { attached: 1, probed: 1 });
  assert.equal(f.movie.masterVideo, 'old.mp4');
  f.job.status = 'ready'; assert.equal((await recovered.status(u.id, 10)).state, 'ready');
});

test('interrupted chunk is not committed; uncommitted disk tail is overwritten', async () => {
  const f = fixture(); const bytes = Buffer.alloc(133, 7); const u = await create(f, bytes);
  await assert.rejects(f.service.append(u.id, 10, 0, checksum(bytes), request(bytes.subarray(0, 70))), /chunk length/);
  assert.equal((await f.service.status(u.id, 10)).offset, 0);
  const interrupted = Object.assign(Readable.from((async function* () {
    yield bytes.subarray(0, 70); throw new Error('Connection reset');
  })()), { headers: { 'content-length': String(bytes.length) } });
  await assert.rejects(f.service.append(u.id, 10, 0, checksum(bytes), interrupted), /Connection reset/);
  assert.equal((await f.service.status(u.id, 10)).offset, 0);
  const source = join(directory, 'storage/masters', `${u.id}-master.mp4`);
  await writeFile(source, Buffer.alloc(500, 99));
  await f.service.append(u.id, 10, 0, checksum(bytes), request(bytes));
  assert.deepEqual(await readFile(source), bytes);
  await f.service.remove(u.id, 10); await assert.rejects(f.service.status(u.id, 10));
});

test('concurrent writes are rejected while status reports the last committed offset', async () => {
  const f = fixture(); const bytes = Buffer.alloc(133, 3); const u = await create(f, bytes);
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const stream = Object.assign(Readable.from((async function* () {
    entered(); await gate; yield bytes;
  })()), { headers: { 'content-length': String(bytes.length) } });
  const append = f.service.append(u.id, 10, 0, checksum(bytes), stream);
  await started;
  assert.equal((await f.service.status(u.id, 10)).offset, 0);
  await assert.rejects(f.service.append(u.id, 10, 0, checksum(bytes), request(bytes)), e => e.getStatus() === 409);
  release(); await append;
  assert.equal((await f.service.status(u.id, 10)).offset, bytes.length);
  await f.service.remove(u.id, 10);
});

test('final disk corruption repairs from the first damaged part without probing or converting', async () => {
  const f = fixture(); const bytes = Buffer.alloc(CHUNK + 101, 5); const u = await create(f, bytes);
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const part = bytes.subarray(offset, offset + CHUNK);
    await f.service.append(u.id, 10, offset, checksum(part), request(part));
  }
  const damaged = Buffer.from(bytes); damaged[CHUNK + 5] ^= 255;
  await writeFile(join(directory, 'storage/masters', `${u.id}-master.mp4`), damaged);
  await f.service.complete(u.id, 10);
  const repaired = await settle(f.service, u.id);
  assert.equal(repaired.state, 'uploading'); assert.equal(repaired.offset, CHUNK);
  assert.deepEqual(f.counts(), { attached: 0, probed: 0 });
  await f.service.append(u.id, 10, CHUNK, checksum(bytes.subarray(CHUNK)), request(bytes.subarray(CHUNK)));
  await f.service.complete(u.id, 10); assert.equal((await settle(f.service, u.id)).state, 'processing');
});

test('invalid video and inconsistent full-file manifest never replace the old video', async () => {
  const f = fixture(); const bytes = Buffer.from('not a video');
  f.transcode.probe = async () => { throw Error('Invalid video'); };
  const u = await create(f, bytes);
  await f.service.append(u.id, 10, 0, checksum(bytes), request(bytes)); await f.service.complete(u.id, 10);
  assert.equal((await settle(f.service, u.id)).state, 'failed'); assert.equal(f.counts().attached, 0);
  const wrong = await f.service.create(++movieId, 10, { ...manifest(bytes), sha256: '0'.repeat(64) });
  await f.service.append(wrong.id, 10, 0, checksum(bytes), request(bytes)); await f.service.complete(wrong.id, 10);
  assert.match((await settle(f.service, wrong.id)).error, /SHA-256 mismatch/);
  assert.equal(f.movie.masterVideo, 'old.mp4');
});

test('manifest cannot override upload ownership; duplicate creation is idempotent; active upload expires', async () => {
  const f = fixture(); const bytes = Buffer.from('manifest test'); const id = ++movieId;
  const u = await f.service.create(id, 10, { ...manifest(bytes), ownerId: 99, movieId: 999, id: '../unsafe' });
  assert.equal((await f.service.status(u.id, 10)).movieId, id);
  assert.equal((await f.service.create(id, 10, manifest(bytes))).id, u.id);
  await assert.rejects(f.service.create(id, 11, manifest(bytes)), /unfinished upload/);
  const statePath = join(directory, 'storage/masters/.uploads', u.id, 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8')); state.updatedAt = 0;
  await writeFile(statePath, JSON.stringify(state)); await f.service.cleanup();
  await assert.rejects(f.service.status(u.id, 10));
});

test('retention handles conversions finished with the tab closed and never deletes a published source', async () => {
  const f = fixture(); const bytes = Buffer.from('retention fixture'); const u = await create(f, bytes);
  await f.service.append(u.id, 10, 0, checksum(bytes), request(bytes));
  await f.service.complete(u.id, 10); await settle(f.service, u.id);
  // No browser status request observes the failed conversion.
  f.job.status = 'failed'; await f.service.cleanup();
  assert.equal((await f.service.status(u.id, 10)).state, 'failed');
  const expire = async id => {
    const file = join(directory, 'storage/masters/.uploads', id, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8')); state.updatedAt = 0;
    await writeFile(file, JSON.stringify(state)); await f.service.cleanup();
  };
  await expire(u.id);
  await assert.rejects(readFile(join(directory, 'storage/masters', `${u.id}-master.mp4`)));
  f.job.status = 'none'; const ready = await create(f, bytes);
  await f.service.append(ready.id, 10, 0, checksum(bytes), request(bytes));
  await f.service.complete(ready.id, 10); await settle(f.service, ready.id);
  f.job.status = 'ready'; f.movie.masterVideo = `${ready.id}-master.mp4`;
  await f.service.cleanup(); await expire(ready.id);
  await assert.rejects(f.service.status(ready.id, 10));
  assert.deepEqual(await readFile(join(directory, 'storage/masters', f.movie.masterVideo)), bytes);
});
