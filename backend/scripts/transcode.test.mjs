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
    assert.deepEqual(await service.probe(input), { height: 720 });
    await service.render(input, output, 480);
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
