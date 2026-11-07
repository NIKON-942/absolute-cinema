import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { Repository } from 'typeorm';
import { MovieEntity, TranscodeStatusEnum } from './entities/movie.entity';
import { MASTERS_DIR, VIDEOS_DIR } from './media.constants';
import { canCopyVideo, prepareWebAudio, probeMedia, renderWebVideo } from './media-processing';
import type { MediaProbe, ProcessingProgress } from './media-processing';
import { downloadRemoteSource } from './remote-source';

type Quality = '480p' | '720p' | '1080p';
const TARGETS: Array<{ quality: Quality; height: number; column: 'video480' | 'video720' | 'video1080' }> = [
  { quality: '480p', height: 480, column: 'video480' },
  { quality: '720p', height: 720, column: 'video720' },
  { quality: '1080p', height: 1080, column: 'video1080' },
];
export interface RenditionProgress {
  quality: Quality; progress: number | null; state: 'queued' | 'converting' | 'finalizing' | 'ready' | 'failed'; mode: 'copy' | 'encode';
}
export interface TranscodeJobInfo {
  movieId: number; status: TranscodeStatusEnum; qualities: string[]; progress: number | null;
  phase: 'queued' | 'probing' | 'audio' | 'converting' | 'finalizing' | 'ready' | 'failed' | 'unavailable' | 'none';
  currentQuality: Quality | null; targetQualities: Quality[]; renditions: RenditionProgress[];
  startedAt: string | null; finishedAt: string | null; elapsedSeconds: number; remainingSeconds: number | null;
  error?: string;
}

/** One FFmpeg process at a time. Audio is prepared once; compatible original
 * video is remuxed rather than encoded. New movies publish complete renditions
 * incrementally; replacements keep the old video until every rendition succeeds. */
@Injectable()
export class TranscodeService implements OnModuleInit {
  private readonly logger = new Logger(TranscodeService.name);
  private readonly queue: Array<() => Promise<void>> = [];
  private draining = false;
  private readonly jobs = new Map<number, TranscodeJobInfo>();
  private readonly lastProgress = new Map<number, number>();
  constructor(@InjectRepository(MovieEntity) private moviesRepo: Repository<MovieEntity>) {}

  async onModuleInit(): Promise<void> {
    const interrupted = await this.moviesRepo.find({ where: { transcodeStatus: TranscodeStatusEnum.PROCESSING } });
    for (const movie of interrupted) {
      if (this.jobs.get(movie.id)?.status === TranscodeStatusEnum.PROCESSING) continue;
      if (movie.pendingMasterVideo) await this.enqueue(movie.id, movie.pendingMasterVideo);
      else await this.moviesRepo.update(movie.id, { transcodeStatus: TranscodeStatusEnum.FAILED });
    }
  }

