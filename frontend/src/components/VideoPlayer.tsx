import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { streamUrl } from '@/utils/url';
import { formatDuration } from '@/utils/format';
import { qualityRank } from '@/utils/plans';
import { Spinner } from '@/components/Spinner';
import type { Quality } from '@/types';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const VOLUME_KEY = 'ac_volume';

function LockIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

interface VideoPlayerProps {
  movieId: number;
  quality: Quality;
  onQualityChange: (quality: Quality) => void;
  qualities: Quality[];
  /** Plan cap: qualities above it render with a lock and trigger
   *  onLockedQuality instead of switching (upgrade prompt). */
  maxQuality?: Quality;
  onLockedQuality?: (quality: Quality) => void;
  /** True while higher renditions are still transcoding — not-ready
   *  qualities are shown disabled instead of hidden. */
  transcoding?: boolean;
  /** Seconds to resume from (saved watch progress). */
  resumeAt?: number;
  /** Periodic progress callback (called ~4x/s by the browser). */
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  /** Called on pause / ended — a good moment to flush saved progress. */
  onPaused?: () => void;
  /** Play/pause transitions — used to run the device heartbeat. */
  onPlayStateChange?: (playing: boolean) => void;
  onError?: () => void;
  className?: string;
  /** Extra controls rendered inside the control bar (e.g. QualitySelector). */
  extraControls?: ReactNode;
}

/**
 * Custom <video> player: play/pause, seek bar with buffered indicator, volume,
 * fullscreen, playback speed, keyboard shortcuts (Space/K, ←/→ ±10s, ↑/↓ volume,
 * M mute, F fullscreen). Native Range requests are sent by the browser.
 */
