import type { Quality } from '@/types';
import { getDeviceId } from './plans';

/** Base API URL. Defaults to the Vite dev proxy path (/api -> http://localhost:4000). */
export const API_BASE: string = import.meta.env.VITE_API_URL || '/api';

/**
 * When VITE_API_URL points directly at the backend (e.g. http://localhost:4000/api),
 * backend-relative media paths ("/api/media/posters/x.jpg") must be prefixed with the
 * server origin. With the proxy mode the empty origin is correct.
 */
const SERVER_ORIGIN = API_BASE.endsWith('/api') ? API_BASE.slice(0, -'/api'.length) : '';

/** Resolve a backend-relative path (posters, actor photos) to a fetchable URL. */
export function resolveMediaUrl(url?: string | null): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (url.startsWith('/api/')) return `${SERVER_ORIGIN}${url}`;
  return url;
}

/** Stream URL for the <video> element. Token + deviceId are appended so
 *  JWT-guarded streams work with native src and the concurrent-device
 *  limit is enforced on every range request. */
export function streamUrl(movieId: number, quality: Quality): string {
  const token = localStorage.getItem('ac_token');
  const q = `quality=${encodeURIComponent(quality)}`;
  const d = `&deviceId=${encodeURIComponent(getDeviceId())}`;
  const t = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${API_BASE}/media/${movieId}/stream?${q}${d}${t}`;
}

/** Full URL of the Google OAuth entry point (backend redirects to Google). */
export function googleAuthUrl(): string {
  return `${API_BASE}/auth/google`;
}
