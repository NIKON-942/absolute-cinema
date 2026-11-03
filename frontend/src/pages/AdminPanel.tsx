import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { FormEvent } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { useUploads } from '@/context/UploadContext';
import { useDebounce } from '@/hooks/useDebounce';
import { AGE_RATINGS } from '@/utils/ageRatings';
import { mediaService } from '@/services/mediaService';
import type { MovieUpsertPayload } from '@/services/mediaService';
import { usersService } from '@/services/usersService';
import { adminService } from '@/services/adminService';
import { errorStatusKey, extractServerMessage } from '@/services/api';
import { AdminTable } from '@/components/AdminTable';
import type { Column } from '@/components/AdminTable';
import { Modal } from '@/components/Modal';
import { AutoTextarea } from '@/components/AutoTextarea';
import { ImageField } from '@/components/ImageField';
import { ProgressBar, TranscodeProgress } from '@/components/TranscodeProgress';
import { LoadingBlock } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { formatPrice } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/url';
import type {
  ActorDto,
  AnalyticsDto,
  CountryDto,
  DirectorDto,
  GenreDto,
  MovieDto,
  Paginated,
  Role,
  TranscodeJobDto,
  UserDto,
} from '@/types';

const PAGE_SIZE = 10;
const ANALYTICS_INTERVALS = [7, 30, 90, 365];

const inputClass =
  'w-full rounded-lg border border-cinema-border bg-cinema-black/60 px-3 py-2 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-cinema-muted';
const primaryBtn =
  'cursor-pointer rounded-lg bg-cinema-amber px-4 py-2 text-sm font-bold text-cinema-ink transition hover:shadow-glow disabled:cursor-default disabled:opacity-60';
const ghostBtn =
  'cursor-pointer rounded-lg border border-cinema-border px-4 py-2 text-sm font-semibold text-cinema-soft transition hover:border-cinema-amber/60 disabled:cursor-default disabled:opacity-60';
const dangerBtn =
  'cursor-pointer rounded-lg bg-cinema-red px-4 py-2 text-sm font-bold text-white transition hover:bg-cinema-red/85 disabled:cursor-default disabled:opacity-60';

type Tab = 'movies' | 'genres' | 'actors' | 'countries' | 'directors' | 'users' | 'analytics';
const TABS: Tab[] = ['movies', 'genres', 'actors', 'countries', 'directors', 'users', 'analytics'];

