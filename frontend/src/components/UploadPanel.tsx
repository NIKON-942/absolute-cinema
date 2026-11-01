import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUploads } from '@/context/UploadContext';
import { useLanguage } from '@/context/LanguageContext';
import { ProgressBar, TranscodeDetails } from './TranscodeProgress';
import { formatBytes } from '@/utils/upload';
import { formatDuration } from '@/utils/format';
import type { UploadTask } from '@/services/uploadManager';

function UploadItem({ task, now }: { task: UploadTask; now: number }) {
  const { manager } = useUploads(); const { t, lang } = useLanguage();
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const transferring = ['uploading', 'retrying'].includes(task.phase);
  const pausable = transferring || task.phase === 'hashing';
  const resumable = task.phase === 'paused' || task.phase === 'needsFile';
  const terminal = task.phase === 'ready' || task.phase === 'failed';
  const rate = transferring && (!task.lastProgressAt || now - task.lastProgressAt < 5000) ? task.rate : null;
  const elapsed = (task.elapsedMs + (task.transferStartedAt ? now - task.transferStartedAt : 0)) / 1000;
  const progress = task.phase === 'hashing' ? task.hashProgress : task.phase === 'processing' ? task.job?.progress ?? null
    : task.phase === 'verifying' ? null : Math.floor(task.loaded / task.size * 100);
  const button = 'rounded-md border border-cinema-border px-2.5 py-1.5 text-xs font-semibold text-cinema-soft hover:bg-cinema-card disabled:opacity-50';
  return (
    <article className="space-y-3 border-t border-cinema-border p-4" data-testid="upload-task">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="truncate text-sm font-bold" title={task.title}>{task.title}</p>
          <p className="truncate text-xs text-cinema-muted" title={task.filename}>{task.filename}</p></div>
        {terminal && <button className={button} onClick={() => manager.dismiss(task.key)} aria-label={t('uploads.dismiss')}>×</button>}
      </div>
      <ProgressBar label={task.phase === 'processing' && task.job ? t(`admin.movies.phase.${task.job.phase}`) : t(`uploads.phase.${task.phase}`)} progress={progress} />
      {task.phase === 'processing' && task.job && <TranscodeDetails job={task.job} />}
      {task.phase !== 'hashing' && <p className="text-xs text-cinema-muted">{formatBytes(task.loaded, lang)} / {formatBytes(task.size, lang)}</p>}
      {(transferring || task.phase === 'paused') && <dl className="grid grid-cols-3 gap-2 text-xs text-cinema-muted">
        <div><dt>{t('admin.movies.uploadSpeed')}</dt><dd className="mt-1 text-cinema-soft">{rate ? t('admin.movies.bytesPerSecond', { value: formatBytes(rate, lang) }) : '—'}</dd></div>
        <div><dt>{t('admin.movies.uploadElapsed')}</dt><dd className="mt-1 text-cinema-soft">{formatDuration(elapsed)}</dd></div>
        <div><dt>{t('admin.movies.uploadRemaining')}</dt><dd className="mt-1 text-cinema-soft">{rate && task.loaded < task.size ? `~${formatDuration(Math.ceil((task.size - task.loaded) / rate))}` : '—'}</dd></div>
      </dl>}
      {task.phase === 'needsFile' && <p className="text-xs text-cinema-muted">{t('uploads.selectHint')}</p>}
      {task.issue && <p role="status" className="text-xs text-cinema-notice">{t(`uploads.issue.${task.issue}`)}</p>}
      {task.error && <p role="alert" className="break-words text-xs text-cinema-error">{task.error}</p>}
      {error && <p role="alert" className="text-xs text-cinema-error">{t('uploads.cancelFailed')}</p>}
      <div className="flex flex-wrap gap-2">
        {pausable && <button className={button} onClick={() => manager.pause(task.key)}>{t('uploads.pause')}</button>}
        {resumable && (manager.hasFile(task.key)
          ? <button className={button} onClick={() => manager.resume(task.key)}>{t('uploads.resume')}</button>
          : <label className={`${button} cursor-pointer`}>{t('uploads.selectFile')}<input type="file" accept="video/*,.mkv,.avi,.m4v" className="sr-only"
            aria-label={t('uploads.selectFile')} onChange={e => { const file = e.target.files?.[0]; if (file) manager.resume(task.key, file); e.target.value = ''; }} /></label>)}
        {(pausable || resumable) && <button className={button} onClick={() => setConfirm(true)}>{t('uploads.cancel')}</button>}
        <Link className={button} to={`/admin?editMovie=${task.movieId}`}>{t('uploads.openMovie')}</Link>
      </div>
      {confirm && <div className="space-y-2 rounded-lg border border-cinema-red/40 bg-cinema-error-surface p-3" role="group" aria-label={t('uploads.cancelConfirm')}>
        <p className="text-xs text-cinema-error">{t('uploads.cancelConfirm')}</p>
        <div className="flex gap-2"><button className={button} disabled={busy} onClick={async () => {
          setBusy(true); setError(false);
          try { await manager.cancel(task.key); } catch { setError(true); setConfirm(false); } finally { setBusy(false); }
        }}>{t('uploads.deleteUpload')}</button><button className={button} disabled={busy} onClick={() => setConfirm(false)}>{t('uploads.keep')}</button></div>
      </div>}
    </article>
  );
}

export function UploadPanel() {
  const { tasks } = useUploads(); const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false); const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!tasks.length) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [tasks.length]);
  useEffect(() => { if (tasks.length) setCollapsed(false); }, [tasks.length]);
  if (!tasks.length) return null;
  return (
    <aside aria-label={t('uploads.title')} className="fixed bottom-3 right-3 z-[60] w-[calc(100%-1.5rem)] max-w-sm overflow-hidden rounded-xl border border-cinema-border bg-cinema-panel text-cinema-text shadow-card sm:bottom-5 sm:right-5">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-bold" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <span>{t('uploads.title')} · {tasks.length}</span><span aria-hidden="true">{collapsed ? '▴' : '▾'}</span>
      </button>
      {collapsed ? <p className="px-4 pb-3 text-xs text-cinema-muted" role="status">{t(`uploads.phase.${tasks[tasks.length - 1].phase}`)}{tasks[tasks.length - 1].phase === 'uploading' ? ` · ${Math.floor(tasks[tasks.length - 1].loaded / tasks[tasks.length - 1].size * 100)}%` : ''}</p>
        : <div className="max-h-[65dvh] overflow-y-auto">
          <p className="px-4 pb-3 text-xs text-cinema-muted">{t('uploads.backgroundHint')}</p>
          {tasks.map(task => <UploadItem key={task.key} task={task} now={now} />)}
        </div>}
    </aside>
  );
}