export function VideoPlayer({
  movieId,
  quality,
  qualities,
  onQualityChange,
  maxQuality = '1080p',
  onLockedQuality,
  transcoding = false,
  resumeAt = 0,
  onProgress,
  onPaused,
  onPlayStateChange,
  onError,
  className = '',
  extraControls,
}: VideoPlayerProps) {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const lastTime = useRef(0);
  const wasPlaying = useRef(false);
  const restoreTime = useRef<number | null>(resumeAt > 0 ? resumeAt : null);
  const seekBarRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState<number>(() => {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(stored) && stored > 0 && stored <= 1 ? stored : 1;
  });
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState(0);

  const src = streamUrl(movieId, quality);

  // ---- keyboard shortcuts ----
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.2, v.currentTime + delta));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void containerRef.current?.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekBy(-10);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekBy(10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume((vol) => {
          const next = Math.min(1, +(vol + 0.1).toFixed(2));
          if (videoRef.current) videoRef.current.volume = next;
          return next;
        });
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume((vol) => {
          const next = Math.max(0, +(vol - 0.1).toFixed(2));
          if (videoRef.current) videoRef.current.volume = next;
          return next;
        });
        break;
      case 'm':
        setMuted((m) => !m);
        break;
      case 'f':
        toggleFullscreen();
        break;
      default:
        break;
    }
  };

  // ---- auto-hide controls ----
  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !speedOpen) {
        setShowControls(false);
      }
    }, 3000);
  }, [speedOpen]);

  useEffect(() => {
    bumpControls();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [bumpControls]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

  // ---- video events ----
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    v.volume = volume;
    v.muted = muted;
    v.playbackRate = speed;
    // restore position after a quality switch or initial resume
    if (restoreTime.current != null && restoreTime.current < (v.duration || 0) - 5) {
      v.currentTime = restoreTime.current;
    }
    restoreTime.current = null;
    if (wasPlaying.current) {
      void v.play().catch(() => undefined);
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!dragging) setCurrentTime(v.currentTime);
    lastTime.current = v.currentTime;
    onProgress?.(v.currentTime, v.duration || 0);
  };

  const onBufferProgress = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    try {
      if (v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1) / v.duration);
      }
    } catch {
      /* buffered metadata may be briefly unavailable */
    }
  };

  const onVideoError = () => {
    setWaiting(false);
    onError?.();
  };

  // ---- quality switch: remember position & play state before src changes ----
  useEffect(() => {
    const v = videoRef.current;
    wasPlaying.current = playing || Boolean(v && !v.paused && !v.ended);
    // By now the new src has already reset currentTime to 0 — lastTime (kept
    // fresh by onTimeUpdate) still holds the position to restore.
    const t =
      v && Number.isFinite(v.currentTime) && v.currentTime > 1
        ? v.currentTime
        : lastTime.current;
    if (t > 1) restoreTime.current = t;
    setWaiting(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  // ---- seek bar interactions ----
  const ratioFromEvent = (clientX: number): number => {
    const bar = seekBarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const commitSeek = (ratio: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) {
      v.currentTime = ratio * v.duration;
      setCurrentTime(ratio * v.duration);
    }
  };

  const onSeekBarPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    const ratio = ratioFromEvent(e.clientX);
    setDragRatio(ratio);
  };

  const onSeekBarPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragRatio(ratioFromEvent(e.clientX));
  };

  const onSeekBarPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    const ratio = ratioFromEvent(e.clientX);
    setDragging(false);
    commitSeek(ratio);
  };

  const displayRatio = duration > 0 ? (dragging ? dragRatio : currentTime / duration) : 0;
  const displayTime = dragging && duration ? dragRatio * duration : currentTime;

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    setSpeedOpen(false);
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={bumpControls}
      onTouchStart={bumpControls}
      className={`group relative aspect-video w-full overflow-hidden rounded-xl bg-black outline-none ring-cinema-amber/70 focus-visible:ring-2 ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        playsInline
        className="h-full w-full bg-black"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onProgress={onBufferProgress}
        onPlay={() => { setPlaying(true); bumpControls(); onPlayStateChange?.(true); }}
        onPause={() => { setPlaying(false); setShowControls(true); onPaused?.(); onPlayStateChange?.(false); }}
        onEnded={() => { setPlaying(false); setShowControls(true); onPaused?.(); onPlayStateChange?.(false); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={onVideoError}
      />

      {/* buffering spinner */}
      {waiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={12} />
        </div>
      )}

      {/* big play button when paused */}
      {!playing && !waiting && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={t('player.play')}
          className="absolute inset-0 m-auto flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-cinema-amber/95 text-cinema-black shadow-glow transition hover:scale-105"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v14l11-7-11-7z" />
          </svg>
        </button>
      )}

      {/* control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-3 pb-2 pt-8 transition-opacity duration-300 sm:px-4 ${
          showControls || !playing ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* seek bar */}
        <div
          ref={seekBarRef}
          role="slider"
          aria-label={t('player.seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(displayTime)}
          tabIndex={-1}
          className="group/bar relative mb-2 h-4 cursor-pointer"
          onPointerDown={onSeekBarPointerDown}
          onPointerMove={onSeekBarPointerMove}
          onPointerUp={onSeekBarPointerUp}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/20">
            <div className="absolute h-full rounded-full bg-white/30" style={{ width: `${buffered * 100}%` }} />
            <div className="absolute h-full rounded-full bg-cinema-red" style={{ width: `${displayRatio * 100}%` }} />
          </div>
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-cinema-amber shadow-glow transition-transform group-hover/bar:scale-125"
            style={{ left: `calc(${displayRatio * 100}% - 7px)` }}
          />
        </div>

        <div className="flex items-center gap-2 text-slate-100 sm:gap-3">
          {/* play/pause */}
          <button type="button" onClick={togglePlay} aria-label={playing ? t('player.pause') : t('player.play')} className="cursor-pointer rounded p-1 transition hover:text-cinema-amber">
            {playing ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z" /></svg>
            )}
          </button>

          {/* skip buttons */}
          <button type="button" onClick={() => seekBy(-10)} aria-label={t('player.back10')} className="hidden cursor-pointer rounded p-1 transition hover:text-cinema-amber sm:block">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" />
              <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
              <text x="8.5" y="16" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold">10</text>
            </svg>
          </button>
          <button type="button" onClick={() => seekBy(10)} aria-label={t('player.forward10')} className="hidden cursor-pointer rounded p-1 transition hover:text-cinema-amber sm:block">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" strokeLinecap="round" />
              <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
              <text x="7.5" y="16" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold">10</text>
            </svg>
          </button>

          {/* volume */}
          <div className="group/vol flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }}
              aria-label={t('player.mute')}
              className="cursor-pointer rounded p-1 transition hover:text-cinema-amber"
            >
              {muted || volume === 0 ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5 6 9H2v6h4l5 4V5z" strokeLinejoin="round" />
                  <path d="m22 9-6 6M16 9l6 6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5 6 9H2v6h4l5 4V5z" strokeLinejoin="round" />
                  <path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label={t('player.volume')}
              className="h-1 w-0 cursor-pointer accent-cinema-amber transition-all duration-200 group-hover/vol:w-16 sm:w-16"
            />
          </div>

          {/* time */}
          <span className="select-none text-xs font-medium tabular-nums text-slate-200 sm:text-sm">
            {formatDuration(displayTime)} / {formatDuration(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {extraControls}

            {/* quality (compact switcher; unprocessed ones stay disabled while
                transcoding; above-plan ones stay clickable but prompt an upgrade) */}
            {(transcoding || qualities.length > 1) && (
              <div className="flex items-center gap-0.5 rounded-md bg-white/10 p-0.5" role="group" aria-label={t('player.quality')}>
                {(['480p', '720p', '1080p'] as Quality[])
                  .filter((q) => transcoding || qualities.includes(q))
                  .map((q) => {
                    const ready = qualities.includes(q);
                    const locked = qualityRank(q) > qualityRank(maxQuality);
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() =>
                          locked ? onLockedQuality?.(q) : ready && onQualityChange(q)
                        }
                        disabled={!ready}
                        aria-pressed={q === quality}
                        aria-disabled={!ready || undefined}
                        title={
                          locked
                            ? t('player.qualityLocked', { quality: q })
                            : transcoding && !ready
                              ? t('player.qualityProcessing')
                              : undefined
                        }
                        className={`flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                          q === quality
                            ? 'bg-cinema-amber text-cinema-black'
                            : locked
                              ? 'text-slate-400 hover:text-slate-200'
                              : ready
                                ? 'text-slate-300 hover:text-white'
                                : 'cursor-not-allowed text-slate-500/50'
                        }`}
                      >
                        {q}
                        {locked && <LockIcon />}
                      </button>
                    );
                  })}
              </div>
            )}

            {/* playback speed */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSpeedOpen((v) => !v)}
                aria-label={t('player.speed')}
                aria-expanded={speedOpen}
                className="cursor-pointer rounded px-1.5 py-1 text-xs font-bold transition hover:text-cinema-amber"
              >
                {speed}x
              </button>
              {speedOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-20 overflow-hidden rounded-lg border border-cinema-border bg-cinema-panel py-1 shadow-card">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => changeSpeed(s)}
                      className={`block w-full cursor-pointer px-3 py-1.5 text-left text-xs transition hover:bg-cinema-card ${
                        s === speed ? 'text-cinema-amber' : 'text-slate-200'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* fullscreen */}
            <button type="button" onClick={toggleFullscreen} aria-label={t('player.fullscreen')} className="cursor-pointer rounded p-1 transition hover:text-cinema-amber">
              {fullscreen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3M16 21v-3a2 2 0 0 1 2-2h3" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
