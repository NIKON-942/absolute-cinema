import { api } from '@/services/api';

/**
 * <video src> and sendBeacon cannot send an Authorization header, so they carry a
 * short-lived, stream-scoped token in the URL instead of the full session JWT.
 * The backend accepts it only on the playback routes (/media/:id/stream, /devices/end).
 */
interface Cached {
  sessionToken: string;
  token: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 10 * 60 * 1000;
let cached: Cached | null = null;
let inflight: Promise<string | null> | null = null;

function sessionToken(): string | null {
  try {
    return localStorage.getItem('ac_token');
  } catch {
    return null;
  }
}

/** Cached token if it is still valid for the current session, without any request. */
export function peekStreamToken(): string | null {
  const session = sessionToken();
  if (!cached || !session || cached.sessionToken !== session || cached.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
    return null;
  }
  return cached.token;
}

export function clearStreamToken(): void {
  cached = null;
}

/** Returns a valid stream token, fetching a new one when missing or about to expire. */
export function ensureStreamToken(): Promise<string | null> {
  const existing = peekStreamToken();
  if (existing) return Promise.resolve(existing);
  const session = sessionToken();
  if (!session) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = api
    .post<{ token: string; expiresIn: number }>('/auth/stream-token')
    .then((r) => {
      cached = { sessionToken: session, token: r.data.token, expiresAt: Date.now() + r.data.expiresIn * 1000 };
      return r.data.token;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
