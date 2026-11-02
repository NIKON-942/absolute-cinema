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
const poster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8qkAAAAASUVORK5CYII=', 'base64');
const create = new FormData();
create.set('title', 'CI Dependency Upload');
create.set('year', '2026');
create.set('file', new Blob([poster], { type: 'image/png' }), 'poster.png');
const movie = await (await request('/media', { method: 'POST', headers, body: create })).json();
assert.ok(movie.id);
const initialJob = await (await request(`/media/${movie.id}/transcode`, { headers })).json();
assert.equal(initialJob.status, 'none');
assert.equal(initialJob.progress, null);
console.log('PASS NestJS multipart poster upload with Multer 2');

// Image attachments must work for ordinary viewers as well as admin actors.
const viewerEmail = `image-${Date.now()}@example.com`;
const viewer = await (await request('/auth/register', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: viewerEmail, name: 'Image Viewer', password: 'image-password' }),
})).json();
const viewerHeaders = { Authorization: `Bearer ${viewer.accessToken}` };
const imageForm = (fields = {}, bytes = poster, filename = 'photo.png', type = 'image/png') => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', new Blob([bytes], { type }), filename);
  return form;
};
assert.equal((await fetch(`${base}/users/me`, { method: 'PATCH', body: imageForm() })).status, 401);
const uploadedAvatar = await (await request('/users/me', { method: 'PATCH', headers: viewerHeaders,
  body: imageForm({ name: 'Viewer with photo', avatarUrl: 'https://example.com/ignored.png' }),
})).json();
assert.match(uploadedAvatar.avatarUrl, /^\/api\/media\/posters\/avatar-[a-f0-9-]+\.png$/);
assert.equal(uploadedAvatar.name, 'Viewer with photo');
assert.deepEqual(Buffer.from(await (await request(uploadedAvatar.avatarUrl.replace(/^\/api/, ''))).arrayBuffer()), poster);
const persisted = await (await request('/users/me', { headers: viewerHeaders })).json();
assert.equal(persisted.avatarUrl, uploadedAvatar.avatarUrl);
const withoutPhotoChange = await (await request('/users/me', { method: 'PATCH',
  headers: { ...viewerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Same photo' }),
})).json();
assert.equal(withoutPhotoChange.avatarUrl, uploadedAvatar.avatarUrl);
assert.equal((await fetch(`${base}/users/me`, { method: 'PATCH', headers: viewerHeaders,
  body: imageForm({}, '<svg/>'),
})).status, 400);
assert.equal((await fetch(`${base}/users/me`, { method: 'PATCH', headers: viewerHeaders,
  body: imageForm({}, Buffer.alloc(5 * 1024 * 1024 + 1)),
})).status, 413);
const linkedAvatar = await (await request('/users/me', { method: 'PATCH',
  headers: { ...viewerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarUrl: 'https://example.com/avatar.png' }),
})).json();
assert.equal(linkedAvatar.avatarUrl, 'https://example.com/avatar.png');
const noAvatar = await (await request('/users/me', { method: 'PATCH',
  headers: { ...viewerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarUrl: null }),
})).json();
assert.equal(noAvatar.avatarUrl, null);
console.log('PASS viewer avatar attachment, persistence, public image, file precedence, validation and optional URL');

assert.equal((await fetch(`${base}/media/actors`, { method: 'POST', headers: viewerHeaders,
  body: imageForm({ name: 'Forbidden actor' }),
})).status, 403);
const actor = await (await request('/media/actors', { method: 'POST', headers, body: imageForm({ name: 'CI Photo Actor' }) })).json();
try {
  assert.match(actor.photoUrl, /^\/api\/media\/posters\/actor-[a-f0-9-]+\.png$/);
  assert.deepEqual(Buffer.from(await (await request(actor.photoUrl.replace(/^\/api/, ''))).arrayBuffer()), poster);
  const replacement = await (await request(`/media/actors/${actor.id}`, { method: 'PATCH', headers, body: imageForm({ name: 'CI Updated Actor' }) })).json();
  assert.notEqual(replacement.photoUrl, actor.photoUrl);
  const link = await (await request(`/media/actors/${actor.id}`, { method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Linked Actor', photoUrl: 'https://example.com/actor.png' }),
  })).json();
  assert.equal(link.photoUrl, 'https://example.com/actor.png');
  const cleared = await (await request(`/media/actors/${actor.id}`, { method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'No photo', photoUrl: '' }),
  })).json();
  assert.equal(cleared.photoUrl, null);
} finally { await request(`/media/actors/${actor.id}`, { method: 'DELETE', headers }); }
const noPoster = new FormData(); noPoster.set('posterUrl', '');
const clearedPoster = await (await request(`/media/${movie.id}`, { method: 'PATCH', headers, body: noPoster })).json();
assert.equal(clearedPoster.posterUrl, '');
console.log('PASS actor photo attachment/replacement/URL/removal, role enforcement and poster removal');

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
