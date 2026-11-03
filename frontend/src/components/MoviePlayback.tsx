import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { mediaService } from '@/services/mediaService';
import { devicesService } from '@/services/devicesService';
import { useVideoProgress } from '@/hooks/useVideoProgress';
import { VideoPlayer } from '@/components/VideoPlayer';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { resolveMediaUrl, streamUrl } from '@/utils/url';
import { getDeviceId, limitsForTier, qualityRank } from '@/utils/plans';
import type { MovieDto, Quality } from '@/types';

/** Playback and subscription states shared by the public movie page. */
export function MoviePlayback({ initialMovie }: { initialMovie: MovieDto }) {
  const movieId = initialMovie.id;
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const [movie, setMovie] = useState(initialMovie);
  const [started, setStarted] = useState(false);
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

  /**
   * Keep the page fresh while renditions are transcoding: qualities appear
   * one by one (480p first) and become switchable without a reload. A slower
   * background poll continues afterwards so a completed master replacement
   * is also picked up on an already-open page.
   */
  useEffect(() => {
    let cancelled = false;
    const processing = movie?.transcodeStatus === 'processing';
    const timer = window.setInterval(
      () => {
        mediaService
          .getById(movieId)
          .then((m) => { if (!cancelled) setMovie(m); })
          .catch(() => undefined);
      },
      processing ? 3000 : 15000,
    );
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [movie?.transcodeStatus, movieId]);

  // ---- concurrent-device enforcement (plan maxDevices) ----
  const deviceId = getDeviceId();
  const heartbeatTimer = useRef<number | null>(null);
  const deviceLimitHit = useRef(false);
  const playbackId = useRef(`play-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const playbackRecorded = useRef(false);

  const stopHeartbeat = useCallback(() => {
    if (!started) return;
    devicesService.end(deviceId);
    if (heartbeatTimer.current != null) {
      window.clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, [deviceId, started]);

  /** While playing: register this device every minute; the stream endpoint
   *  enforces the limit on every range request as well. 409 → limit panel. */
  const onPlayStateChange = useCallback(
    (playing: boolean) => {
      if (playing) {
        if (deviceLimitHit.current || heartbeatTimer.current != null) return;
        const beat = () => devicesService.heartbeat(deviceId).then(() => {
          if (!playbackRecorded.current) {
            playbackRecorded.current = true;
            void mediaService.recordPlayback(movieId, playbackId.current).catch(() => { playbackRecorded.current = false; });
          }
        }).catch((err) => {
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
    [deviceId, stopHeartbeat, movieId],
  );

  // free the device slot when playback is cut off (panel replaces the player)
  useEffect(() => {
    if (deviceLimit) stopHeartbeat();
  }, [deviceLimit, stopHeartbeat]);

  // leaving the page or closing the tab releases the device immediately
  useEffect(() => stopHeartbeat, [stopHeartbeat]);
  useEffect(() => {
    const onUnload = stopHeartbeat;
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [stopHeartbeat]);

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
  const noVideo = qualities.length === 0;
  const needsSubscription = !user?.hasActiveSubscription || streamForbidden;

  return (
    <div id="movie-player" className="min-w-0 scroll-mt-24">
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
              to={isAuthenticated ? "/plans" : "/login"}
              state={isAuthenticated ? undefined : { from: `/movie/${movieId}` }}
              className="inline-flex items-center gap-2 rounded-xl bg-cinema-amber px-7 py-3 font-bold text-cinema-ink transition hover:shadow-glow"
            >
              {t(isAuthenticated ? 'watch.seePlans' : 'nav.login')}
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
            }}
            className="cursor-pointer rounded-lg border border-cinema-border bg-cinema-panel px-5 py-2.5 text-sm font-semibold text-cinema-text transition hover:border-cinema-amber/60"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : !started ? (
        <button
          type="button"
          onClick={() => setStarted(true)}
          aria-label={t('movie.watch')}
          className="group relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-cinema-border bg-cinema-black"
        >
          {movie.posterUrl && <img src={resolveMediaUrl(movie.posterUrl)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
          <span className="relative flex flex-col items-center gap-3 text-white">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cinema-amber text-cinema-ink shadow-glow transition group-hover:scale-110">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v14l11-7-11-7z" /></svg>
            </span>
            <span className="font-bold">{t('movie.watch')}</span>
          </span>
        </button>
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
            autoPlay
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

    </div>
  );
}
