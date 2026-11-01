import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { TranscodeService } = require('../dist/modules/media/transcode.service.js');
const service = new TranscodeService({});
const processing = require('../dist/modules/media/media-processing.js');
const ffmpeg = args => execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));

test('direct FFmpeg preserves audio, dimensions and faststart; filenames bypass the shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cinema transcode '));
  try {
    const input = join(directory, 'input ; video.mp4');
    const output = join(directory, 'output ; video.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    const metadata = await service.probe(input);
    assert.equal(metadata.height, 720);
    assert.ok(metadata.duration > 0);
    const progress = [];
    await service.render(input, output, 480, seconds => progress.push(seconds));
    assert.ok(progress.length > 0);
    assert.ok(progress.every(seconds => Number.isFinite(seconds) && seconds >= 0));
    const streams = probe(output).streams;
    const video = streams.find(s => s.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.height, 480);
    assert.equal(video.width % 2, 0);
    assert.equal(streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
    assert.equal(await processing.streamHash(input, 'a'), await processing.streamHash(output, 'a'), 'compatible AAC is not re-encoded');
    const bytes = await readFile(output);
    assert.ok(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'));
    await service.render(input, output, 1080);
    assert.equal(probe(output).streams.find(s => s.codec_type === 'video').height, 720);
    await service.render(input, output, 720);
    assert.equal(await processing.streamHash(input, 'v'), await processing.streamHash(output, 'v'), 'compatible original video is copied exactly');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('silent video works; corrupt and audio-only masters fail clearly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cinema transcode '));
  try {
    const input = join(directory, 'silent.mp4');
    const output = join(directory, 'output.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=854x480:r=2', '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
    await service.render(input, output, 480);
    assert.equal(probe(output).streams.filter(s => s.codec_type === 'audio').length, 0);
    const audio = join(directory, 'audio.wav');
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '0.1', audio]);
    await assert.rejects(service.probe(audio), /must contain a video stream/);
    const corrupt = join(directory, 'corrupt.mp4');
    await writeFile(corrupt, 'invalid video');
    await assert.rejects(service.probe(corrupt));
    await assert.rejects(service.render(corrupt, output, 480));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(check) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('Job did not settle');
}

test('aggregate conversion progress is monotonic and reaches 100 only after the final database update', async () => {
  const samples = [];
  const writes = [];
  const pipeline = new TranscodeService({
    findOne: async ({ where }) => ({ id: where.id, title: 'Progress fixture' }),
    update: async (_id, patch) => {
      if (patch.transcodeStatus === 'ready') assert.ok(pipeline.jobInfo(1).progress < 100);
      writes.push(patch);
    },
  });
  pipeline.probe = async input => ({ height: Number(/-(480|720|1080)p\.mp4$/.exec(input)?.[1] ?? 1080), duration: 10 });
  pipeline.render = async (_input, _output, height, report) => {
    assert.equal(pipeline.jobInfo(1).currentQuality, `${height}p`);
    for (const seconds of [0, 5, 4, 10, 12]) {
      report(seconds);
      samples.push(pipeline.jobInfo(1).progress);
    }
  };
  await pipeline.enqueue(1, 'fixture.mp4');
  await waitFor(() => pipeline.jobInfo(1).status === 'ready');
  assert.ok(samples.every((value, index) => value >= 0 && value < 100 && (!index || value >= samples[index - 1])));
  assert.ok(samples.some(value => value > 0 && value < 99));
  assert.equal(pipeline.jobInfo(1).progress, 100);
  assert.equal(pipeline.jobInfo(1).phase, 'ready');
  assert.deepEqual(pipeline.jobInfo(1).qualities, ['480p', '720p', '1080p']);
  assert.equal(writes.filter(patch => patch.video480 || patch.video720 || patch.video1080).length, 4);
  assert.ok(writes.findIndex(patch => patch.video480) < writes.findIndex(patch => patch.video720), 'new movies publish lower qualities first');
  assert.ok(pipeline.jobInfo(1).renditions.every(r => r.progress === 100 && r.state === 'ready'));
});

test('queued movies keep separate states; duplicate jobs are rejected and failures release the queue', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pipeline = new TranscodeService({
    findOne: async ({ where }) => ({ id: where.id, title: 'Same title' }), update: async () => {},
  });
  pipeline.probe = async () => ({ height: 480, duration: 10 });
  pipeline.render = async (input, _output, _height, report) => {
    if (input.endsWith('bad.mp4')) {
      await gate;
      report(5);
      throw new Error('Synthetic encoder failure');
    }
    report(10);
  };
  await pipeline.enqueue(1, 'bad.mp4');
  await pipeline.enqueue(2, 'good.mp4');
  assert.equal(pipeline.jobInfo(2).phase, 'queued');
  assert.equal(pipeline.jobInfo(2).progress, null);
  await assert.rejects(pipeline.enqueue(2, 'replacement.mp4'), /already has a video conversion/);
  release();
  await waitFor(() => pipeline.jobInfo(2).status === 'ready');
  assert.equal(pipeline.jobInfo(1).phase, 'failed');
  assert.equal(pipeline.jobInfo(1).progress, 50);
  assert.equal(pipeline.jobInfo(2).progress, 100);
});

test('failed replacement preserves the previous master and playable renditions', async () => {
  const movie = { id: 7, title: 'Existing movie', masterVideo: 'previous-master.mp4', video480: 'previous-480p.mp4', video720: 'previous-720p.mp4', transcodeStatus: 'ready' };
  const pipeline = new TranscodeService({
    findOne: async () => ({ ...movie }),
    update: async (_id, patch) => { Object.assign(movie, patch); },
  });
  pipeline.probe = async () => ({ height: 720, duration: 10 });
  pipeline.render = async () => { throw Error('Synthetic replacement failure'); };
  await pipeline.enqueue(movie.id, 'replacement-master.mp4');
  await waitFor(() => pipeline.jobInfo(movie.id).status === 'failed');
  assert.equal(movie.masterVideo, 'previous-master.mp4');
  assert.equal(movie.video480, 'previous-480p.mp4');
  assert.equal(movie.video720, 'previous-720p.mp4');
});

test('surround centre dialogue is mixed into both stereo channels without gain or clipping', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cinema surround '));
  try {
    const input = join(directory, 'surround.mkv'), output = join(directory, 'web.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=854x480:r=2', '-f', 'lavfi', '-i',
      'aevalsrc=0|0|0.35*sin(2*PI*440*t)|0|0|0:channel_layout=5.1:sample_rate=48000',
      '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'eac3', '-b:a', '640k', input]);
    await service.render(input, output, 480);
    const audio = probe(output).streams.find(s => s.codec_type === 'audio');
    assert.equal(audio.codec_name, 'aac'); assert.equal(audio.profile, 'LC'); assert.equal(audio.channels, 2);
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], { maxBuffer: 2 * 1024 * 1024 });
    let left = 0, right = 0, peak = 0;
    for (let offset = 0; offset + 7 < pcm.length; offset += 8) {
      const a = pcm.readFloatLE(offset), b = pcm.readFloatLE(offset + 4); left += a * a; right += b * b; peak = Math.max(peak, Math.abs(a), Math.abs(b));
    }
    assert.ok(Math.sqrt(left / (pcm.length / 8)) > 0.01, 'centre dialogue must remain audible');
    assert.ok(Math.abs(10 * Math.log10(left / right)) < 0.1, 'dialogue is balanced in both channels');
    assert.ok(peak < 0.5, 'no arbitrary gain boost or clipping');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('extracting audio once preserves the original audio/video start offset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cinema sync '));
  try {
    const input = join(directory, 'offset.mkv'), output = join(directory, 'web.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=854x480:r=10', '-itsoffset', '0.3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    await service.render(input, output, 480);
    const offset = file => {
      const streams = probe(file).streams;
      return Number(streams.find(s => s.codec_type === 'audio').start_time) - Number(streams.find(s => s.codec_type === 'video').start_time);
    };
    assert.ok(Math.abs(offset(input) - offset(output)) < 0.05, `A/V offset changed: ${offset(input)} to ${offset(output)}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('copy eligibility rejects incompatible formats, scaling, rotation and interlacing', () => {
  const meta = { width: 1920, height: 1080, codec: 'h264', pixelFormat: 'yuv420p', profile: 'High', level: 41, frameRate: 25, aspect: '1:1', fieldOrder: 'progressive' };
  assert.equal(processing.canCopyVideo(meta, 1080), true);
  for (const patch of [{ codec: 'hevc' }, { pixelFormat: 'yuv420p10le' }, { rotation: 90 }, { fieldOrder: 'tt' }, { frameRate: 120 }]) assert.equal(processing.canCopyVideo({ ...meta, ...patch }, 1080), false);
  assert.equal(processing.canCopyVideo(meta, 720), false);
});

test('audio is prepared once for every rendition; a later failure keeps the first published quality', async () => {
  const original = processing.prepareWebAudio; let count = 0; const audioPaths = [];
  const movie = { id: 31, title: 'Partial publication', video480: null, video720: null, video1080: null };
  const pipeline = new TranscodeService({ findOne: async () => ({ ...movie }), update: async (_id, patch) => { Object.assign(movie, patch); } });
  pipeline.probe = async input => ({ height: Number(/-(480|720|1080)p\.mp4$/.exec(input)?.[1] ?? 1080), duration: 10,
    audio: { index: 1, codec: 'eac3', channels: 6, sampleRate: 48000 } });
  processing.prepareWebAudio = async () => { count++; };
  pipeline.render = async (_input, _output, height, report, prepared) => {
    audioPaths.push(prepared.audio);
    if (height === 720) { assert.ok(movie.video480); throw Error('Synthetic later failure'); }
    report(10, true);
  };
  try {
    await pipeline.enqueue(31, 'fixture.mkv'); await waitFor(() => pipeline.jobInfo(31).status === 'failed');
    assert.equal(count, 1); assert.equal(new Set(audioPaths).size, 1);
    assert.ok(movie.video480); assert.equal(movie.video720, null);
    assert.deepEqual(pipeline.jobInfo(31).qualities, ['480p']);
  } finally { processing.prepareWebAudio = original; }
});
