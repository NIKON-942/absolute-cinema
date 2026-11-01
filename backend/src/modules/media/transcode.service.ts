import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ffmpeg from 'fluent-ffmpeg';
import { mkdirSync } from 'fs';
import { Repository } from 'typeorm';
import { MovieEntity, TranscodeStatusEnum } from './entities/movie.entity';
import { MASTERS_DIR, VIDEOS_DIR } from './media.constants';

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

const QUALITY_COLUMN: Record<TargetSpec['quality'], 'video480' | 'video720' | 'video1080'> = {
  '480p': 'video480',
  '720p': 'video720',
  '1080p': 'video1080',
};

export interface TranscodeJobInfo {
  movieId: number;
  status: TranscodeStatusEnum;
  qualities: string[];
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
  enqueue(movieId: number, masterSource: string): void {
    this.jobs.set(movieId, {
      movieId,
      status: TranscodeStatusEnum.PROCESSING,
      qualities: [],
    });
    // The master changed, so previous renditions are stale (and their files
    // are about to be overwritten) — unlink them before anything renders.
    void this.moviesRepo.update(movieId, {
      transcodeStatus: TranscodeStatusEnum.PROCESSING,
      video480: null,
      video720: null,
      video1080: null,
    });
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
    const movie = await this.moviesRepo.findOne({ where: { id: movieId } });
    if (!movie) return;

    const input = /^https?:\/\//i.test(masterSource)
      ? masterSource
      : `${MASTERS_DIR}/${masterSource}`;

    try {
      mkdirSync(VIDEOS_DIR, { recursive: true });
      const meta = await this.probe(input);
      const baseSlug = movie.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const targets = TARGETS.filter((t) => t.height <= meta.height || meta.height === 0);
      const rendered: Array<{ quality: string; file: string }> = [];

      for (const target of targets) {
        const out = `${VIDEOS_DIR}/${baseSlug}-${target.quality}.mp4`;
        await this.render(input, out, target.height);
        const file = `${baseSlug}-${target.quality}.mp4`;
        rendered.push({ quality: target.quality, file });
        // Link each rendition the moment it finishes so the movie is
        // watchable (at the qualities done so far) while the rest render.
        const patch: Partial<
          Pick<MovieEntity, 'video480' | 'video720' | 'video1080'>
        > = {};
        patch[QUALITY_COLUMN[target.quality]] = file;
        await this.moviesRepo.update(movieId, patch);
        const info = this.jobs.get(movieId);
        if (info) info.qualities = rendered.map((r) => r.quality);
      }

      await this.moviesRepo.update(movieId, {
        video480: rendered.find((r) => r.quality === '480p')?.file ?? null,
        video720: rendered.find((r) => r.quality === '720p')?.file ?? null,
        video1080: rendered.find((r) => r.quality === '1080p')?.file ?? null,
        transcodeStatus: TranscodeStatusEnum.READY,
      });
      const info = this.jobs.get(movieId);
      if (info) {
        info.status = TranscodeStatusEnum.READY;
        info.qualities = rendered.map((r) => r.quality);
      }
      this.logger.log(
        `Movie #${movieId} transcoded: ${rendered.map((r) => r.quality).join(', ') || 'nothing (master too small)'}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Transcode failed for movie #${movieId}: ${message}`);
      await this.moviesRepo
        .update(movieId, { transcodeStatus: TranscodeStatusEnum.FAILED })
        .catch(() => undefined);
      const info = this.jobs.get(movieId);
      if (info) {
        info.status = TranscodeStatusEnum.FAILED;
        info.error = message;
      }
    }
  }

  /** Resolves the input dimensions so we never upscale a small master. */
  private probe(input: string): Promise<{ height: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(input, (err, data) => {
        if (err) return reject(err);
        const video = (data.streams ?? []).find((s) => s.codec_type === 'video');
        resolve({ height: video?.height ?? 0 });
      });
    });
  }

  private render(input: string, output: string, targetHeight: number): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .videoFilters(
          `scale=-2:'min(${targetHeight},ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
        )
        .videoCodec('libx264')
        .outputOptions(['-crf 23', '-preset veryfast', '-movflags +faststart'])
        .audioCodec('aac')
        .audioBitrate('128k')
        .output(output)
        .on('error', (err) => reject(err))
        .on('end', () => resolve())
        .run();
    });
  }
}