export default function AdminPanel() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('movies');
  const location = useLocation();
  const requestedMovie = new URLSearchParams(location.search).get('editMovie');
  useEffect(() => { if (requestedMovie) setTab('movies'); }, [location.key, requestedMovie]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-cinema-strong sm:text-3xl">{t('admin.title')}</h1>
      </header>

      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-cinema-border bg-cinema-panel/60 p-1" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`shrink-0 cursor-pointer rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === key ? 'bg-cinema-amber text-cinema-ink shadow-glow' : 'text-cinema-soft hover:bg-cinema-card hover:text-cinema-text'
            }`}
          >
            {t(`admin.tab.${key}`)}
          </button>
        ))}
      </nav>

      {tab === 'movies' && <MoviesTab />}
      {tab === 'genres' && <GenresTab />}
      {tab === 'actors' && <ActorsTab />}
      {tab === 'countries' && (
        <DictionaryTab
          i18nPrefix="admin.countries"
          load={() => mediaService.countries()}
          create={(name) => mediaService.createCountry(name)}
          update={(id, name) => mediaService.updateCountry(id, name)}
          remove={(id) => mediaService.deleteCountry(id)}
        />
      )}
      {tab === 'directors' && (
        <DictionaryTab
          i18nPrefix="admin.directors"
          load={() => mediaService.directors()}
          create={(name) => mediaService.createDirector(name)}
          update={(id, name) => mediaService.updateDirector(id, name)}
          remove={(id) => mediaService.deleteDirector(id)}
        />
      )}
      {tab === 'users' && <UsersTab />}
      {tab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared confirm dialog
// ---------------------------------------------------------------------------
interface ConfirmState {
  title: string;
  message: string;
  action: () => Promise<void>;
}

function ConfirmDialog({ state, onClose, busy }: { state: ConfirmState | null; onClose: () => void; busy: boolean }) {
  const { t } = useLanguage();
  return (
    <Modal
      open={state !== null}
      title={state?.title ?? ''}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={ghostBtn} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => void state?.action()} className={dangerBtn} disabled={busy}>
            {busy ? t('common.loading') : t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-cinema-soft">{state?.message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Movies tab
// ---------------------------------------------------------------------------
interface MovieFormState {
  title: string;
  originalTitle: string;
  description: string;
  year: string;
  countryId: string;
  ageRating: string;
  directorId: string;
  runtimeMinutes: string;
  trailerUrl: string;
  posterUrl: string;
  masterVideoUrl: string;
  keywords: string;
  genreIds: number[];
  actorIds: number[];
  file: File | null;
}

const emptyMovieForm: MovieFormState = {
  title: '',
  originalTitle: '',
  description: '',
  year: '',
  countryId: '',
  ageRating: '16+',
  directorId: '',
  runtimeMinutes: '',
  trailerUrl: '',
  posterUrl: '',
  masterVideoUrl: '',
  keywords: '',
  genreIds: [],
  actorIds: [],
  file: null,
};

function MoviesTab() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const requestedMovie = searchParams.get('editMovie');
  const { manager: uploadManager, tasks: uploadTasks } = useUploads();
  const { success, error: errorToast } = useToast();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<MovieDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [genres, setGenres] = useState<GenreDto[]>([]);
  const [actors, setActors] = useState<ActorDto[]>([]);
  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [directors, setDirectors] = useState<DirectorDto[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MovieDto | null>(null);
  const [form, setForm] = useState<MovieFormState>(emptyMovieForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [jobs, setJobs] = useState<Record<number, TranscodeJobDto>>({});
  const activeUpload = editing ? uploadTasks.find(task => task.movieId === editing.id && !['ready', 'failed'].includes(task.phase)) : undefined;
  const conversionBusy = Boolean(activeUpload) || editing?.transcodeStatus === 'processing' && jobs[editing.id]?.phase !== 'unavailable';

  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reload = (p = page) => {
    setLoading(true);
    setLoadError(false);
    mediaService
      .list({ search: debouncedSearch.trim() || undefined, page: p, limit: PAGE_SIZE })
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [debouncedSearch, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mediaService.genres().then(setGenres).catch(() => undefined);
    mediaService.actors().then(setActors).catch(() => undefined);
    mediaService.countries().then(setCountries).catch(() => undefined);
    mediaService.directors().then(setDirectors).catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyMovieForm);
    setFormError(null);
    setMasterFile(null);
    setFormOpen(true);
  };

  const openEdit = useCallback((movie: MovieDto) => {
    setEditing(movie);
    setForm({
      title: movie.title,
      originalTitle: movie.originalTitle,
      description: movie.description,
      year: String(movie.year || ''),
      countryId: movie.countryId == null ? '' : String(movie.countryId),
      ageRating: movie.ageRating,
      directorId: movie.directorId == null ? '' : String(movie.directorId),
      runtimeMinutes: movie.runtimeMinutes ? String(movie.runtimeMinutes) : '',
      trailerUrl: movie.trailerUrl ?? '',
      posterUrl: movie.posterUrl,
      keywords: movie.keywords.join(', '),
      genreIds: movie.genres.map((g) => g.id),
      actorIds: movie.actors.map((a) => a.id),
      file: null,
      masterVideoUrl: /^https?:\/\//i.test(movie.masterVideoUrl ?? '') ? movie.masterVideoUrl! : '',
    });
    setFormError(null);
    setMasterFile(null);
    setFormOpen(true);
  }, []);

  useEffect(() => {
    const id = Number(requestedMovie);
    if (!requestedMovie || !/^[1-9]\d*$/.test(requestedMovie) || !Number.isSafeInteger(id)) return;
    let cancelled = false;
    // Load by ID: the uploaded movie may be outside the current table page/filter.
    mediaService.getById(id).then(movie => {
      if (!cancelled) openEdit(movie);
    }).catch(error => {
      if (!cancelled) errorToast(extractServerMessage(error) ?? t(errorStatusKey(error)));
    }).finally(() => {
      if (!cancelled) setSearchParams(params => {
        const next = new URLSearchParams(params);
        next.delete('editMovie');
        return next;
      }, { replace: true });
    });
    return () => { cancelled = true; };
  }, [requestedMovie, location.key, openEdit, setSearchParams, errorToast, t]);

  const selectMaster = (file: File | null) => {
    if (file && !/\.(mp4|webm)$/i.test(file.name)) {
      errorToast(t('admin.movies.videoUnsupported'));
      return;
    }
    if (file && file.size > 8 * 1024 ** 3) {
      errorToast(t('admin.movies.videoTooLarge'));
      return;
    }
    setMasterFile(file);
    setFormError(null);
    if (file) setForm(prev => ({ ...prev, masterVideoUrl: '' }));
  };

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (form.file && (form.file.size > 5 * 1024 * 1024 || !/\.(jpe?g|png|webp)$/i.test(form.file.name))) {
      setFormError(t('admin.movies.posterHint'));
      return;
    }
    const year = Number(form.year);
    if (!form.title.trim() || !form.description.trim() || !form.year || !Number.isInteger(year) || year < 1890 || year > 2100) {
      setFormError(t('admin.movies.fillRequired'));
      return;
    }
    const validUrl = (value: string) => {
      if (!value.trim()) return true;
      try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && value.length <= 2048; } catch { return false; }
    };
    if (form.title.trim().length > 255 || form.originalTitle.trim().length > 255 || form.description.trim().length > 20000
      || (form.runtimeMinutes && (!Number.isInteger(Number(form.runtimeMinutes)) || Number(form.runtimeMinutes) < 1 || Number(form.runtimeMinutes) > 600))
      || !AGE_RATINGS.includes(form.ageRating as typeof AGE_RATINGS[number])
      || !validUrl(form.trailerUrl) || !validUrl(form.masterVideoUrl)
      || (form.countryId && !countries.some(c => c.id === Number(form.countryId)))
      || (form.directorId && !directors.some(d => d.id === Number(form.directorId)))
      || form.genreIds.some(id => !genres.some(g => g.id === id)) || form.actorIds.some(id => !actors.some(a => a.id === id))
      || form.keywords.split(',').length > 50 || form.keywords.split(',').some(k => k.trim().length > 100)) {
      setFormError(t('admin.movies.invalidMetadata'));
      return;
    }
    setFormError(null);
    setSaving(true);
    let savedMovie: MovieDto | null = null;
    try {
      const payload: MovieUpsertPayload = {
        title: form.title.trim(),
        originalTitle: form.originalTitle.trim(),
        description: form.description.trim(),
        year,
        countryId: form.countryId ? Number(form.countryId) : null,
        ageRating: form.ageRating,
        directorId: form.directorId ? Number(form.directorId) : null,
        runtimeMinutes: form.runtimeMinutes ? Number(form.runtimeMinutes) : '',
        trailerUrl: form.trailerUrl.trim(),
        posterUrl: form.posterUrl.trim(),
        keywords: form.keywords.trim(),
        genreIds: form.genreIds,
        actorIds: form.actorIds,
        file: form.file,
        masterVideoUrl: !masterFile && form.masterVideoUrl.trim() !== editing?.masterVideoUrl
          ? form.masterVideoUrl.trim() : undefined,
      };
      savedMovie = editing
        ? await mediaService.updateMovie(editing.id, payload)
        : await mediaService.createMovie(payload);
      const saved = savedMovie;
      setEditing(saved);
      setForm(prev => ({ ...prev, file: null }));
      if (masterFile || payload.masterVideoUrl) {
        setJobs(prev => { const next = { ...prev }; delete next[saved.id]; return next; });
      }
      // Keep the saved movie visible without a list response racing the upload response.
      setData(prev => prev ? {
        ...prev,
        total: prev.total + (editing ? 0 : 1),
        items: prev.items.some(movie => movie.id === saved.id)
          ? prev.items.map(movie => movie.id === saved.id ? saved : movie)
          : [saved, ...prev.items].slice(0, PAGE_SIZE),
      } : prev);
      if (masterFile) {
        uploadManager.start(saved, masterFile);
        setMasterFile(null);
        setFormOpen(false);
        success(t('uploads.started'));
      } else {
        reload();
        success(t(editing ? 'admin.movies.updated' : 'admin.movies.created'));
        if (savedMovie.transcodeStatus !== 'processing') setFormOpen(false);
      }
    } catch (err) {
      if (savedMovie && masterFile) setFormError(t('admin.movies.uploadFailedSaved'));
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const deleteMovie = (movie: MovieDto) => {
    setConfirmState({
      title: t('common.delete'),
      message: `${t('admin.movies.deleteConfirm')}\n«${movie.title}»`,
      action: async () => {
        setConfirmBusy(true);
        try {
          await mediaService.deleteMovie(movie.id);
          success(t('admin.movies.deleted'));
          setConfirmState(null);
          reload();
        } catch (err) {
          errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  // Poll visible jobs even after the movie form is closed.
  const processingIds = [...new Set([
    ...(data?.items ?? []).filter(m => m.transcodeStatus === 'processing').map(m => m.id),
    ...uploadTasks.filter(task => task.phase === 'processing').map(task => task.movieId),
    ...(formOpen && editing?.transcodeStatus === 'processing' ? [editing.id] : []),
  ])].sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!processingIds) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const synced = new Map<number, string>();
    const poll = async () => {
      await Promise.allSettled(processingIds.split(',').map(async id => {
        const job = await mediaService.transcodeStatus(Number(id));
        if (cancelled) return;
        setJobs(prev => ({ ...prev, [job.movieId]: job }));
        const terminal = job.status === 'ready' || job.status === 'failed';
        const signature = `${job.status}:${job.qualities.join(',')}`;
        if ((terminal || job.qualities.length > 0) && synced.get(job.movieId) !== signature) {
          const updated = await mediaService.getById(job.movieId);
          if (cancelled) return;
          synced.set(job.movieId, signature);
          setEditing(prev => prev?.id === updated.id ? updated : prev);
          setData(prev => prev ? { ...prev, items: prev.items.map(m => m.id === updated.id ? updated : m) } : prev);
          if (job.status === 'ready') success(t('admin.movies.transcodeReady'));
          else if (job.status === 'failed') errorToast(t('admin.movies.transcodeFailed'));
        }
      }));
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [processingIds, t, success, errorToast]);

  const finishedUploads = uploadTasks.filter(task => task.phase === 'ready' || task.phase === 'failed').map(task => task.key + task.phase).join(',');
  useEffect(() => { if (finishedUploads) reload(); }, [finishedUploads]);

  const toggleId = (list: number[], id: number): number[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const columns: Column<MovieDto>[] = [
    {
      key: 'title',
      label: t('admin.movies.title'),
      sortable: true,
      render: (m) => (
        <div className="flex items-center gap-3">
          <div className="h-12 w-8 shrink-0 overflow-hidden rounded border border-cinema-border bg-cinema-card">
            {m.posterUrl ? (
              <img src={resolveMediaUrl(m.posterUrl)} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-cinema-text">{m.title}</p>
            <p className="truncate text-xs text-cinema-muted">#{m.id}</p>
          </div>
        </div>
      ),
    },
    { key: 'year', label: t('admin.movies.year'), sortable: true, className: 'hidden md:table-cell' },
    {
      key: 'genres',
      label: t('admin.movies.genres'),
      render: (m) => <span className="text-xs text-cinema-muted">{m.genres.map((g) => g.name).join(', ') || '—'}</span>,
      className: 'hidden lg:table-cell',
    },
    {
      key: 'viewCount',
      label: t('admin.movies.views'),
      sortable: true,
      render: (m) => m.viewCount.toLocaleString(),
      className: 'hidden sm:table-cell',
    },
    {
      key: 'averageRating',
      label: t('admin.movies.rating'),
      sortable: true,
      render: (m) => (m.averageRating > 0 ? `★ ${m.averageRating.toFixed(1)}` : '—'),
      className: 'hidden sm:table-cell',
    },
    {
      key: 'transcodeStatus',
      label: t('admin.movies.masterVideo'),
      render: (m) => {
        const task = uploadTasks.find(task => task.movieId === m.id && !['ready', 'failed'].includes(task.phase));
        return task ? <ProgressBar label={t(`uploads.phase.${task.phase}`)} progress={task.phase === 'hashing' ? task.hashProgress : task.phase === 'processing' ? task.job?.progress ?? null : Math.floor(task.loaded / task.size * 100)} />
          : <TranscodeProgress movie={m} job={jobs[m.id]} compact />;
      },
    },
    {
      key: 'availableQualities',
      label: t('player.quality'),
      render: (m) => <span className="text-xs text-cinema-muted">{m.availableQualities.join(' / ') || '—'}</span>,
      className: 'hidden lg:table-cell',
    },
  ];

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t('admin.movies.search')}
          className={`${inputClass} max-w-xs`}
          aria-label={t('common.search')}
        />
        <span className="flex-1 text-sm text-cinema-muted">{data ? t('catalog.foundCount', { count: data.total }) : ''}</span>
        <button type="button" onClick={openCreate} className={primaryBtn} disabled={saving}>
          + {t('admin.movies.add')}
        </button>
      </div>

      {loading && !data ? (
        <LoadingBlock />
      ) : loadError ? (
        <EmptyState
          icon="⚠️"
          title={t('admin.loadError')}
          action={
            <button type="button" onClick={() => reload()} className={primaryBtn}>
              {t('common.retry')}
            </button>
          }
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(m) => m.id}
            emptyMessage={t('admin.movies.empty')}
            actions={(m) => (
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => openEdit(m)}
                  disabled={saving}
                  aria-label={t('common.edit')}
                  className="cursor-pointer rounded-md border border-cinema-border p-1.5 text-cinema-soft transition hover:border-cinema-amber/60 hover:text-cinema-accent"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => deleteMovie(m)}
                  disabled={saving || m.transcodeStatus === 'processing'}
                  aria-label={t('common.delete')}
                  className="cursor-pointer rounded-md border border-cinema-border p-1.5 text-cinema-soft transition hover:border-cinema-red/60 hover:text-cinema-red"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}
          />
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={ghostBtn}>
                ← {t('common.prev')}
              </button>
              <span className="text-cinema-muted">
                {page} / {totalPages}
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={ghostBtn}>
                {t('common.next')} →
              </button>
            </div>
          )}
        </>
      )}

      {/* create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => { if (!saving) setFormOpen(false); }}
        wide
        title={editing ? t('admin.movies.editTitle') : t('admin.movies.createTitle')}
        footer={
          <>
            <button type="button" onClick={() => setFormOpen(false)} className={ghostBtn} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="movie-form" className={primaryBtn} disabled={saving}>
              {saving ? t('common.loading') : editing ? t('common.save') : t('common.create')}
            </button>
          </>
        }
      >
        <form id="movie-form" onSubmit={submitForm} className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
          {formError && (
            <p className="rounded-lg border border-cinema-red/50 bg-cinema-red/10 px-3 py-2 text-sm text-cinema-error">{formError}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mf-title" className={labelClass}>
                {t('admin.movies.title')} *
              </label>
              <input id="mf-title" type="text" maxLength={255} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label htmlFor="mf-orig" className={labelClass}>
                {t('admin.movies.originalTitle')}
              </label>
              <input id="mf-orig" type="text" maxLength={255} value={form.originalTitle} onChange={(e) => setForm({ ...form, originalTitle: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label htmlFor="mf-desc" className={labelClass}>
              {t('admin.movies.description')} *
            </label>
            <AutoTextarea
              id="mf-desc"
              maxLength={20000} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              minRows={3}
              className={inputClass}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="mf-year" className={labelClass}>
                {t('admin.movies.year')} *
              </label>
              <input id="mf-year" type="number" min={1890} max={2100} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label htmlFor="mf-country" className={labelClass}>
                {t('admin.movies.country')}
              </label>
              <select id="mf-country" value={form.countryId} onChange={(e) => setForm({ ...form, countryId: e.target.value })} className={inputClass}>
                <option value="">—</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mf-age" className={labelClass}>
                {t('admin.movies.ageRating')}
              </label>
              <select id="mf-age" value={form.ageRating} onChange={(e) => setForm({ ...form, ageRating: e.target.value })} className={inputClass}>
                <option value="">—</option>
                {AGE_RATINGS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mf-runtime" className={labelClass}>
                {t('admin.movies.runtime')}
              </label>
              <input
                id="mf-runtime"
                type="number"
                min={1}
                max={600}
                value={form.runtimeMinutes}
                onChange={(e) => setForm({ ...form, runtimeMinutes: e.target.value })}
                placeholder="120"
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mf-director" className={labelClass}>
                {t('admin.movies.director')}
              </label>
              <select id="mf-director" value={form.directorId} onChange={(e) => setForm({ ...form, directorId: e.target.value })} className={inputClass}>
                <option value="">—</option>
                {directors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="mf-trailer" className={labelClass}>
                {t('admin.movies.trailerUrl')}
              </label>
              <input
                id="mf-trailer"
                type="url"
                value={form.trailerUrl}
                onChange={(e) => setForm({ ...form, trailerUrl: e.target.value })}
                placeholder="https://…"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="mf-keywords" className={labelClass}>
              {t('admin.movies.keywords')}
            </label>
            <input id="mf-keywords" type="text" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} className={inputClass} />
            <p className="mt-1 text-xs text-cinema-muted">{t('admin.movies.keywordsHint')}</p>
          </div>

          {/* genres multi-select */}
          <div>
            <span className={labelClass}>{t('admin.movies.genres')}</span>
            <div className="flex flex-wrap gap-2">
              {genres.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setForm({ ...form, genreIds: toggleId(form.genreIds, g.id) })}
                  aria-pressed={form.genreIds.includes(g.id)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    form.genreIds.includes(g.id)
                      ? 'border-cinema-amber bg-cinema-amber/15 text-cinema-accent'
                      : 'border-cinema-border text-cinema-soft hover:border-cinema-amber/50'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          {/* actors multi-select */}
          <div>
            <span className={labelClass}>{t('admin.movies.actors')}</span>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-cinema-border bg-cinema-black/40 p-2">
              {actors.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-cinema-soft transition hover:bg-cinema-card">
                  <input
                    type="checkbox"
                    checked={form.actorIds.includes(a.id)}
                    onChange={() => setForm({ ...form, actorIds: toggleId(form.actorIds, a.id) })}
                    className="h-4 w-4 accent-cinema-amber"
                  />
                  {a.name}
                </label>
              ))}
              {actors.length === 0 && <p className="px-2 py-1 text-xs text-cinema-muted">{t('admin.actors.empty')}</p>}
            </div>
          </div>

          {/* poster upload or direct URL (FR-29) */}
          <ImageField id="movie-poster" label={t('admin.movies.poster')} portrait
            value={form.posterUrl} file={form.file ?? null} disabled={saving}
            onFileChange={file => setForm(previous => ({ ...previous, file }))}
            onUrlChange={posterUrl => setForm(previous => ({ ...previous, posterUrl }))} />

          {/* Video is optional for both new and existing movies. */}
          <div className="space-y-3 rounded-xl border border-cinema-border bg-cinema-black/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-cinema-muted">{t('admin.movies.masterVideo')}</p>
              <span className="text-xs text-cinema-muted">{t('admin.movies.videoOptional')}</span>
            </div>
            <p className="text-xs text-cinema-muted">{t('admin.movies.masterHint')}</p>
            {activeUpload ? <p className="text-xs text-cinema-accent">{t('uploads.inPanel')}</p> : editing && <TranscodeProgress movie={editing} job={jobs[editing.id]} />}
            <div
              role="button"
              aria-label={t('admin.movies.masterDropTitle')}
              aria-disabled={saving || conversionBusy}
              tabIndex={saving || conversionBusy ? -1 : 0}
              onClick={() => { if (!saving && !conversionBusy) document.getElementById('master-file-input')?.click(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!saving && !conversionBusy) document.getElementById('master-file-input')?.click();
                }
              }}
              onDragOver={(e) => { e.preventDefault(); if (!saving && !conversionBusy) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!saving && !conversionBusy) selectMaster(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
                dragOver ? 'border-cinema-amber bg-cinema-amber/10' : 'border-cinema-border'
              } ${saving || conversionBusy ? 'opacity-60' : 'cursor-pointer hover:border-cinema-amber/60'}`}
            >
              <span className="text-2xl">🎬</span>
              <p className="break-all text-sm font-semibold text-cinema-soft">{masterFile?.name ?? t('admin.movies.masterDropTitle')}</p>
              <p className="text-xs text-cinema-muted">{t(masterFile ? 'admin.movies.videoSelected' : 'admin.movies.masterDropHint')}</p>
            </div>
            <input
              id="master-file-input"
              type="file"
              accept="video/mp4,video/webm,.mp4,.webm"
              className="sr-only"
              disabled={saving || conversionBusy}
              onChange={(e) => { selectMaster(e.target.files?.[0] ?? null); e.target.value = ''; }}
              aria-label={t('admin.movies.videoFile')}
            />
            {masterFile && (
              <button type="button" className={ghostBtn} onClick={() => setMasterFile(null)} disabled={saving}>
                {t('admin.movies.removeVideoSelection')}
              </button>
            )}
            <div>
              <label htmlFor="mf-master-url" className={labelClass}>{t('admin.movies.masterUrl')}</label>
              <input id="mf-master-url" type="url" value={form.masterVideoUrl}
                onChange={(e) => setForm({ ...form, masterVideoUrl: e.target.value })}
                disabled={Boolean(masterFile) || conversionBusy} placeholder="https://…" className={inputClass} />
            </div>
            <p className="text-xs text-cinema-muted">{t(conversionBusy ? 'admin.movies.conversionBackground' : 'admin.movies.masterCreateHint')}</p>
          </div>
          </fieldset>
        </form>
      </Modal>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} busy={confirmBusy} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Genres tab
