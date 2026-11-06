import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { POSTERS_DIR } from './media.constants';
import { POSTER_MAX_BYTES, POSTER_TYPES, validatePoster } from './upload-validation';

// Small image uploads stay in memory until guards and DTO validation finish.
export const imageUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: POSTER_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const type = POSTER_TYPES[extname(file.originalname).toLowerCase()];
    if (type && type === file.mimetype) callback(null, true);
    else callback(new BadRequestException('Only JPG, PNG and WebP images are allowed'), false);
  },
};

/** Store beside existing public posters, on the persistent media volume. */
export async function storeImage(file: Express.Multer.File | undefined, kind: 'avatar' | 'actor' | 'poster'): Promise<string | undefined> {
  if (!file) return undefined;
  await validatePoster(file);
  await mkdir(POSTERS_DIR, { recursive: true });
  file.filename = `${kind}-${randomUUID()}${extname(file.originalname).toLowerCase()}`;
  file.path = join(POSTERS_DIR, file.filename);
  try { await writeFile(file.path, file.buffer, { flag: 'wx' }); }
  catch (error) { await rm(file.path, { force: true }); throw error; }
  return `/api/media/posters/${file.filename}`;
}

export async function discardImage(file?: Express.Multer.File): Promise<void> {
  if (file?.path) await rm(file.path, { force: true });
}

export function imageReference(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\/api\/media\/posters\/[a-z0-9-]+\.(jpe?g|png|webp)$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (['http:', 'https:'].includes(url.protocol)) return trimmed;
  } catch { /* return a validation error below */ }
  throw new BadRequestException('Image URL must use http or https');
}
