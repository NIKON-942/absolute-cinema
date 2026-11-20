/** Escapes text for use in HTML element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[char] as string
  ));
}

/** Returns the URL when it is plain http(s), otherwise an inert placeholder. */
export function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch { /* fall through */ }
  return '#';
}
