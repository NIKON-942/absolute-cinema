import { isAxiosError } from 'axios';
import { CHUNK_SIZE, hashVideo, videoUploads } from './videoUploads';
import type { UploadManifest, UploadSession } from './videoUploads';
import type { MovieDto, TranscodeJobDto } from '@/types';
import { extractServerMessage } from './api';

export type UploadPhase = 'hashing' | 'uploading' | 'retrying' | 'paused' | 'needsFile' | 'verifying' | 'processing' | 'ready' | 'failed';
export interface UploadTask {
  key: string; uploadId?: string; movieId: number; title: string; filename: string;
  size: number; offset: number; loaded: number; phase: UploadPhase; hashProgress: number;
  rate: number | null; elapsedMs: number; transferStartedAt?: number; lastProgressAt?: number; error?: string;
  issue?: 'wrongFile' | 'network' | 'integrity' | 'unavailable'; job?: TranscodeJobDto;
}
interface Runtime {
  file?: File; manifest?: UploadManifest; controller?: AbortController; running: boolean;
  repairs: number; generation: number;
}
const pauseError = () => new DOMException('Paused', 'AbortError');
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(pauseError()); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
});

/** Lives above the router. Neither closing a modal nor unmounting an admin
 * page owns the lifetime of an upload. Server sessions survive reloads.
 */
