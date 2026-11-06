import { BadRequestException } from '@nestjs/common';
import { imageReference } from './image-upload';

export const AGE_RATINGS = ['0+', '6+', '12+', '16+', '18+', '21+'];
const fail = (field: string, rule: string): never => { throw new BadRequestException(`${field}: ${rule}`); };

export function text(value: unknown, field: string, max = 255, required = false): string {
  if (typeof value !== 'string') return fail(field, 'must be text');
  const result = value.trim();
  if ((required && !result) || result.length > max) return fail(field, `must contain ${required ? 1 : 0}–${max} characters`);
  return result;
}

export function integer(value: unknown, field: string, min: number, max: number): number {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))) return fail(field, 'must be an integer');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) return fail(field, `must be an integer from ${min} to ${max}`);
  return result;
}

/** Accept JSON arrays and legacy comma-separated multipart lists, never partial numbers. */
export function idList(value: unknown, field: string): number[] {
  let list = value;
  if (typeof list === 'string') {
    if (!list.trim()) return [];
    if (list.trim().startsWith('[')) {
      try { list = JSON.parse(list); } catch { return fail(field, 'invalid JSON array'); }
    } else list = list.split(',').map(id => id.trim());
  }
  if (!Array.isArray(list) || list.length > 100) return fail(field, 'must be an array of at most 100 IDs');
  return [...new Set(list.map(id => integer(id, field, 1, 2147483647)))];
}

export function httpUrl(value: unknown, field: string): string {
  const result = text(value, field, 2048);
  if (!result) return '';
  try {
    const url = new URL(result);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return result;
  } catch { /* return the same field error for malformed URLs */ }
  return fail(field, 'must be an http(s) URL without credentials');
}

export interface MovieInput {
  title?: string; originalTitle?: string; description?: string; year?: number;
  countryId?: number | null; directorId?: number | null; country?: string; director?: string;
  ageRating?: string; runtimeMinutes?: number | null; trailerUrl?: string | null;
  keywords?: string[]; genreIds?: number[]; actorIds?: number[];
  posterUrl?: string | null; masterVideoUrl?: string;
}

/** One schema for create/update, JSON and multipart; unknown fields are errors. */
export function movieInput(body: Record<string, unknown>, creating: boolean): MovieInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('body', 'must be an object');
  const allowed = ['title','originalTitle','description','year','countryId','directorId','country','director','ageRating','runtimeMinutes','trailerUrl','keywords','genreIds','actorIds','posterUrl','masterVideoUrl'];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(key, 'unknown field');
  const result: MovieInput = {};
  if (creating || body.title !== undefined) result.title = text(body.title, 'title', 255, true);
  if (creating || body.year !== undefined) result.year = integer(body.year, 'year', 1890, 2100);
  for (const key of ['originalTitle','description','country','director'] as const) {
    if (body[key] !== undefined) result[key] = text(body[key], key, key === 'description' ? 20000 : 255);
  }
  for (const key of ['countryId','directorId'] as const) {
    if (body[key] !== undefined) result[key] = body[key] === '' || body[key] === null ? null : integer(body[key], key, 1, 2147483647);
  }
  for (const field of ['country','director'] as const) {
    if (body[field] !== undefined && body[`${field}Id`] !== undefined) fail(field, 'provide a name or an ID, not both');
  }
  if (body.ageRating !== undefined) {
    result.ageRating = text(body.ageRating, 'ageRating', 3);
    if (!AGE_RATINGS.includes(result.ageRating)) fail('ageRating', 'unsupported age classification');
  }
  if (body.runtimeMinutes !== undefined) result.runtimeMinutes = body.runtimeMinutes === '' || body.runtimeMinutes === null ? null : integer(body.runtimeMinutes, 'runtimeMinutes', 1, 600);
  if (body.trailerUrl !== undefined) result.trailerUrl = httpUrl(body.trailerUrl ?? '', 'trailerUrl') || null;
  if (body.masterVideoUrl !== undefined) result.masterVideoUrl = httpUrl(body.masterVideoUrl, 'masterVideoUrl');
  if (body.posterUrl !== undefined) {
    const url = text(body.posterUrl ?? '', 'posterUrl', 2048);
    result.posterUrl = imageReference(url) ?? null;
  }
  for (const key of ['genreIds','actorIds'] as const) if (body[key] !== undefined) result[key] = idList(body[key], key);
  if (body.keywords !== undefined) {
    const words = Array.isArray(body.keywords) ? body.keywords : text(body.keywords, 'keywords', 5000).split(',');
    if (words.length > 50) fail('keywords', 'at most 50 tags');
    result.keywords = [...new Set(words.map(word => text(word, 'keywords', 100)).filter(Boolean))];
  }
  return result;
}