// ---------------------------------------------------------------------------
function GenresTab() {
  const { t } = useLanguage();
  const { success, error: errorToast } = useToast();
  const [genres, setGenres] = useState<GenreDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<GenreDto | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reload = () => {
    setLoadError(false);
    mediaService.genres().then(setGenres).catch(() => setLoadError(true));
  };
  useEffect(reload, []);

  const openModal = (genre: GenreDto | null) => {
    setEditing(genre);
    setName(genre?.name ?? '');
    setSaving(false);
  };
  const closeModal = () => {
    setEditing(null);
    setName('');
  };
  // openCreate uses null; use a sentinel: editing===null means closed. Use separate flag.
  const [modalOpen, setModalOpen] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await mediaService.updateGenre(editing.id, name.trim());
        success(t('admin.genres.updated'));
      } else {
        await mediaService.createGenre(name.trim());
        success(t('admin.genres.created'));
      }
      closeModal();
      setModalOpen(false);
      reload();
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const remove = (genre: GenreDto) => {
    setConfirmState({
      title: t('common.delete'),
      message: `${t('admin.genres.deleteConfirm')} «${genre.name}»`,
      action: async () => {
        setConfirmBusy(true);
        try {
          await mediaService.deleteGenre(genre.id);
          success(t('admin.genres.deleted'));
          setConfirmState(null);
          reload();
        } catch (err) {
          errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const columns: Column<GenreDto>[] = [
    { key: 'id', label: 'ID', sortable: true, className: 'w-20' },
    { key: 'name', label: t('admin.genres.name'), sortable: true },
  ];

  return (
    <section>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            openModal(null);
            setModalOpen(true);
          }}
          className={primaryBtn}
        >
          + {t('admin.genres.add')}
        </button>
      </div>

      {genres === null ? (
        loadError ? (
          <EmptyState icon="⚠️" title={t('admin.loadError')} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <AdminTable
          columns={columns}
          rows={genres}
          rowKey={(g) => g.id}
          emptyMessage={t('admin.genres.empty')}
          actions={(g) => (
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  openModal(g);
                  setModalOpen(true);
                }}
                className={`${ghostBtn} !px-2.5 !py-1 !text-xs`}
              >
                {t('common.edit')}
              </button>
              <button type="button" onClick={() => remove(g)} className="cursor-pointer rounded-lg border border-cinema-border px-2.5 py-1 text-xs font-semibold text-cinema-red transition hover:border-cinema-red/60">
                {t('common.delete')}
              </button>
            </div>
          )}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          closeModal();
        }}
        title={editing ? t('admin.genres.edit') : t('admin.genres.add')}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                closeModal();
              }}
              className={ghostBtn}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" form="genre-form" className={primaryBtn} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </>
        }
      >
        <form id="genre-form" onSubmit={submit}>
          <label htmlFor="genre-name" className={labelClass}>
            {t('admin.genres.name')}
          </label>
          <input id="genre-name" type="text" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required autoFocus />
        </form>
      </Modal>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} busy={confirmBusy} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Generic dictionary tab (FR-37/38/39): countries, directors
