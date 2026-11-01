import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdirSync } from 'fs';
import { rm } from 'node:fs/promises';
import { Repository } from 'typeorm';
import { MovieEntity, TranscodeStatusEnum } from './entities/movie.entity';
import { MASTERS_DIR, VIDEOS_DIR } from './media.constants';

const runExecutable = promisify(execFile);
const PROCESS_OPTIONS = { encoding: 'utf8' as const, maxBuffer: 1024 * 1024, windowsHide: true };

interface TargetSpec {
  quality: '480p' | '720p' | '1080p';
  height: number;
}

/** Targets ordered low→high; only those <= master height are rendered. */
const TARGETS: TargetSpec[] = [
  { quality: '480p', height: 480 },
  { quality: '720p', height: 720 },
  { quality: '1080p', height: 1080 },
];

export interface TranscodeJobInfo {
  movieId: number;
  status: TranscodeStatusEnum;
  qualities: string[];
  progress: number | null;
  phase: 'queued' | 'probing' | 'converting' | 'finalizing' | 'ready' | 'failed' | 'unavailable' | 'none';
  currentQuality: TargetSpec['quality'] | null;
  targetQualities: TargetSpec['quality'][];
  error?: string;
}

/**
 * Background transcoding pipeline: a single master upload is rendered into
 * 480p/720p/1080p H.264/AAC MP4s (faststart for HTTP Range streaming) and the
 * resulting file paths are linked back to the movie record. Jobs run
 * sequentially in-process; enough for this deployment's scale.
 */
