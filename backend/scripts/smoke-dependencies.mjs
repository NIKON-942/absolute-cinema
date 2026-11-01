/** Run only against the isolated CI stack, after smoke-plans.mjs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

assert.equal(process.env.ALLOW_SMOKE_FIXTURES, 'true', 'An isolated CI database is required');
const base = process.env.SMOKE_API_URL ?? 'http://backend:4000/api';
const legacyHash = '$2b$10$iWNas8A1VaaU1jYx41.SAenRrkmZkM.oDmuqvezgKQeqZLvvSFzm6';
assert.equal(await bcrypt.compare('legacy-ci-password', legacyHash), true);
assert.equal(await bcrypt.compare('incorrect-password', legacyHash), false);
console.log('PASS bcrypt 6 verifies existing bcrypt 5 password hashes');

const mail = await nodemailer.createTransport({ jsonTransport: true }).sendMail({
  from: 'ci@example.com', to: 'viewer@example.com', subject: 'CI receipt', html: '<b>Receipt</b>',
});
assert.equal(JSON.parse(mail.message.toString()).subject, 'CI receipt');
console.log('PASS Nodemailer creates an email without external SMTP');
assert.equal(resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'ci' }).attributes[ATTR_SERVICE_NAME], 'ci');
console.log('PASS OpenTelemetry resource API');

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  assert.equal(response.ok, true, `${path}: HTTP ${response.status}`);
  return response;
}
const login = await (await request('/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.INITIAL_ADMIN_EMAIL, password: process.env.INITIAL_ADMIN_PASSWORD }),
})).json();
const headers = { Authorization: `Bearer ${login.accessToken}` };
const poster = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const create = new FormData();
create.set('title', 'CI Dependency Upload');
create.set('year', '2026');
create.set('file', new Blob([poster], { type: 'image/svg+xml' }), 'poster.svg');
const movie = await (await request('/media', { method: 'POST', headers, body: create })).json();
assert.ok(movie.id);
const initialJob = await (await request(`/media/${movie.id}/transcode`, { headers })).json();
assert.equal(initialJob.status, 'none');
assert.equal(initialJob.progress, null);
console.log('PASS NestJS multipart poster upload with Multer 2');

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cinema-smoke-'));
try {
  const master = join(temporaryDirectory, 'master.mp4');
  execFileSync('ffmpeg', ['-f', 'lavfi', '-i', 'color=c=blue:s=854x480:r=2',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', master], { stdio: 'pipe' });
  const upload = new FormData();
  upload.set('file', new Blob([await readFile(master)], { type: 'video/mp4' }), 'master.mp4');
  await request(`/media/${movie.id}/master-video`, { method: 'POST', headers, body: upload });
  let ready = false;
  let previousProgress = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const job = await (await request(`/media/${movie.id}/transcode`, { headers })).json();
    assert.notEqual(job.status, 'failed', job.error ?? 'Transcoding failed');
    if (job.progress !== null) {
      assert.ok(job.progress >= previousProgress && job.progress <= 100);
      previousProgress = job.progress;
    }
    if (job.status === 'processing') assert.notEqual(job.progress, 100);
    if (job.status === 'ready') {
      assert.equal(job.progress, 100);
      assert.equal(job.phase, 'ready');
      assert.deepEqual(job.qualities, ['480p']);
      ready = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(ready, true, 'Transcoding timed out');
  console.log('PASS master upload and real FFmpeg transcoding');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  await request(`/media/${movie.id}`, { method: 'DELETE', headers });
}
