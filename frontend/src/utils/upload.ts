export interface UploadSnapshot {
  startedAt: number;
  lastProgressAt: number;
  loaded: number;
  total: number | null;
  rate: number | null;
}

/** Monotonic-clock measurements; ETA covers transfer, not server acknowledgement. */
export function uploadMeasurements(snapshot: UploadSnapshot, now: number) {
  const elapsedSeconds = Math.max(0, (now - snapshot.startedAt) / 1000);
  const transferred = snapshot.total !== null && snapshot.loaded >= snapshot.total;
  const stalled = !transferred && now - snapshot.lastProgressAt >= 5000;
  const averageRate = elapsedSeconds >= 1 ? snapshot.loaded / elapsedSeconds : 0;
  const candidate = snapshot.rate ?? averageRate;
  const bytesPerSecond = stalled ? 0 : Number.isFinite(candidate) && candidate > 0 ? candidate : null;
  const remaining = snapshot.total !== null ? Math.max(0, snapshot.total - snapshot.loaded) : null;
  const remainingSeconds = !transferred && elapsedSeconds >= 1 && bytesPerSecond && remaining !== null
    ? Math.max(1, Math.ceil(remaining / bytesPerSecond)) : null;
  return { elapsedSeconds, bytesPerSecond, remainingSeconds, transferred, stalled };
}

export function formatBytes(bytes: number, locale = 'en'): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = value > 0 ? Math.min(units.length - 1, Math.floor(Math.log10(value) / 3)) : 0;
  const unitIndex = Math.max(0, index);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unitIndex ? 1 : 0 }).format(value / 1000 ** unitIndex)} ${units[unitIndex]}`;
}