  jobInfo(movieId: number): TranscodeJobInfo | undefined {
    const info = this.jobs.get(movieId);
    if (info?.startedAt) {
      info.elapsedSeconds = Math.max(0, ((info.finishedAt ? Date.parse(info.finishedAt) : Date.now()) - Date.parse(info.startedAt)) / 1000);
      const fresh = Date.now() - (this.lastProgress.get(movieId) ?? 0) < 15_000;
      info.remainingSeconds = info.status === TranscodeStatusEnum.PROCESSING && info.phase !== 'finalizing' && fresh
        && info.elapsedSeconds >= 10 && info.progress !== null && info.progress > 0
        ? Math.max(1, Math.ceil(info.elapsedSeconds * (100 - info.progress) / info.progress)) : null;
    }
    return info;
  }
  async enqueue(movieId: number, masterSource: string): Promise<void> {
    if (this.jobs.get(movieId)?.status === TranscodeStatusEnum.PROCESSING) throw new ConflictException({
      code: 'VIDEO_CONVERSION_IN_PROGRESS', message: 'This movie already has a video conversion in progress',
    });
    const info: TranscodeJobInfo = { movieId, status: TranscodeStatusEnum.PROCESSING, qualities: [], progress: null,
      phase: 'queued', currentQuality: null, targetQualities: [], renditions: [], startedAt: null, finishedAt: null,
      elapsedSeconds: 0, remainingSeconds: null };
    this.jobs.set(movieId, info);
    try { await this.moviesRepo.update(movieId, { transcodeStatus: TranscodeStatusEnum.PROCESSING, pendingMasterVideo: masterSource }); }
    catch (error) { this.jobs.delete(movieId); throw error; }
    this.queue.push(() => this.run(movieId, masterSource)); void this.drain();
  }
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try { while (this.queue.length) await this.queue.shift()!().catch(error => this.logger.error(`Job failed: ${error.message}`)); }
    finally { this.draining = false; }
  }
  private async run(movieId: number, masterSource: string): Promise<void> {
    const outputs: string[] = []; const published = new Set<string>(); let scratch: string | undefined;
    let input = join(MASTERS_DIR, masterSource);
    let remoteScratch: string | undefined;
    const info = this.jobs.get(movieId)!;
    info.startedAt = new Date().toISOString(); info.phase = 'probing';
    try {
      const movie = await this.moviesRepo.findOne({ where: { id: movieId } });
      if (!movie) throw new Error('Movie no longer exists');
      const isNew = !movie.video480 && !movie.video720 && !movie.video1080;
      await mkdir(VIDEOS_DIR, { recursive: true }); await mkdir(MASTERS_DIR, { recursive: true });
      if (/^https?:\/\//i.test(masterSource)) {
        remoteScratch = await mkdtemp(join(MASTERS_DIR, '.remote-'));
        input = join(remoteScratch, 'source');
        await downloadRemoteSource(masterSource, input);
      }
      const meta = await this.probe(input);
      const targets = TARGETS.filter(target => target.height <= meta.height);
      if (!targets.length) throw new Error('Master video must be at least 480 pixels high');
      info.targetQualities = targets.map(target => target.quality);
      info.renditions = targets.map(target => ({ quality: target.quality, state: 'queued', progress: 0, mode: canCopyVideo(meta, target.height) ? 'copy' : 'encode' }));
      const audioWeight = meta.audio ? 0.08 : 0;
      const weights = targets.map(target => canCopyVideo(meta, target.height) ? 0.04 : (target.height / 1080) ** 2);
      const total = audioWeight + weights.reduce((sum, weight) => sum + weight, 0);
      let reportedWork = -1;
      const report = (work: number) => {
        if (!meta.duration) return;
        const next = Math.min(99, Math.floor(work / total * 100));
        if (work > reportedWork) { this.lastProgress.set(movieId, Date.now()); reportedWork = work; }
        info.progress = Math.max(info.progress ?? 0, next);
      };
      let done = 0; let audio: string | undefined;
      info.progress = meta.duration ? 0 : null;
      if (meta.audio) {
        scratch = await mkdtemp(join(MASTERS_DIR, '.audio-')); audio = join(scratch, 'web.m4a'); info.phase = 'audio';
        await prepareWebAudio(input, audio, meta, seconds => report(audioWeight * (meta.duration ? Math.min(1, seconds / meta.duration) : 0)));
        done = audioWeight; report(done);
      }
      const base = `${movieId}-${randomUUID()}-${movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)}`;
      const rendered: Array<{ quality: Quality; file: string }> = [];
      for (const [index, target] of targets.entries()) {
        const rendition = info.renditions[index]; info.phase = 'converting'; info.currentQuality = target.quality; rendition.state = 'converting';
        const file = `${base}-${target.quality}.mp4`; const out = join(VIDEOS_DIR, file); outputs.push(out);
        await this.render(input, out, target.height, (seconds, finalizing) => {
          const fraction = meta.duration ? Math.min(1, Math.max(0, seconds / meta.duration)) : 0;
          if (finalizing || fraction >= 0.999) { rendition.state = 'finalizing'; info.phase = 'finalizing'; }
          rendition.progress = meta.duration ? Math.max(rendition.progress ?? 0, Math.min(99, Math.floor(fraction * 100))) : null;
          report(done + weights[index] * fraction);
        }, { meta, audio });
        const verified = await this.probe(out);
        if (verified.height !== target.height) throw new Error(`Unexpected height for ${target.quality}`);
        if (isNew) {
          const patch: Partial<MovieEntity> = { masterVideo: masterSource }; patch[target.column] = file;
          const publication = await this.moviesRepo.update(movieId, patch);
          if (publication?.affected === 0) throw new Error('Movie no longer exists');
          published.add(out);
        }
        rendered.push({ quality: target.quality, file }); info.qualities = rendered.map(r => r.quality);
        rendition.state = 'ready'; rendition.progress = 100; done += weights[index]; report(done);
      }
      info.phase = 'finalizing'; info.currentQuality = null;
      const result = await this.moviesRepo.update(movieId, { masterVideo: masterSource,
        video480: rendered.find(r => r.quality === '480p')?.file ?? null,
        video720: rendered.find(r => r.quality === '720p')?.file ?? null,
        video1080: rendered.find(r => r.quality === '1080p')?.file ?? null, transcodeStatus: TranscodeStatusEnum.READY, pendingMasterVideo: null });
      if (result?.affected === 0) throw new Error('Movie no longer exists');
      outputs.forEach(path => published.add(path));
      info.status = TranscodeStatusEnum.READY; info.phase = 'ready'; info.progress = 100;
      const previous = [movie.video480, movie.video720, movie.video1080].filter((file): file is string => Boolean(file) && basename(file!) === file);
      await Promise.all(previous.map(file => rm(join(VIDEOS_DIR, file), { force: true }).catch(() => undefined)));
      if (movie.masterVideo && movie.masterVideo !== masterSource && basename(movie.masterVideo) === movie.masterVideo) await rm(join(MASTERS_DIR, movie.masterVideo), { force: true }).catch(() => undefined);
      this.logger.log(`Movie #${movieId} transcoded: ${rendered.map(r => r.quality).join(', ')}`);
    } catch (error) {
      await Promise.all(outputs.filter(path => !published.has(path)).map(path => rm(path, { force: true }).catch(() => undefined)));
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Transcode failed for movie #${movieId}: ${message}`);
      await this.moviesRepo.update(movieId, { transcodeStatus: TranscodeStatusEnum.FAILED, pendingMasterVideo: null }).catch(() => undefined);
      const current = info.renditions.find(r => r.quality === info.currentQuality); if (current) current.state = 'failed';
      info.status = TranscodeStatusEnum.FAILED; info.phase = 'failed'; info.currentQuality = null; info.error = message;
    } finally {
      info.finishedAt = new Date().toISOString(); this.jobInfo(movieId);
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      if (remoteScratch) await rm(remoteScratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  async probe(input: string): Promise<MediaProbe> { return probeMedia(input); }
  private async render(input: string, output: string, height: number, progress?: ProcessingProgress, prepared?: { meta: MediaProbe; audio?: string }) {
    if (prepared) return renderWebVideo(input, output, height, prepared.meta, prepared.audio, progress);
    const meta = await this.probe(input); let scratch: string | undefined;
    try {
      let audio: string | undefined;
      if (meta.audio) {
        await mkdir(MASTERS_DIR, { recursive: true }); scratch = await mkdtemp(join(MASTERS_DIR, '.audio-'));
        audio = join(scratch, 'web.m4a'); await prepareWebAudio(input, audio, meta);
      }
      await renderWebVideo(input, output, height, meta, audio, progress);
    } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  }
}