export class UploadManager {
  private tasks: UploadTask[] = [];
  private runtime = new Map<string, Runtime>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private owner: number | null = null;
  private initialized = false;
  private dismissed = new Set<string>();
  private polling = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.tasks;
  private publish() { for (const listener of this.listeners) listener(); }
  private update(key: string, patch: Partial<UploadTask>) {
    this.tasks = this.tasks.map(t => t.key === key ? { ...t, ...patch } : t); this.publish();
  }
  private task(key: string) { return this.tasks.find(t => t.key === key); }
  private finishTime(key: string) {
    const t = this.task(key);
    if (t?.transferStartedAt) this.update(key, { elapsedMs: t.elapsedMs + Date.now() - t.transferStartedAt, transferStartedAt: undefined, rate: null });
  }
  async connect(owner: number | null, signal: AbortSignal) {
    if (!this.initialized || this.owner !== owner) {
      this.initialized = true; this.generation++;
      for (const runtime of this.runtime.values()) runtime.controller?.abort();
      this.runtime.clear(); this.tasks = []; this.owner = owner; this.publish();
    }
    const generation = this.generation;
    if (!owner) return;
    try { this.dismissed = new Set(JSON.parse(localStorage.getItem(`ac_uploads_dismissed_${owner}`) ?? '[]')); } catch { this.dismissed = new Set(); }
    const sessions = await videoUploads.list(signal);
    if (generation !== this.generation || signal.aborted) return;
    for (const session of sessions) {
      if (this.dismissed.has(session.id) || this.tasks.some(t => t.uploadId === session.id)) continue;
      const key = session.id;
      this.runtime.set(key, { running: false, repairs: 0, generation });
      this.tasks = [...this.tasks, { key, uploadId: session.id, movieId: session.movieId, title: session.movieTitle ?? session.filename,
        filename: session.filename, size: session.size, offset: session.offset, loaded: session.offset,
        phase: session.state === 'uploading' ? 'needsFile' : session.state,
        hashProgress: 0, rate: null, elapsedMs: 0, job: session.job, error: session.error }];
    }
    this.publish();
  }
  start(movie: MovieDto, file: File) {
    if (!this.owner) throw new Error('An administrator session is required');
    if (file.size <= 0 || file.size > 8 * 1024 ** 3) throw new Error('Video must be between 1 byte and 8 GiB');
    const active = this.tasks.find(t => t.movieId === movie.id && !['ready', 'failed'].includes(t.phase));
    if (active) throw new Error('An unfinished upload already exists for this movie');
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.tasks = [...this.tasks, { key, movieId: movie.id, title: movie.title, filename: file.name, size: file.size,
      offset: 0, loaded: 0, phase: 'hashing', hashProgress: 0, rate: null, elapsedMs: 0 }];
    this.runtime.set(key, { file, running: false, repairs: 0, generation: this.generation });
    this.publish(); void this.run(key);
  }
  pause(key: string) {
    this.runtime.get(key)?.controller?.abort();
  }
  resume(key: string, file?: File) {
    const runtime = this.runtime.get(key);
    if (!runtime || runtime.running) return;
    if (file) { runtime.file = file; runtime.manifest = undefined; }
    if (!runtime.file) { this.update(key, { phase: 'needsFile' }); return; }
    void this.run(key);
  }
  hasFile(key: string) { return Boolean(this.runtime.get(key)?.file); }
  async cancel(key: string) {
    const runtime = this.runtime.get(key);
    if (runtime?.running) {
      runtime.controller?.abort();
      // Wait until any in-flight request has been reconciled or aborted locally.
      while (runtime.running) await new Promise(resolve => setTimeout(resolve, 30));
    }
    const task = this.task(key);
    if (task && !task.uploadId && runtime?.manifest) {
      // Creation might have succeeded just before its response was lost.
      const sessions = await videoUploads.list(new AbortController().signal);
      const created = sessions.find(session => session.movieId === task.movieId && session.sha256 === runtime.manifest?.sha256 && session.state === 'uploading');
      if (created) { await videoUploads.remove(created.id); }
    }
    if (task?.uploadId) {
      try { await videoUploads.remove(task.uploadId); }
      catch (error) {
        if (isAxiosError(error) && [404, 410].includes(error.response?.status ?? 0)) { this.dismiss(key); return; }
        // The last part/finalize can win a race against cancellation.
        if (isAxiosError(error) && error.response?.status === 409) {
          try { this.apply(key, await videoUploads.status(task.uploadId)); } catch { /* Preserve the task for retry. */ }
        }
        throw error;
      }
    }
    this.dismiss(key);
  }
  dismiss(key: string) {
    const task = this.task(key);
    if (task?.uploadId) {
      this.dismissed.add(task.uploadId);
      try { localStorage.setItem(`ac_uploads_dismissed_${this.owner}`, JSON.stringify([...this.dismissed].slice(-200))); } catch { /* Optional UI preference. */ }
    }
    this.runtime.delete(key); this.tasks = this.tasks.filter(t => t.key !== key); this.publish();
  }
  private async run(key: string) {
    const runtime = this.runtime.get(key); const initial = this.task(key);
    if (!runtime?.file || runtime.running || !initial) return;
    runtime.running = true; runtime.controller = new AbortController();
    const { signal } = runtime.controller;
    const valid = () => !signal.aborted && runtime.generation === this.generation;
    const check = () => { if (!valid()) throw pauseError(); };
    try {
      this.update(key, { error: undefined, issue: undefined, phase: runtime.manifest ? 'uploading' : 'hashing' });
      if (!runtime.manifest) runtime.manifest = await hashVideo(runtime.file, signal, hashProgress => this.update(key, { hashProgress }));
      check();
      let session: UploadSession;
      const uploadId = this.task(key)?.uploadId;
      if (uploadId) {
        session = await videoUploads.status(uploadId, signal);
        if (session.sha256 !== runtime.manifest.sha256 || session.size !== runtime.file.size) {
          runtime.file = undefined; runtime.manifest = undefined;
          this.update(key, { phase: 'needsFile', issue: 'wrongFile' }); return;
        }
      } else {
        session = await videoUploads.create(initial.movieId, runtime.manifest, signal);
        this.update(key, { uploadId: session.id });
      }
      check();
      if (session.chunkSize !== CHUNK_SIZE) throw new Error('Unsupported upload chunk size');
      if (session.state !== 'uploading') { this.apply(key, session); return; }
      let offset = session.offset;
      let failures = 0;
      const baseline = offset; const started = Date.now();
      this.update(key, { phase: 'uploading', offset, loaded: offset, transferStartedAt: started, lastProgressAt: started, rate: null });
      while (offset < initial.size) {
        check();
        try {
          const end = Math.min(offset + CHUNK_SIZE, initial.size);
          const chunkOffset = offset;
          const next = await videoUploads.append(session.id, offset, runtime.file.slice(offset, end), runtime.manifest.chunks[offset / CHUNK_SIZE], signal, loaded => {
            if (!valid()) return;
            const elapsed = (Date.now() - started) / 1000;
            this.update(key, { loaded: chunkOffset + loaded, lastProgressAt: Date.now(), rate: elapsed >= 1 ? (chunkOffset + loaded - baseline) / elapsed : null });
          });
          if (next !== end) throw new Error('Server returned an unexpected upload offset');
          offset = next; failures = 0;
          this.update(key, { phase: 'uploading', offset, loaded: offset });
        } catch (error) {
          check();
          const status = isAxiosError(error) ? error.response?.status : undefined;
          if (status && status < 500 && ![408, 409, 429, 460].includes(status)) throw error;
          if (++failures > 4) throw error;
          this.update(key, { phase: 'retrying', rate: null });
          await wait(Math.min(1000 * 2 ** (failures - 1), 8000), signal);
          try {
            // A lost response may still mean the server committed the part.
            offset = await videoUploads.offset(session.id, signal);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > initial.size || (offset !== initial.size && offset % CHUNK_SIZE !== 0)) throw new Error('Invalid upload offset');
            this.update(key, { offset, loaded: offset, phase: 'uploading' });
          } catch (headError) { check(); if (failures >= 4) throw headError; }
        }
      }
      this.finishTime(key);
      // Idempotent finalization: a lost response must not enqueue conversion twice.
      for (let attempt = 0; ; attempt++) {
        try { await videoUploads.complete(session.id, signal); break; }
        catch (error) { check(); if (attempt >= 3 || (isAxiosError(error) && error.response && error.response.status < 500 && error.response.status !== 409)) throw error; await wait(1000 * 2 ** attempt, signal); }
      }
      check(); this.update(key, { phase: 'verifying', loaded: initial.size, rate: null });
    } catch (error) {
      if (runtime.generation !== this.generation) return;
      this.finishTime(key);
      if (!signal.aborted && isAxiosError(error) && [404, 410].includes(error.response?.status ?? 0)) {
        this.update(key, { phase: 'failed', issue: 'unavailable', error: undefined }); return;
      }
      this.update(key, { phase: runtime.file ? 'paused' : 'needsFile', loaded: this.task(key)?.offset ?? 0,
        issue: signal.aborted ? undefined : isAxiosError(error) && !error.response ? 'network' : undefined,
        error: signal.aborted ? undefined : extractServerMessage(error) ?? (error instanceof Error ? error.message : 'Upload failed') });
    } finally { runtime.running = false; runtime.controller = undefined; }
  }
  private apply(key: string, session: UploadSession) {
    this.update(key, { offset: session.offset, loaded: session.offset, phase: session.state === 'uploading' ? 'needsFile' : session.state,
      job: session.job, error: session.error, rate: null });
  }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    const generation = this.generation;
    try {
      await Promise.all(this.tasks.filter(t => t.uploadId && ['verifying', 'processing'].includes(t.phase)).map(async task => {
        try {
          const session = await videoUploads.status(task.uploadId!);
          if (generation !== this.generation || !this.task(task.key)) return;
          if (session.state === 'uploading') {
            const runtime = this.runtime.get(task.key);
            this.update(task.key, { offset: session.offset, loaded: session.offset, phase: runtime?.file ? 'paused' : 'needsFile', issue: 'integrity', error: undefined });
            if (runtime?.file && ++runtime.repairs <= 3) this.resume(task.key);
          } else {
            this.apply(task.key, session);
            if (session.state === 'ready' || session.state === 'failed') {
              const runtime = this.runtime.get(task.key);
              if (runtime) { runtime.file = undefined; runtime.manifest = undefined; }
            }
          }
        } catch (error) {
          if (generation === this.generation && isAxiosError(error) && error.response?.status === 404) {
            this.update(task.key, { phase: 'failed', issue: 'unavailable' });
          }
          // Temporary polling/network failures never discard a server job.
        }
      }));
    } finally { this.polling = false; }
  }
}
