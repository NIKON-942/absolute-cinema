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
    const bytes = await readFile(output);
    assert.ok(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'));
    await service.render(input, output, 1080);
    assert.equal(probe(output).streams.find(s => s.codec_type === 'video').height, 720);
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
  pipeline.probe = async () => ({ height: 1080, duration: 10 });
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
