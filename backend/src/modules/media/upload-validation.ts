import { BadRequestException } from '@nestjs/common';
import { open, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { MediaProbe } from './media-processing';

export const POSTER_MAX_BYTES = 5 * 1024 * 1024;
export const POSTER_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** MIME headers are untrusted; inspect stored bytes before publishing a poster. */
export async function validatePoster(file?: Express.Multer.File): Promise<void> {
  if (!file) return;
  const handle = await open(file.path, 'r');
  let valid = false;
  try {
    const bytes = Buffer.alloc(12); const { bytesRead } = await handle.read(bytes, 0, 12, 0);
    const ext = extname(file.originalname).toLowerCase();
    valid = file.size <= POSTER_MAX_BYTES && (
      (['.jpg', '.jpeg'].includes(ext) && bytesRead >= 3 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
      || (ext === '.png' && bytesRead >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      || (ext === '.webp' && bytesRead >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'));
  } finally { await handle.close(); }
  if (!valid) { await rm(file.path, { force: true }); throw new BadRequestException('Poster must be a JPG, PNG or WebP image up to 5 MiB'); }
}

export function validateUploadedVideo(meta: MediaProbe, filename: string): void {
  const ext = extname(filename).toLowerCase();
  const formats = meta.format?.split(',') ?? [];
  const mp4 = ext === '.mp4' && formats.includes('mp4') && ['h264', 'hevc'].includes(meta.codec ?? '') && (!meta.audio || meta.audio.codec === 'aac');
  const webm = ext === '.webm' && formats.includes('webm') && ['vp8', 'vp9', 'av1'].includes(meta.codec ?? '') && (!meta.audio || ['opus', 'vorbis'].includes(meta.audio.codec));
  if (!mp4 && !webm) throw new BadRequestException('Upload MP4 (H.264/H.265 with AAC) or WebM video');
}
