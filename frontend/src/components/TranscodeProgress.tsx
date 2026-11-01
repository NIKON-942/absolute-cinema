import { useLanguage } from '@/context/LanguageContext';
import type { MovieDto, TranscodeJobDto } from '@/types';
import { formatDuration } from '@/utils/format';

export function TranscodeDetails({ job }: { job: TranscodeJobDto }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      {job.elapsedSeconds !== undefined && <dl className="grid grid-cols-2 gap-2 text-xs text-cinema-muted">
        <div><dt>{t('admin.movies.conversionElapsed')}</dt><dd className="mt-1 tabular-nums text-cinema-soft">{formatDuration(job.elapsedSeconds)}</dd></div>
        <div><dt>{t('admin.movies.uploadRemaining')}</dt><dd className="mt-1 tabular-nums text-cinema-soft">{job.remainingSeconds != null ? `~${formatDuration(job.remainingSeconds)}` : '—'}</dd></div>
      </dl>}
      {job.renditions?.map(rendition => <div key={rendition.quality} className="space-y-1">
        <ProgressBar label={`${rendition.quality} · ${t(`admin.movies.rendition.${rendition.state}`)}`} progress={rendition.progress} />
        {rendition.mode === 'copy' && <p className="text-xs text-cinema-muted">{t('admin.movies.videoCopy')}</p>}
      </div>)}
    </div>
  );
}

export function ProgressBar({ label, progress }: { label: string; progress: number | null }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-xs text-cinema-soft">
        <span>{label}</span>
        {progress !== null && <span className="tabular-nums">{progress}%</span>}
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progress ?? undefined} className="h-1.5 overflow-hidden rounded-full bg-cinema-card">
        <div className={`h-full rounded-full bg-cinema-amber transition-[width] ${progress === null ? 'w-1/3 animate-pulse' : ''}`}
          style={progress === null ? undefined : { width: `${progress}%` }} />
      </div>
    </div>
  );
}

export function TranscodeProgress({ movie, job, compact = false }: {
  movie: MovieDto; job?: TranscodeJobDto; compact?: boolean;
}) {
  const { t } = useLanguage();
  const status = job?.status ?? movie.transcodeStatus;
  const qualities = job?.qualities ?? movie.availableQualities;
  return (
    <div className={compact ? 'min-w-36 space-y-2' : 'space-y-3'}>
      {status === 'processing' ? (
        <ProgressBar label={t(`admin.movies.phase.${job?.phase ?? 'queued'}`)} progress={job?.progress ?? null} />
      ) : (
        <p className={`text-xs ${status === 'failed' ? 'text-cinema-error' : status === 'ready' ? 'text-cinema-success' : 'text-cinema-muted'}`}>
          {t(`admin.movies.transcode.${status}`)}{status === 'ready' ? ' · 100%' : ''}
        </p>
      )}
      {!compact && job?.renditions?.length ? <TranscodeDetails job={job} /> : !compact && status !== 'none' && (
        <div className="flex flex-wrap gap-2 text-xs">
          {(job?.targetQualities.length ? job.targetQualities : qualities).map(q => (
            <span key={q} className={qualities.includes(q) ? 'text-cinema-success' : 'text-cinema-muted'}>
              {q}: {t(qualities.includes(q) ? 'admin.movies.qualityReady' : job?.currentQuality === q ? 'admin.movies.qualityProcessing' : 'admin.movies.qualityWaiting')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
