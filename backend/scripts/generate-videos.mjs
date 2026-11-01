#!/usr/bin/env node
/**
 * Offline demo-media pipeline (mirrors the runtime TranscodeService):
 *  1. For each seeded movie, render a 1080p master clip into storage/masters/
 *     and link it to the movie record (master_video, transcode_status='ready').
 *  2. Transcode the master into 480p/720p/1080p variants in storage/videos/
 *     using the same H.264/AAC/faststart parameters as the API, and link the
 *     variant filenames to the movie (video_480/video_720/video_1080).
 *  3. Simple SVG posters into storage/posters/<slug>.svg.
 *
 * Requires ffmpeg on PATH. Exits 0 with instructions when it is missing.
 * Idempotent: existing files are kept (delete storage/ to force re-render).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const root = process.cwd();
const mastersDir = join(root, 'storage', 'masters');
const videosDir = join(root, 'storage', 'videos');
const postersDir = join(root, 'storage', 'posters');
for (const d of [mastersDir, videosDir, postersDir]) mkdirSync(d, { recursive: true });

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ffmpeg = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffprobe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;

/** Same targets/params as backend/src/modules/media/transcode.service.ts. */
const TARGETS = [
  { quality: '480p', height: 480 },
  { quality: '720p', height: 720 },
  { quality: '1080p', height: 1080 },
];

const VF = (h) =>
  `scale=-2:'min(${h},ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`;

function render(input, output, height) {
  execFileSync(
    ffmpeg,
    [
      '-y', '-i', input,
      '-vf', VF(height),
      '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      output,
    ],
    { stdio: 'ignore' },
  );
}

const PALETTES = [
  ['#1a1a2e', '#e94560'], ['#0f3460', '#e94560'], ['#16213e', '#f59e0b'],
  ['#202040', '#00d9ff'], ['#2d132c', '#ee4540'], ['#0b0c10', '#f59e0b'],
];

function posterSvg(title, [bg, accent]) {
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}"/>
      <stop offset="1" stop-color="${accent}"/>
    </linearGradient>
  </defs>
  <rect width="500" height="750" fill="url(#g)"/>
  <circle cx="400" cy="150" r="90" fill="rgba(255,255,255,0.08)"/>
  <circle cx="90" cy="620" r="130" fill="rgba(0,0,0,0.18)"/>
  <text x="40" y="380" font-family="Arial Black, Arial, sans-serif" font-size="44"
        font-weight="900" fill="#ffffff" width="420">${escaped.slice(0, 18)}</text>
  <text x="40" y="430" font-family="Arial, sans-serif" font-size="22"
        fill="rgba(255,255,255,0.75)">AbsoluteCinema</text>
  <rect x="40" y="330" width="90" height="6" fill="${accent}"/>
</svg>`;
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'cinema',
    password: process.env.DB_PASSWORD ?? 'cinema',
    database: process.env.DB_NAME ?? 'absolutecinema',
  });
  await client.connect();
  const { rows: movies } = await client.query('SELECT id, title FROM movies ORDER BY id');

  if (movies.length === 0) {
    console.error('No movies in the database — run migrations + seed first.');
    process.exit(1);
  }

  // posters (no ffmpeg needed)
  let posters = 0;
  movies.forEach((m, i) => {
    const file = join(postersDir, `${slugify(m.title)}.svg`);
    if (!existsSync(file)) {
      writeFileSync(file, posterSvg(m.title, PALETTES[i % PALETTES.length]));
      posters++;
    }
  });
  console.log(`posters: ${posters} created in storage/posters`);

  if (!ffmpegAvailable) {
    console.log(
      'ffmpeg not found on PATH — skipping master/variant generation.\n' +
      'Install ffmpeg (https://ffmpeg.org) and re-run: npm run videos:generate',
    );
    await client.end();
    return;
  }

  let masters = 0;
  let variants = 0;
  for (const m of movies) {
    const slug = slugify(m.title);
    const master = join(mastersDir, `${slug}-master.mp4`);

    // 1. master (1080p testsrc) — regenerated only if missing
    if (!existsSync(master)) {
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-f', 'lavfi', '-i', 'testsrc2=duration=30:size=1920x1080:rate=24',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-shortest',
          master,
        ],
        { stdio: 'ignore' },
      );
      masters++;
    }

    // 2. transcode master -> variants (same params as the API service)
    const existing = {};
    for (const { quality, height } of TARGETS) {
      const out = join(videosDir, `${slug}-${quality}.mp4`);
      if (!existsSync(out)) {
        render(master, out, height);
        variants++;
      }
      existing[quality] = `${slug}-${quality}.mp4`;
    }

    // 3. link master + variants + status to the movie record
    await client.query(
      `UPDATE movies SET
         master_video = $2,
         transcode_status = 'ready',
         "video480" = $3, "video720" = $4, "video1080" = $5
       WHERE id = $1`,
      [m.id, `${slug}-master.mp4`, existing['480p'], existing['720p'], existing['1080p']],
    );
    console.log(`movie #${m.id} ${m.title}: master ok, variants 480p/720p/1080p`);
  }
  await client.end();

  console.log(
    `done: ${masters} masters + ${variants} variants rendered; all movies linked (status=ready)`,
  );
}

main().catch((err) => {
  console.error('generate-videos failed:', err.message);
  process.exit(1);
});
