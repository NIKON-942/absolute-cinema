export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/** Deterministic poster fallback gradient class from a movie id/title. */
const POSTER_GRADIENTS = [
  'from-amber-500/40 via-cinema-card to-cinema-black',
  'from-red-600/40 via-cinema-card to-cinema-black',
  'from-indigo-500/40 via-cinema-card to-cinema-black',
  'from-emerald-500/30 via-cinema-card to-cinema-black',
  'from-orange-500/40 via-cinema-card to-cinema-black',
  'from-rose-500/30 via-cinema-card to-cinema-black',
];

export function posterGradient(seed: string | number): string {
  const s = String(seed);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return POSTER_GRADIENTS[hash % POSTER_GRADIENTS.length];
}
