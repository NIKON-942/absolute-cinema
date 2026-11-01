import { api } from './api';
import type { TranscodeJobDto } from '@/types';

export const CHUNK_SIZE = 16 * 1024 * 1024;
export interface UploadManifest { filename: string; size: number; sha256: string; chunks: string[] }
export interface UploadSession {
  id: string; movieId: number; movieTitle: string; filename: string; size: number; sha256: string;
  offset: number; state: 'uploading' | 'verifying' | 'processing' | 'ready' | 'failed';
  chunkSize: number; expiresAt: string; error?: string; job?: TranscodeJobDto;
}
const tus = { 'Tus-Resumable': '1.0.0' };
const base64Hash = (hex: string) => btoa(String.fromCharCode(...hex.match(/../g)!.map(byte => parseInt(byte, 16))));
export const videoUploads = {
  list: (signal: AbortSignal) => api.get<UploadSession[]>('/media/uploads', { signal }).then(r => r.data),
  status: (id: string, signal?: AbortSignal) => api.get<UploadSession>(`/media/uploads/${id}`, { signal }).then(r => r.data),
  create: (movieId: number, manifest: UploadManifest, signal: AbortSignal) => api.post<UploadSession>(`/media/uploads/${movieId}`, manifest, { headers: tus, signal }).then(r => r.data),
  offset: (id: string, signal: AbortSignal) => api.head(`/media/uploads/${id}`, { headers: tus, signal }).then(r => Number(r.headers['upload-offset'])),
  append: (id: string, offset: number, bytes: Blob, hash: string, signal: AbortSignal, progress: (loaded: number) => void) =>
    api.patch(`/media/uploads/${id}`, bytes, { signal, timeout: 16 * 60 * 1000,
      headers: { ...tus, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset), 'Upload-Checksum': `sha256 ${base64Hash(hash)}` },
      onUploadProgress: event => progress(event.loaded),
    }).then(r => Number(r.headers['upload-offset'])),
  complete: (id: string, signal: AbortSignal) => api.post(`/media/uploads/${id}/complete`, {}, { signal }),
  remove: (id: string) => api.delete(`/media/uploads/${id}`, { headers: tus }),
};

export function hashVideo(file: File, signal: AbortSignal, progress: (percent: number) => void): Promise<UploadManifest> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/video-hash.worker.ts', import.meta.url), { type: 'module' });
    const clean = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); reject(new DOMException('Paused', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onerror = () => { clean(); reject(new Error('Cannot prepare video checksums')); };
    worker.onmessage = ({ data }) => {
      if (data.error) { clean(); reject(new Error(data.error)); }
      else if (data.manifest) { clean(); resolve(data.manifest); }
      else progress(data.progress);
    };
    worker.postMessage({ file, chunkSize: CHUNK_SIZE });
  });
}
