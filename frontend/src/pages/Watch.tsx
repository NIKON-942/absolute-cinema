import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { mediaService } from '@/services/mediaService';
import { devicesService } from '@/services/devicesService';
import { useVideoProgress } from '@/hooks/useVideoProgress';
import { VideoPlayer } from '@/components/VideoPlayer';
import { LoadingBlock, Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { errorStatusKey } from '@/services/api';
import { streamUrl } from '@/utils/url';
import { formatDuration } from '@/utils/format';
import { getDeviceId, limitsForTier, qualityRank } from '@/utils/plans';
import type { MovieDto, Quality } from '@/types';

/**
 * Watch page: fetches the movie, renders the player, resumes from saved
 * progress and shows a subscribe upsell when streaming is not allowed
 * (no active subscription up front, or 403 from the stream endpoint).
 * Plan limits are enforced here too: qualities above the plan cap are
 * locked behind an upgrade prompt, and playback stops with a device-limit
 * panel when the plan's concurrent-stream limit is reached.
 */
export default function Watch() {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const { info } = useToast();

  const [movie, setMovie] = useState<MovieDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [streamForbidden, setStreamForbidden] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [deviceLimit, setDeviceLimit] = useState(false);
  /** Locked quality the user clicked — drives the upgrade prompt. */
  const [upgradeQuality, setUpgradeQuality] = useState<Quality | null>(null);

  const { maxQuality } = limitsForTier(user?.activeSubscription?.tier);
  const qualities = movie?.availableQualities ?? [];
  const allowedQualities = useMemo(
    () =>
      // Sort along the quality ladder — the movie's own order is arbitrary
      // (e.g. ['720p','480p']) so the last element isn't the best one.
      qualities
        .filter((q) => qualityRank(q) <= qualityRank(maxQuality))
        .sort((a, b) => qualityRank(a) - qualityRank(b)),
    [qualities, maxQuality],
  );
  const [quality, setQuality] = useState<Quality>('720p');

  useEffect(() => {
    if (allowedQualities.length > 0 && !allowedQualities.includes(quality)) {
      setQuality(allowedQualities[allowedQualities.length - 1]); // best plan-allowed by default
    }
  }, [allowedQualities, quality]);

  const { resumeAt, report, flush } = useVideoProgress(movieId, isAuthenticated);
  const resumeToastShown = useRef(false);
  useEffect(() => {
    if (resumeAt > 0 && !resumeToastShown.current) {
      resumeToastShown.current = true;
      info(t('watch.resumed', { time: formatDuration(resumeAt) }));
    }
  }, [resumeAt, t, info]);

  // fetch movie metadata
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setStreamForbidden(false);
    setStreamError(false);
    setDeviceLimit(false);
    mediaService
      .getById(movieId)
      .then((m) => !cancelled && setMovie(m))
      .catch((err) => {
        if (cancelled) return;
        if (errorStatusKey(err) === 'errors.notFound') setNotFound(true);
        else setStreamError(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  /**
   * Keep the page fresh while renditions are transcoding: qualities appear
   * one by one (480p first) and become switchable without a reload. A slower
   * background poll continues afterwards so a master re-upload (renditions
   * unlinked again) is also picked up on an already-open page.
   */
  useEffect(() => {
    const processing = movie?.transcodeStatus === 'processing';
    const timer = window.setInterval(
      () => {
        mediaService
          .getById(movieId)
          .then((m) => setMovie(m))
          .catch(() => undefined);
      },
      processing ? 3000 : 15000,
    );
    return () => window.clearInterval(timer);
  }, [movie?.transcodeStatus, movieId]);

  // ---- concurrent-device enforcement (plan maxDevices) ----
  const deviceId = getDeviceId();
  const heartbeatTimer = useRef<number | null>(null);
  const deviceLimitHit = useRef(false);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current != null) {
      window.clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    devicesService.end(deviceId);
  }, [deviceId]);

  /** While playing: register this device every minute; the stream endpoint
   *  enforces the limit on every range request as well. 409 → limit panel. */
  const onPlayStateChange = useCallback(
    (playing: boolean) => {
      if (playing) {
        if (deviceLimitHit.current || heartbeatTimer.current != null) return;
        const beat = () =>
          devicesService.heartbeat(deviceId).catch((err) => {
            if (err?.response?.status === 409) {
              deviceLimitHit.current = true;
              setDeviceLimit(true);
            }
          });
        beat();
        heartbeatTimer.current = window.setInterval(beat, 60_000);
      } else {
        stopHeartbeat();
      }
    },
    [deviceId, stopHeartbeat],
  );

  // free the device slot when playback is cut off (panel replaces the player)
  useEffect(() => {
    if (deviceLimit) stopHeartbeat();
  }, [deviceLimit, stopHeartbeat]);

  // leaving the page or closing the tab releases the device immediately
  useEffect(() => stopHeartbeat, [stopHeartbeat]);
  useEffect(() => {
    const onUnload = () => devicesService.end(deviceId);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [deviceId]);

  /** When <video> fails, probe the stream URL to tell 403 (subscription),
   *  402 (quality above the plan cap) and 409 DEVICE_LIMIT apart from
   *  transient errors. */
  const probeStream = async () => {
    try {
      const res = await fetch(streamUrl(movieId, quality), { method: 'GET', headers: { Range: 'bytes=0-1' } });
      if (res.status === 401 || res.status === 403) {
        setStreamForbidden(true);
      } else if (res.status === 402) {
        const body = (await res.json().catch(() => null)) as { requestedQuality?: Quality } | null;
        setUpgradeQuality(body?.requestedQuality ?? quality);
      } else if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'DEVICE_LIMIT') {
          deviceLimitHit.current = true;
          setDeviceLimit(true);
        } else {
          // Renditions were unlinked (master re-upload) — refresh state; the
          // quality effect / processing view recovers playback automatically.
          mediaService.getById(movieId).then((m) => setMovie(m)).catch(() => undefined);
        }
      } else {
        setStreamError(true);
      }
    } catch {
      setStreamError(true);
    }
  };

  const transcoding = movie?.transcodeStatus === 'processing';
  const noVideo = useMemo(() => !loading && !notFound && qualities.length === 0, [loading, notFound, qualities]);
  const needsSubscription = !loading && !notFound && !noVideo && (!user?.hasActiveSubscription || streamForbidden);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <LoadingBlock />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState
          icon="🎞️"
          title={t('movie.notFound')}
          action={<Link to="/catalog" className="rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink">{t('common.backToCatalog')}</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/movie/${movieId}`} className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-cinema-muted transition hover:text-cinema-accent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M19 12H5m7-7-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t('watch.backToMovie')}
          </Link>
          <h1 className="truncate text-2xl font-extrabold text-cinema-strong sm:text-3xl">{movie?.title}</h1>
          {movie && (
            <p className="mt-0.5 text-sm text-cinema-muted">
              {[movie.year, movie.country, movie.ageRating].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* player / states */}
      {noVideo ? (
        transcoding ? (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-5 rounded-2xl border border-cinema-amber/30 bg-cinema-panel/40 px-6 text-center">
            <Spinner size={10} />
            <div>
              <h2 className="mb-1.5 text-lg font-bold text-cinema-text">{t('watch.processingTitle')}</h2>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-cinema-muted">{t('watch.processingText')}</p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon="🎬"
            title={t('watch.noQualitiesTitle')}
            subtitle={t('watch.noQualitiesText')}
            action={<Link to="/catalog" className="rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink">{t('common.backToCatalog')}</Link>}
          />
        )
      ) : needsSubscription ? (
        <div className="relative overflow-hidden rounded-2xl border border-cinema-amber/40 bg-gradient-to-b from-cinema-panel to-cinema-black p-8 text-center sm:p-14">
          <div className="pointer-events-none absolute inset-0 opacity-30 blur-3xl">
            <div className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-cinema-amber/40" />
          </div>
          <div className="relative mx-auto max-w-md">
            <span className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-cinema-amber/50 bg-cinema-amber/10 text-3xl">🔒</span>
            <h2 className="mb-2 text-2xl font-extrabold text-cinema-strong">{t('watch.upsellTitle')}</h2>
            <p className="mb-6 text-sm leading-relaxed text-cinema-muted">{t('watch.upsellText')}</p>
            <Link
              to="/plans"
              className="inline-flex items-center gap-2 rounded-xl bg-cinema-amber px-7 py-3 font-bold text-cinema-ink transition hover:shadow-glow"
            >
              {t('watch.seePlans')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M5 12h14m-7-7 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
      ) : deviceLimit ? (
        <div className="relative overflow-hidden rounded-2xl border border-cinema-red/40 bg-gradient-to-b from-cinema-panel to-cinema-black p-8 text-center sm:p-14">
          <div className="relative mx-auto max-w-md">
            <span className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-cinema-red/50 bg-cinema-red/10 text-3xl">📺</span>
            <h2 className="mb-2 text-2xl font-extrabold text-cinema-strong">{t('watch.deviceLimitTitle')}</h2>
            <p className="mb-6 text-sm leading-relaxed text-cinema-muted">
              {t('watch.deviceLimitText', { maxDevices: limitsForTier(user?.activeSubscription?.tier).maxDevices })}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {/* Clears the latch so playback resumes as soon as a slot is
                  free again — no full page reload needed. */}
              <button
                type="button"
                onClick={() => {
                  deviceLimitHit.current = false;
                  setDeviceLimit(false);
                }}
                className="cursor-pointer rounded-xl border border-cinema-border bg-cinema-card px-6 py-3 text-sm font-semibold text-cinema-text transition hover:border-cinema-amber/60 hover:text-cinema-accent"
              >
                {t('common.retry')}
              </button>
              <Link
                to="/profile"
                className="rounded-xl border border-cinema-border bg-cinema-card px-6 py-3 text-sm font-semibold text-cinema-text transition hover:border-cinema-amber/60 hover:text-cinema-accent"
              >
                {t('watch.manageDevices')}
              </Link>
              <Link
                to="/plans"
                className="rounded-xl bg-cinema-amber px-6 py-3 text-sm font-bold text-cinema-ink transition hover:shadow-glow"
              >
                {t('watch.upgradeCta')}
              </Link>
            </div>
          </div>
        </div>
      ) : streamError ? (
        <div className="rounded-2xl border border-cinema-red/50 bg-cinema-red/10 p-8 text-center">
          <span className="mb-3 block text-4xl">⚠️</span>
          <h2 className="mb-1 text-lg font-bold text-cinema-error">{t('watch.streamError')}</h2>
          <p className="mb-4 text-sm text-cinema-error">{t('watch.streamErrorText')}</p>
          <button
            type="button"
            onClick={() => {
              setStreamError(false);
              setMovie((prev) => (prev ? { ...prev } : prev)); // force player remount
            }}
            className="cursor-pointer rounded-lg border border-cinema-border bg-cinema-panel px-5 py-2.5 text-sm font-semibold text-cinema-text transition hover:border-cinema-amber/60"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div>
          {transcoding && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-cinema-amber/40 bg-cinema-amber/10 px-3 py-2 text-xs font-semibold text-cinema-accent">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cinema-amber" />
              {t('watch.transcodingBadge')}
            </div>
          )}
          <VideoPlayer
            key={`${movieId}-${streamError}`}
            movieId={movieId}
            quality={quality}
            onQualityChange={setQuality}
            qualities={qualities}
            maxQuality={maxQuality}
            onLockedQuality={(q) => setUpgradeQuality(q)}
            transcoding={transcoding}
            resumeAt={resumeAt}
            onProgress={report}
            onPaused={flush}
            onPlayStateChange={onPlayStateChange}
            onError={probeStream}
          />
        </div>
      )}

      {/* upgrade prompt — a quality above the plan cap was requested */}
      <Modal
        open={upgradeQuality != null}
        onClose={() => setUpgradeQuality(null)}
        title={t('watch.upgradeTitle', { quality: upgradeQuality ?? '' })}
        footer={
          <>
            <button
              type="button"
              onClick={() => setUpgradeQuality(null)}
              className="cursor-pointer rounded-lg border border-cinema-border px-4 py-2 text-sm font-semibold text-cinema-soft transition hover:border-cinema-amber/60"
            >
              {t('common.cancel')}
            </button>
            <Link
              to="/plans"
              className="rounded-lg bg-cinema-amber px-4 py-2 text-sm font-bold text-cinema-ink transition hover:shadow-glow"
            >
              {t('watch.upgradeCta')}
            </Link>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-cinema-soft">
          {t('watch.upgradeText', { quality: upgradeQuality ?? '', maxQuality })}
        </p>
      </Modal>

      {movie?.description && (
        <section className="mt-8 rounded-2xl border border-cinema-border bg-cinema-panel/60 p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.description')}</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-cinema-soft">{movie.description}</p>
        </section>
      )}
    </div>
  );
}