// ---------------------------------------------------------------------------
interface DictionaryRow {
  id: number;
  name: string;
}

function DictionaryTab({
  i18nPrefix,
  load,
  create,
  update,
  remove,
}: {
  i18nPrefix: string;
  load: () => Promise<DictionaryRow[]>;
  create: (name: string) => Promise<unknown>;
  update: (id: number, name: string) => Promise<unknown>;
  remove: (id: number) => Promise<void>;
}) {
  const { t } = useLanguage();
  const { success, error: errorToast } = useToast();
  const [rows, setRows] = useState<DictionaryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DictionaryRow | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reload = () => {
    setLoadError(false);
    load().then(setRows).catch(() => setLoadError(true));
  };
  useEffect(reload, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await update(editing.id, name.trim());
        success(t(`${i18nPrefix}.updated`));
      } else {
        await create(name.trim());
        success(t(`${i18nPrefix}.created`));
      }
      setModalOpen(false);
      setEditing(null);
      setName('');
      reload();
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const removeRow = (row: DictionaryRow) => {
    setConfirmState({
      title: t('common.delete'),
      message: `${t(`${i18nPrefix}.deleteConfirm`)} «${row.name}»`,
      action: async () => {
        setConfirmBusy(true);
        try {
          await remove(row.id);
          success(t(`${i18nPrefix}.deleted`));
          setConfirmState(null);
          reload();
        } catch (err) {
          errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const columns: Column<DictionaryRow>[] = [
    { key: 'id', label: 'ID', sortable: true, className: 'w-20' },
    { key: 'name', label: t(`${i18nPrefix}.name`), sortable: true },
  ];

  return (
    <section>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setName('');
            setModalOpen(true);
          }}
          className={primaryBtn}
        >
          + {t(`${i18nPrefix}.add`)}
        </button>
      </div>

      {rows === null ? (
        loadError ? (
          <EmptyState icon="⚠️" title={t('admin.loadError')} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <AdminTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyMessage={t(`${i18nPrefix}.empty`)}
          actions={(r) => (
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditing(r);
                  setName(r.name);
                  setModalOpen(true);
                }}
                className={`${ghostBtn} !px-2.5 !py-1 !text-xs`}
              >
                {t('common.edit')}
              </button>
              <button
                type="button"
                onClick={() => removeRow(r)}
                className="cursor-pointer rounded-lg border border-cinema-border px-2.5 py-1 text-xs font-semibold text-cinema-red transition hover:border-cinema-red/60"
              >
                {t('common.delete')}
              </button>
            </div>
          )}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t(`${i18nPrefix}.edit`) : t(`${i18nPrefix}.add`)}
        footer={
          <>
            <button type="button" onClick={() => setModalOpen(false)} className={ghostBtn} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="dict-form" className={primaryBtn} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </>
        }
      >
        <form id="dict-form" onSubmit={submit}>
          <label htmlFor="dict-name" className={labelClass}>
            {t(`${i18nPrefix}.name`)}
          </label>
          <input id="dict-name" type="text" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required autoFocus />
        </form>
      </Modal>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} busy={confirmBusy} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Actors tab
// ---------------------------------------------------------------------------
function ActorsTab() {
  const { t } = useLanguage();
  const { success, error: errorToast } = useToast();
  const [actors, setActors] = useState<ActorDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ActorDto | null>(null);
  const [name, setName] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reload = () => {
    setLoadError(false);
    mediaService.actors().then(setActors).catch(() => setLoadError(true));
  };
  useEffect(reload, []);

  const openModal = (actor: ActorDto | null) => {
    setEditing(actor);
    setName(actor?.name ?? '');
    setPhotoUrl(actor?.photoUrl ?? '');
    setPhotoFile(null);
  };
  const closeModal = () => setModalOpen(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await mediaService.updateActor(editing.id, name.trim(), photoUrl.trim(), photoFile);
        success(t('admin.actors.updated'));
      } else {
        await mediaService.createActor(name.trim(), photoUrl.trim() || undefined, photoFile);
        success(t('admin.actors.created'));
      }
      closeModal();
      reload();
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const remove = (actor: ActorDto) => {
    setConfirmState({
      title: t('common.delete'),
      message: `${t('admin.actors.deleteConfirm')} «${actor.name}»`,
      action: async () => {
        setConfirmBusy(true);
        try {
          await mediaService.deleteActor(actor.id);
          success(t('admin.actors.deleted'));
          setConfirmState(null);
          reload();
        } catch (err) {
          errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const columns: Column<ActorDto>[] = [
    {
      key: 'name',
      label: t('admin.actors.name'),
      sortable: true,
      render: (a) => (
        <div className="flex items-center gap-3">
          {a.photoUrl ? (
            <img src={resolveMediaUrl(a.photoUrl)} alt="" className="h-9 w-9 rounded-full border border-cinema-border object-cover" loading="lazy" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cinema-amber/70 to-cinema-red/70 text-xs font-bold text-cinema-ink">
              {a.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-semibold text-cinema-text">{a.name}</span>
        </div>
      ),
    },
    {
      key: 'photoUrl',
      label: t('admin.actors.photo'),
      render: (a) => <span className="text-xs text-cinema-muted">{t(a.photoUrl ? 'images.added' : 'images.notSet')}</span>,
    },
  ];

  return (
    <section>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            openModal(null);
            setModalOpen(true);
          }}
          className={primaryBtn}
        >
          + {t('admin.actors.add')}
        </button>
      </div>

      {actors === null ? (
        loadError ? (
          <EmptyState icon="⚠️" title={t('admin.loadError')} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <AdminTable
          columns={columns}
          rows={actors}
          rowKey={(a) => a.id}
          emptyMessage={t('admin.actors.empty')}
          actions={(a) => (
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  openModal(a);
                  setModalOpen(true);
                }}
                className={`${ghostBtn} !px-2.5 !py-1 !text-xs`}
              >
                {t('common.edit')}
              </button>
              <button type="button" onClick={() => remove(a)} className="cursor-pointer rounded-lg border border-cinema-border px-2.5 py-1 text-xs font-semibold text-cinema-red transition hover:border-cinema-red/60">
                {t('common.delete')}
              </button>
            </div>
          )}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? t('admin.actors.edit') : t('admin.actors.add')}
        footer={
          <>
            <button type="button" onClick={closeModal} className={ghostBtn} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="actor-form" className={primaryBtn} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </>
        }
      >
        <form id="actor-form" onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="actor-name" className={labelClass}>
              {t('admin.actors.name')}
            </label>
            <input id="actor-name" type="text" maxLength={255} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} required autoFocus />
          </div>
          <ImageField id="actor-photo" label={t('admin.actors.photo')} value={photoUrl} file={photoFile}
            onFileChange={setPhotoFile} onUrlChange={setPhotoUrl} disabled={saving} />
        </form>
      </Modal>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} busy={confirmBusy} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------
function UsersTab() {
  const { t, lang } = useLanguage();
  const { user: me } = useAuth();
  const { success, error: errorToast } = useToast();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<UserDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const reload = (p = page) => {
    setLoading(true);
    setLoadError(false);
    usersService
      .list({ page: p, limit: PAGE_SIZE, search: debouncedSearch.trim() || undefined })
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [debouncedSearch, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = (updated: UserDto) =>
    setData((prev) => (prev ? { ...prev, items: prev.items.map((u) => (u.id === updated.id ? updated : u)) } : prev));

  const changeRole = async (u: UserDto, role: Role) => {
    try {
      const updated = await usersService.changeRole(u.id, role);
      updateRow(updated);
      success(t('admin.users.roleChanged'));
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    }
  };

  const setBlocked = async (u: UserDto, isBlocked: boolean) => {
    try {
      const updated = await usersService.setBlocked(u.id, isBlocked);
      updateRow(updated);
      success(t('admin.users.statusChanged'));
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    }
  };

  const removeUser = (u: UserDto) => {
    setConfirmState({
      title: t('admin.users.delete'),
      message: `${t('admin.users.deleteConfirm')}\n${u.name} (${u.email})`,
      action: async () => {
        setConfirmBusy(true);
        try {
          await usersService.remove(u.id);
          success(t('admin.users.deleted'));
          setConfirmState(null);
          reload();
        } catch (err) {
          errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const columns: Column<UserDto>[] = [
    {
      key: 'name',
      label: t('admin.users.name'),
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-3">
          {u.avatarUrl ? (
            <img src={resolveMediaUrl(u.avatarUrl)} alt="" className="h-8 w-8 shrink-0 rounded-full border border-cinema-border object-cover" loading="lazy" />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cinema-amber/70 to-cinema-red/70 text-xs font-bold text-cinema-ink">
              {u.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-cinema-text">
              {u.name}
              {me?.id === u.id && (
                <span className="ml-2 rounded-full bg-cinema-card px-2 py-0.5 text-[10px] font-bold text-cinema-accent">{t('common.you')}</span>
              )}
            </p>
            <p className="truncate text-xs text-cinema-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: t('admin.users.role'),
      render: (u) => (
        <select
          value={u.role}
          disabled={me?.id === u.id}
          onChange={(e) => void changeRole(u, e.target.value as Role)}
          aria-label={t('admin.users.role')}
          className="cursor-pointer rounded-md border border-cinema-border bg-cinema-black/60 px-2 py-1 text-xs font-semibold text-cinema-soft accent-cinema-amber disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="viewer">{t('admin.users.roleViewer')}</option>
          <option value="admin">{t('admin.users.roleAdmin')}</option>
        </select>
      ),
    },
    {
      key: 'isBlocked',
      label: t('admin.users.status'),
      sortable: true,
      render: (u) => (
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold ${u.isBlocked ? 'bg-cinema-red/15 text-cinema-red' : 'bg-cinema-success-surface/50 text-cinema-success'}`}
        >
          {u.isBlocked ? t('admin.users.blocked') : t('admin.users.active')}
        </span>
      ),
    },
    {
      key: 'hasActiveSubscription',
      label: t('profile.subscription.title'),
      sortable: true,
      render: (u) => (
        <span className="text-xs text-cinema-muted">
          {u.hasActiveSubscription ? `${t('tier.' + (u.activeSubscription?.tier ?? 'basic'))}` : t('subscription.none')}
        </span>
      ),
      className: 'hidden lg:table-cell',
    },
    {
      key: 'createdAt',
      label: t('admin.users.joined'),
      sortable: true,
      render: (u) => new Date(u.createdAt).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US'),
      className: 'hidden md:table-cell',
    },
    {
      key: 'lastLoginAt',
      label: t('admin.users.lastLogin'),
      sortable: true,
      render: (u) =>
        u.lastLoginAt
          ? new Date(u.lastLoginAt).toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : t('admin.users.never'),
      className: 'hidden lg:table-cell',
    },
  ];

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t('admin.users.search')}
          className={`${inputClass} max-w-xs`}
          aria-label={t('common.search')}
        />
        <span className="flex-1 text-sm text-cinema-muted">{data ? t('admin.users.total', { count: data.total }) : ''}</span>
      </div>

      {loading && !data ? (
        <LoadingBlock />
      ) : loadError ? (
        <EmptyState
          icon="⚠️"
          title={t('admin.loadError')}
          action={
            <button type="button" onClick={() => reload()} className={primaryBtn}>
              {t('common.retry')}
            </button>
          }
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(u) => u.id}
            emptyMessage={t('admin.users.empty')}
            actions={(u) => (
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  disabled={me?.id === u.id}
                  onClick={() => void setBlocked(u, !u.isBlocked)}
                  className={`${ghostBtn} !px-2.5 !py-1 !text-xs`}
                >
                  {u.isBlocked ? t('admin.users.unblock') : t('admin.users.block')}
                </button>
                <button
                  type="button"
                  disabled={me?.id === u.id}
                  onClick={() => removeUser(u)}
                  aria-label={t('admin.users.delete')}
                  className="cursor-pointer rounded-lg border border-cinema-border p-1.5 text-cinema-soft transition hover:border-cinema-red/60 hover:text-cinema-red disabled:cursor-default disabled:opacity-30"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}
          />
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={ghostBtn}>
                ← {t('common.prev')}
              </button>
              <span className="text-cinema-muted">
                {page} / {totalPages}
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={ghostBtn}>
                {t('common.next')} →
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} busy={confirmBusy} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Analytics tab
// ---------------------------------------------------------------------------
function AnalyticsTab() {
  const { t } = useLanguage();
  const [intervalDays, setIntervalDays] = useState(30);
  const [data, setData] = useState<AnalyticsDto | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError(false);
    adminService
      .analytics(intervalDays)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [intervalDays]);

  const cards = useMemo(
    () => [
      { key: 'totalUsers', icon: '👥', value: data?.totalUsers },
      { key: 'totalMovies', icon: '🎬', value: data?.totalMovies },
      { key: 'activeSubscriptions', icon: '💳', value: data?.activeSubscriptions },
      { key: 'newUsersInPeriod', icon: '✨', value: data?.newUsersInPeriod },
      { key: 'viewsInPeriod', icon: '▶', value: data?.viewsInPeriod },
      { key: 'averageRatingInPeriod', icon: '★', value: data?.averageRatingInPeriod },
    ],
    [data],
  );

  if (loadError) return <EmptyState icon="⚠️" title={t('admin.loadError')} />;
  if (!data) return <LoadingBlock />;

  return (
    <section className="space-y-8">
      {/* interval selector (FR-44) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-cinema-muted">{t('admin.analytics.interval')}</span>
        {ANALYTICS_INTERVALS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setIntervalDays(d)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              intervalDays === d ? 'bg-cinema-amber text-cinema-ink' : 'border border-cinema-border text-cinema-soft hover:border-cinema-amber/60'
            }`}
          >
            {t('admin.analytics.lastDays', { count: d })}
          </button>
        ))}
      </div>

      <p className="text-sm text-cinema-muted">{t('admin.analytics.periodHint')}</p>

      {/* stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.key} className="rounded-2xl border border-cinema-border bg-cinema-panel/60 p-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-cinema-muted">{t(`admin.analytics.${c.key}`)}</span>
              <span className="text-2xl">{c.icon}</span>
            </div>
            <p className="text-3xl font-extrabold text-cinema-strong">{c.value?.toLocaleString() ?? '—'}</p>
          </div>
        ))}
      </div>

      {/* top movies */}
      <div>
        <h2 className="mb-3 text-lg font-bold text-cinema-text">{t('admin.analytics.topMovies')}</h2>
        <AdminTable
          columns={[
            { key: 'title', label: t('admin.analytics.movie') },
            { key: 'viewCount', label: t('admin.analytics.views'), sortable: true, render: (m) => m.viewCount.toLocaleString() },
            { key: 'averageRating', label: t('admin.analytics.rating'), sortable: true, render: (m) => (m.averageRating > 0 ? `★ ${m.averageRating.toFixed(1)}` : '—') },
          ]}
          rows={data.topMovies}
          rowKey={(m) => m.id}
          emptyMessage={t('admin.movies.empty')}
        />
      </div>

      {/* genre popularity (FR-44) */}
      <div>
        <h2 className="mb-3 text-lg font-bold text-cinema-text">{t('admin.analytics.genrePopularity')}</h2>
        <AdminTable
          columns={[
            { key: 'genre', label: t('admin.analytics.genre'), sortable: true },
            { key: 'views', label: t('admin.analytics.views'), sortable: true, render: (g) => g.views.toLocaleString() },
            { key: 'movies', label: t('admin.analytics.moviesCount'), sortable: true },
            {
              key: 'averageRating',
              label: t('admin.analytics.rating'),
              sortable: true,
              render: (g) => (g.averageRating > 0 ? `★ ${g.averageRating.toFixed(1)}` : '—'),
            },
          ]}
          rows={data.genrePopularity}
          rowKey={(g) => g.genre}
          emptyMessage={t('admin.movies.empty')}
        />
      </div>

      {/* revenue by month */}
      <div>
        <h2 className="mb-3 text-lg font-bold text-cinema-text">{t('admin.analytics.revenueByMonth')}</h2>
        {data.revenueByMonth.length === 0 ? (
          <EmptyState icon="📉" title={t('admin.analytics.noRevenue')} />
        ) : (
          <AdminTable
            columns={[
              { key: 'month', label: t('admin.analytics.month'), sortable: true },
              { key: 'total', label: t('admin.analytics.revenue'), sortable: true, render: (r) => formatPrice(r.total) },
            ]}
            rows={[...data.revenueByMonth].reverse()}
            rowKey={(r) => r.month}
            emptyMessage={t('admin.analytics.noRevenue')}
          />
        )}
      </div>
    </section>
  );
}

