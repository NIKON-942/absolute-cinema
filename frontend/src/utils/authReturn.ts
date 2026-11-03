/** Only internal destinations may survive an external authentication round trip. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value) || value.length > 2048) return '/';
  try { const url = new URL(value, 'https://app.invalid'); return url.origin === 'https://app.invalid' && !url.pathname.startsWith('/auth/') && !['/login','/register'].includes(url.pathname) ? url.pathname + url.search + url.hash : '/'; } catch { return '/'; }
}
