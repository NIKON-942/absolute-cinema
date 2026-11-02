import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaService } from '@/services/mediaService';
import { useDebounce } from '@/hooks/useDebounce';

const SAVE_INTERVAL_MS = 10_000; // persist at most every ~10s while playing
const DEBOUNCE_MS = 1_500; // coalesce rapid timeupdate bursts into one request

/**
 * Persists watch progress for a movie: PUT /media/:id/progress at most every
 * ~10s while playing (debounced), immediately on flush() (pause/unmount), and
 * exposes the last saved position so the player can resume.
 */
export function useVideoProgress(movieId: number, enabled: boolean) {
  const [resumeAt, setResumeAt] = useState(0);
  const [checkpoint, setCheckpoint] = useState<{ movieId: number; position: number; duration: number }>({
    movieId,
    position: 0,
    duration: 0,
  });
  const debouncedCheckpoint = useDebounce(checkpoint, DEBOUNCE_MS);
  const lastSavedAt = useRef(0);
  const pending = useRef({ movieId, position: 0, duration: 0 });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Fetch the saved position once so playback can resume.
  useEffect(() => {
    setResumeAt(0);
    if (!enabled) return;
    let cancelled = false;
    mediaService
      .progress()
      .then((list) => {
        if (cancelled) return;
        const found = list.find((p) => p.movieId === movieId);
        if (found && found.durationSeconds > 0 && found.positionSeconds < found.durationSeconds - 15) {
          setResumeAt(found.positionSeconds);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [movieId, enabled]);

  const save = useCallback(
    async (position: number, duration: number) => {
      if (!enabledRef.current || duration <= 0 || position <= 0) return;
      try {
        await mediaService.saveProgress(movieId, Math.floor(position), Math.floor(duration));
        lastSavedAt.current = Date.now();
      } catch {
        /* progress saving is best-effort */
      }
    },
    [movieId],
  );

  // Debounced persistence of periodic checkpoints.
  useEffect(() => {
    if (debouncedCheckpoint.movieId === movieId && debouncedCheckpoint.duration > 0) {
      void save(debouncedCheckpoint.position, debouncedCheckpoint.duration);
    }
  }, [debouncedCheckpoint, save, movieId]);

  // Flush whatever is pending when leaving the page.
  useEffect(() => {
    return () => {
      const p = pending.current;
      if (enabledRef.current && p.movieId === movieId && p.duration > 0) {
        void mediaService.saveProgress(movieId, Math.floor(p.position), Math.floor(p.duration));
      }
    };
  }, [movieId]);

  /** Called from the player on every timeupdate. */
  const report = useCallback((position: number, duration: number) => {
    pending.current = { movieId, position, duration };
    if (Date.now() - lastSavedAt.current >= SAVE_INTERVAL_MS) {
      setCheckpoint({ movieId, position, duration });
      lastSavedAt.current = Date.now(); // don't queue another checkpoint before this one lands
    }
  }, [movieId]);

  /** Immediate save (used on pause / before quality switch). */
  const flush = useCallback(() => {
    const p = pending.current;
    if (p.movieId === movieId && p.duration > 0) void save(p.position, p.duration);
  }, [save, movieId]);

  return { resumeAt, report, flush };
}
