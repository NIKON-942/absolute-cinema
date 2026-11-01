import { join } from 'path';

export const STORAGE_ROOT = join(process.cwd(), 'storage');
export const MASTERS_DIR = join(STORAGE_ROOT, 'masters');
export const VIDEOS_DIR = join(STORAGE_ROOT, 'videos');
export const POSTERS_DIR = join(STORAGE_ROOT, 'posters');

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
