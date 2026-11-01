import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Request } from 'express';
import { MASTERS_DIR } from './media.constants';
import { MediaService } from './media.service';
import { TranscodeService } from './transcode.service';

export const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;
export const MAX_UPLOAD_SIZE = 8 * 1024 ** 3;
const RETENTION = 7 * 24 * 60 * 60 * 1000;
const HASH = /^[a-f0-9]{64}$/;
interface Upload {
  id: string; movieId: number; movieTitle: string; ownerId: number; filename: string; size: number;
  sha256: string; chunks: string[]; offset: number; updatedAt: number;
  state: 'uploading' | 'verifying' | 'processing' | 'ready' | 'failed';
  error?: string;
}

/** tus 1.0 core/creation/checksum/termination transport, with an explicit
 * application finalization step for full-file SHA-256 and video validation.
 * The durable offset is committed only after checksum verification and fsync.
 * This store is intended for the deployment's single API instance.
 */
@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly root = join(MASTERS_DIR, '.uploads');
  private readonly locks = new Set<string>();
  private readonly logger = new Logger(UploadsService.name);
  constructor(private media: MediaService, private transcode: TranscodeService) {}

  private directory(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException('Upload not found');
    return join(this.root, id);
  }
  private source(u: Upload) { return `${u.id}-master${extname(u.filename).toLowerCase()}`; }
  private data(u: Upload) { return join(MASTERS_DIR, this.source(u)); }
  private async save(u: Upload) {
    u.updatedAt = Date.now();
    const dir = this.directory(u.id);
    const file = await open(join(dir, 'state.tmp'), 'w');
    try { await file.writeFile(JSON.stringify(u)); await file.sync(); } finally { await file.close(); }
    await rename(join(dir, 'state.tmp'), join(dir, 'state.json'));
  }
  private async load(id: string, ownerId?: number): Promise<Upload> {
    let u: Upload;
    try { u = JSON.parse(await readFile(join(this.directory(id), 'state.json'), 'utf8')); }
    catch { throw new NotFoundException('Upload not found or expired'); }
    if (ownerId !== undefined && u.ownerId !== ownerId) throw new NotFoundException('Upload not found');
    return u;
  }
  private async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.locks.has(id)) throw new ConflictException('Upload is busy; retry shortly');
    this.locks.add(id);
    try { return await action(); } finally { this.locks.delete(id); }
  }
  private async all(): Promise<Upload[]> {
    await mkdir(this.root, { recursive: true });
    const ids = await readdir(this.root);
    const results = await Promise.all(ids.map(id => this.load(id).catch(() => null)));
    return results.filter((u): u is Upload => u !== null);
  }
  async onModuleInit() {
    await this.cleanup();
    for (const u of await this.all()) {
      if (u.state === 'verifying' || u.state === 'processing') this.launch(u.id);
    }
  }
  @Interval(60 * 60 * 1000)
  async cleanup() {
    for (let u of await this.all()) {
      // Conversion may finish with every browser tab closed. Refresh its
      // durable outcome so failed sources also enter the retention window.
      if (u.state === 'processing' && !this.locks.has(u.id)) {
        await this.status(u.id, u.ownerId).catch(() => undefined);
        u = await this.load(u.id);
      }
      if (this.locks.has(u.id) || u.state === 'verifying' || u.state === 'processing' || Date.now() - u.updatedAt < RETENTION) continue;
      await this.locked(u.id, async () => {
        // A ready source is now owned by the movie, never delete it here.
        const movie = await this.media.getMovieEntity(u.movieId).catch(() => null);
        if (u.state !== 'ready' && movie?.masterVideo !== this.source(u)) await rm(this.data(u), { force: true });
        await rm(this.directory(u.id), { recursive: true, force: true });
      }).catch(error => this.logger.warn(String(error)));
    }
  }
  async create(movieId: number, ownerId: number, input: { filename: string; size: number; sha256: string; chunks: string[] }) {
    return this.locked(`movie-${movieId}`, async () => {
      const movie = await this.media.getMovie(movieId);
      if (!input || typeof input.filename !== 'string' || input.filename.length > 255 || !/\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(input.filename)
        || !Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_UPLOAD_SIZE
        || !HASH.test(input.sha256) || !Array.isArray(input.chunks)
        || input.chunks.length !== Math.ceil(input.size / UPLOAD_CHUNK_SIZE) || input.chunks.some(h => typeof h !== 'string' || !HASH.test(h))) {
        throw new BadRequestException('Invalid video upload manifest (maximum 8 GiB)');
      }
      const existing = (await this.all()).find(u => u.movieId === movieId && !['ready', 'failed'].includes(u.state));
      if (existing) {
        if (existing.ownerId === ownerId && existing.sha256 === input.sha256 && existing.size === input.size) return this.view(existing);
        throw new ConflictException('This movie already has an unfinished upload');
      }
      const job = await this.media.transcodeJob(movieId);
      if (job.status === 'processing') throw new ConflictException('This movie is being converted');
      const u: Upload = { id: randomUUID(), movieId, movieTitle: movie.title, ownerId, filename: input.filename, size: input.size,
        sha256: input.sha256, chunks: input.chunks, offset: 0, state: 'uploading', updatedAt: Date.now() };
      await mkdir(this.directory(u.id), { recursive: true });
      await writeFile(this.data(u), '');
      await this.save(u);
      return this.view(u);
    });
  }
  private async view(u: Upload) {
    let job;
    try { job = u.state === 'processing' || u.state === 'ready' ? await this.media.transcodeJob(u.movieId) : undefined; }
    catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      u.state = 'failed'; u.error = 'Movie no longer exists'; await this.save(u);
    }
    if (u.state === 'processing' && job?.status === 'ready') { u.state = 'ready'; await this.save(u); }
    if (u.state === 'processing' && job?.status === 'failed') { u.state = 'failed'; u.error = ('error' in job ? job.error : undefined) ?? 'Video conversion failed'; await this.save(u); }
    return { id: u.id, movieId: u.movieId, movieTitle: u.movieTitle, filename: u.filename, size: u.size, sha256: u.sha256,
      offset: u.offset, state: u.state, error: u.error, chunkSize: UPLOAD_CHUNK_SIZE,
      expiresAt: new Date(u.updatedAt + RETENTION).toISOString(), job };
  }
  async list(ownerId: number) {
    return Promise.all((await this.all()).filter(u => u.ownerId === ownerId).map(u => this.status(u.id, ownerId)));
  }
  async status(id: string, ownerId: number) {
    if (this.locks.has(id)) {
      const u = await this.load(id, ownerId);
      return { id: u.id, movieId: u.movieId, movieTitle: u.movieTitle, filename: u.filename, size: u.size, sha256: u.sha256,
        offset: u.offset, state: u.state, error: u.error, chunkSize: UPLOAD_CHUNK_SIZE,
        expiresAt: new Date(u.updatedAt + RETENTION).toISOString(), job: undefined };
    }
    return this.locked(id, async () => {
      const u = await this.load(id, ownerId);
      return this.view(u);
    });
  }
  async append(id: string, ownerId: number, offset: number, checksum: string, request: Request) {
    return this.locked(id, async () => {
      const u = await this.load(id, ownerId);
      if (u.state !== 'uploading' || offset !== u.offset) throw new ConflictException('Upload offset changed; request HEAD before retrying');
      const expected = Math.min(UPLOAD_CHUNK_SIZE, u.size - offset);
      if (expected <= 0) throw new ConflictException('All bytes have already been received');
      const match = /^(sha256|sha1) ([A-Za-z0-9+/]+={0,2})$/.exec(checksum ?? '');
      if (!match) throw new BadRequestException('Upload-Checksum is required');
      const length = request.headers['content-length'];
      if (length && Number(length) !== expected) throw new BadRequestException('Incorrect chunk length');
      const buffers: Buffer[] = []; let received = 0;
      for await (const bytes of request) {
        received += bytes.length;
        if (received > expected) throw new HttpException('Chunk too large', 413);
        buffers.push(Buffer.from(bytes));
      }
      if (received !== expected) throw new BadRequestException('Incomplete chunk');
      const chunk = Buffer.concat(buffers);
      const sha256 = createHash('sha256').update(chunk).digest('hex');
      if (sha256 !== u.chunks[offset / UPLOAD_CHUNK_SIZE]
        || createHash(match[1]).update(chunk).digest('base64') !== match[2]) throw new HttpException('Chunk checksum mismatch', 460);
      const file = await open(this.data(u), 'r+');
      try {
        // Discard any uncommitted bytes left by an interrupted write/restart.
        await file.truncate(offset);
        let written = 0;
        while (written < chunk.length) written += (await file.write(chunk, written, chunk.length - written, offset + written)).bytesWritten;
        await file.sync();
      } finally { await file.close(); }
      u.offset += received;
      await this.save(u);
      return u.offset;
    });
  }
  async complete(id: string, ownerId: number) {
    const start = await this.locked(id, async () => {
      const u = await this.load(id, ownerId);
      if (u.state !== 'uploading') return false;
      if (u.offset !== u.size) throw new ConflictException('Upload is incomplete');
      u.state = 'verifying'; await this.save(u);
      return true;
    });
    if (start) this.launch(id);
    return { accepted: true };
  }
  private launch(id: string) {
    if (this.locks.has(id)) return;
    void this.locked(id, async () => {
      const u = await this.load(id);
      if (u.state !== 'verifying' && u.state !== 'processing') return;
      try {
        const movie = await this.media.getMovieEntity(u.movieId);
        // Recover a crash between publishing a video and saving the upload state.
        if (movie.masterVideo === this.source(u) && movie.transcodeStatus === 'ready') { u.state = 'ready'; await this.save(u); return; }
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(this.data(u))) hash.update(bytes);
        if ((await stat(this.data(u))).size !== u.size || hash.digest('hex') !== u.sha256) {
          // Find the first damaged part and preserve the verified prefix.
          const file = await open(this.data(u), 'r');
          let repair = -1;
          try {
            for (let i = 0; i < u.chunks.length; i++) {
              const buffer = Buffer.alloc(Math.min(UPLOAD_CHUNK_SIZE, u.size - i * UPLOAD_CHUNK_SIZE));
              let read = 0;
              while (read < buffer.length) {
                const result = await file.read(buffer, read, buffer.length - read, i * UPLOAD_CHUNK_SIZE + read);
                if (!result.bytesRead) break;
                read += result.bytesRead;
              }
              if (read !== buffer.length || createHash('sha256').update(buffer).digest('hex') !== u.chunks[i]) { repair = i * UPLOAD_CHUNK_SIZE; break; }
            }
          } finally { await file.close(); }
          if (repair >= 0) {
            await truncate(this.data(u), repair); u.offset = repair; u.state = 'uploading';
            u.error = 'Integrity check failed; resume from the last verified part'; await this.save(u); return;
          }
          throw new Error('Full-file SHA-256 mismatch; start a new upload');
        }
        const meta = await this.transcode.probe(this.data(u));
        if (meta.height < 480) throw new Error('Master video must be at least 480 pixels high');
        await this.media.attachMasterVideo(u.movieId, this.source(u));
        u.state = 'processing'; delete u.error; await this.save(u);
      } catch (error) {
        u.state = 'failed'; u.error = error instanceof Error ? error.message : String(error);
        await this.save(u); this.logger.warn(`Upload ${id}: ${u.error}`);
      }
    }).catch(error => this.logger.error(String(error)));
  }
  async remove(id: string, ownerId: number) {
    return this.locked(id, async () => {
      const u = await this.load(id, ownerId);
      if (u.state === 'verifying' || u.state === 'processing') throw new ConflictException('Video processing has already started');
      // Converted sources belong to the movie even if its status later changes.
      const movie = await this.media.getMovieEntity(u.movieId).catch(() => null);
      if (movie?.masterVideo !== this.source(u)) await rm(this.data(u), { force: true });
      await rm(this.directory(id), { recursive: true, force: true });
    });
  }
}
