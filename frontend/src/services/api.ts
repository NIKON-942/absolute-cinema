import axios, { AxiosError } from 'axios';
import { API_BASE } from '@/utils/url';

export const TOKEN_KEY = 'ac_token';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

/** Attach the JWT to every request when present. */
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !config.headers.Authorization) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** On 401 (expired/invalid token): clear the session and send to /login. */
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const url = error.config?.url ?? '';
      // Login/forgot failures must not trigger a session wipe / redirect.
      const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/register');
      const stored = localStorage.getItem(TOKEN_KEY);
      const belongsToCurrentSession = stored && error.config?.headers?.Authorization === `Bearer ${stored}`;
      if (!isAuthAttempt && belongsToCurrentSession) {
        localStorage.removeItem(TOKEN_KEY);
        const loginPath = `/login?expired=1`;
        if (window.location.pathname !== '/login') {
          window.location.href = loginPath;
        }
      }
    }
    return Promise.reject(error);
  },
);

/** NestJS error shape: { statusCode, message: string | string[], error }. */
export function extractServerMessage(err: unknown, translate?: (key: string) => string): string | null {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { code?: string; message?: string | string[] } | undefined;
    // Match the legacy message too, so an updated UI works with older servers.
    if (translate && (data?.code === 'VIDEO_CONVERSION_IN_PROGRESS'
      || data?.message === 'This movie already has a video conversion in progress')) {
      return translate('admin.movies.conversionInProgress');
    }
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join('. ') : data.message;
    }
  }
  return null;
}

/** Status-key fallbacks; used with a `t` function by callers. */
export function errorStatusKey(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'errors.network';
    const status = err.response.status;
    if (status === 403) return 'errors.forbidden';
    if (status === 404) return 'errors.notFound';
    if (status >= 500) return 'errors.server';
    return 'errors.badRequest';
  }
  return 'errors.unknown';
}

export function isAxiosStatus(err: unknown, status: number): boolean {
  return axios.isAxiosError(err) && err.response?.status === status;
}