@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);
  private readonly queue: Array<() => Promise<void>> = [];
  private draining = false;

  /** Latest known state per movie, exposed to admin polling. */
  private readonly jobs = new Map<number, TranscodeJobInfo>();

  constructor(
    @InjectRepository(MovieEntity)
    private moviesRepo: Repository<MovieEntity>,
  ) {}

  jobInfo(movieId: number): TranscodeJobInfo | undefined {
    return this.jobs.get(movieId);
  }

  /** Registers a job and starts draining the queue in the background. */
  async enqueue(movieId: number, masterSource: string): Promise<void> {
    if (this.jobs.get(movieId)?.status === TranscodeStatusEnum.PROCESSING) {
      throw new ConflictException('This movie already has a video conversion in progress');
    }
    const info: TranscodeJobInfo = {
      movieId,
      status: TranscodeStatusEnum.PROCESSING,
      qualities: [],
      progress: null,
      phase: 'queued',
      currentQuality: null,
      targetQualities: [],
    };
    this.jobs.set(movieId, info);
    // Keep the current master and renditions playable until replacement succeeds.
    try {
      await this.moviesRepo.update(movieId, {
        transcodeStatus: TranscodeStatusEnum.PROCESSING,
      });
    } catch (error) {
      this.jobs.delete(movieId);
      throw error;
    }
    this.queue.push(() => this.run(movieId, masterSource));
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) break;
        await job().catch((err) => this.logger.error(`Job failed: ${err.message}`));
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(movieId: number, masterSource: string): Promise<void> {
    const outputs: string[] = [];
    const input = /^https?:\/\//i.test(masterSource)
      ? masterSource
      : `${MASTERS_DIR}/${masterSource}`;

    try {
      const info = this.jobs.get(movieId)!;
      info.phase = 'probing';
      const movie = await this.moviesRepo.findOne({ where: { id: movieId } });
      if (!movie) throw new Error('Movie no longer exists');
      mkdirSync(VIDEOS_DIR, { recursive: true });
      const meta = await this.probe(input);
      const baseSlug = `${movieId}-${randomUUID()}-` + movie.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '').slice(0, 100);
      const targets = TARGETS.filter((t) => t.height <= meta.height);
      if (targets.length === 0) throw new Error('Master video must be at least 480 pixels high');
      info.targetQualities = targets.map(t => t.quality);
      info.progress = meta.duration ? 0 : null;
      const rendered: Array<{ quality: string; file: string }> = [];

      for (const [index, target] of targets.entries()) {
        info.phase = 'converting';
        info.currentQuality = target.quality;
        const out = `${VIDEOS_DIR}/${baseSlug}-${target.quality}.mp4`;
        outputs.push(out);
        await this.render(input, out, target.height, (seconds) => {
          if (!meta.duration) return;
          const fraction = Math.min(1, Math.max(0, seconds / meta.duration));
          const progress = Math.min(99, Math.floor((index + fraction) / targets.length * 100));
          info.progress = Math.max(info.progress ?? 0, progress);
        });
        const file = `${baseSlug}-${target.quality}.mp4`;
        rendered.push({ quality: target.quality, file });
        info.qualities = rendered.map((r) => r.quality);
        if (meta.duration) info.progress = Math.min(99, Math.floor((index + 1) / targets.length * 100));
      }

      info.phase = 'finalizing';
      info.currentQuality = null;
      await this.moviesRepo.update(movieId, {
        masterVideo: masterSource,
        video480: rendered.find((r) => r.quality === '480p')?.file ?? null,
        video720: rendered.find((r) => r.quality === '720p')?.file ?? null,
        video1080: rendered.find((r) => r.quality === '1080p')?.file ?? null,
        transcodeStatus: TranscodeStatusEnum.READY,
      });
      info.status = TranscodeStatusEnum.READY;
      info.phase = 'ready';
      info.progress = 100;
      info.currentQuality = null;
      info.qualities = rendered.map((r) => r.quality);
      // Publish the replacement first. Never remove a playable rendition while
      // a new upload is still being verified or converted.
      const previous = [movie.video480, movie.video720, movie.video1080]
        .filter((file): file is string => Boolean(file) && basename(file!) === file);
      await Promise.all(previous.map(file => rm(join(VIDEOS_DIR, file), { force: true }).catch(() => undefined)));
      if (movie.masterVideo && movie.masterVideo !== masterSource && basename(movie.masterVideo) === movie.masterVideo) {
        await rm(join(MASTERS_DIR, movie.masterVideo), { force: true }).catch(() => undefined);
      }
      this.logger.log(
        `Movie #${movieId} transcoded: ${rendered.map((r) => r.quality).join(', ') || 'nothing (master too small)'}`,
      );
    } catch (err: unknown) {
      await Promise.all(outputs.map(path => rm(path, { force: true }).catch(() => undefined)));
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Transcode failed for movie #${movieId}: ${message}`);
      await this.moviesRepo
        .update(movieId, { transcodeStatus: TranscodeStatusEnum.FAILED })
        .catch(() => undefined);
      const info = this.jobs.get(movieId);
      if (info) {
        info.status = TranscodeStatusEnum.FAILED;
        info.phase = 'failed';
        info.currentQuality = null;
        info.error = message;
      }
    }
  }

  /** Resolves the input dimensions so we never upscale a small master. */
  async probe(input: string): Promise<{ height: number; duration: number | null }> {
    const { stdout } = await runExecutable('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height,duration:format=duration',
      '-of', 'json', input,
    ], { ...PROCESS_OPTIONS, timeout: 60_000 });
    const data = JSON.parse(stdout) as { streams?: Array<{ height?: number; duration?: string }>; format?: { duration?: string } };
    const height = data.streams?.[0]?.height;
    if (!height || !Number.isFinite(height) || height <= 0) {
      throw new Error('Master source must contain a video stream with a valid height');
    }
    const duration = Number(data.format?.duration ?? data.streams?.[0]?.duration);
    return { height, duration: Number.isFinite(duration) && duration > 0 ? duration : null };
  }

  private render(input: string, output: string, targetHeight: number, onProgress?: (seconds: number) => void): Promise<void> {
    // Argument arrays bypass the shell, including for URLs and filenames with spaces.
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-y', '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `scale=-2:'min(${targetHeight},ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
        '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', output,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let buffer = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('out_time_us=')) continue;
          const microseconds = Number(line.slice('out_time_us='.length).trim());
          if (Number.isFinite(microseconds) && microseconds >= 0) onProgress?.(microseconds / 1_000_000);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg failed (${signal ?? code}): ${stderr.trim()}`));
      });
    });
  }
}
