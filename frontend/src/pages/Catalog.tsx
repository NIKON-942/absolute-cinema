import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useDebounce } from '@/hooks/useDebounce';
import { mediaService } from '@/services/mediaService';
import { MovieCard } from '@/components/MovieCard';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { AGE_RATINGS } from '@/utils/ageRatings';
import type { CountryDto, GenreDto, MovieDto, MovieSort, Paginated } from '@/types';

const PAGE_SIZE = 20;

const inputClass =
  'w-full rounded-lg border border-cinema-border bg-cinema-panel px-3 py-2 text-sm text-cinema-text placeholder:text-cinema-muted focus:border-cinema-amber/60 focus:outline-none';

export default function Catalog() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  // form state (search text is debounced before hitting the API)
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const debouncedSearch = useDebounce(search, 400);

  const genre = searchParams.get('genre') ?? '';
  const year = searchParams.get('year') ?? '';
  const yearFrom = searchParams.get('yearFrom') ?? '';
  const yearTo = searchParams.get('yearTo') ?? '';
  const country = searchParams.get('country') ?? '';
  const ageRating = searchParams.get('ageRating') ?? '';
  const sort = (searchParams.get('sort') ?? 'popularity') as MovieSort;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [genres, setGenres] = useState<GenreDto[]>([]);
  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [data, setData] = useState<Paginated<MovieDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    mediaService.genres().then(setGenres).catch(() => setGenres([]));
    mediaService.countries().then(setCountries).catch(() => setCountries([]));
  }, []);

  // keep URL in sync (shareable filter state)
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch.trim()) next.set('search', debouncedSearch.trim());
    if (genre) next.set('genre', genre);
    if (year) next.set('year', year);
    if (yearFrom) next.set('yearFrom', yearFrom);
    if (yearTo) next.set('yearTo', yearTo);
    if (country.trim()) next.set('country', country.trim());
    if (ageRating) next.set('ageRating', ageRating);
    if (sort !== 'popularity') next.set('sort', sort);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, genre, year, yearFrom, yearTo, country, ageRating, sort, page]);

  // fetch movies
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    mediaService
      .list({
        search: debouncedSearch.trim() || undefined,
        genre: genre || undefined,
        year: year ? Number(year) : undefined,
        yearFrom: yearFrom ? Number(yearFrom) : undefined,
        yearTo: yearTo ? Number(yearTo) : undefined,
        country: country.trim() || undefined,
        ageRating: ageRating || undefined,
        sort,
        page,
        limit: PAGE_SIZE,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, genre, year, yearFrom, yearTo, country, ageRating, sort, page]);

  const totalPages = useMemo(() => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1), [data]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const goPage = (p: number) => {
    setParam('page', String(p));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const hasFilters = Boolean(debouncedSearch.trim() || genre || year || yearFrom || yearTo || country.trim() || ageRating);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-cinema-text sm:text-3xl">{t('catalog.title')}</h1>
        <p className="mt-1 text-sm text-cinema-muted">
          {data ? t('catalog.foundCount', { count: data.total }) : t('common.loading')}
        </p>
      </header>

      {/* filter bar */}
      <div className="mb-8 grid grid-cols-2 gap-3 rounded-2xl border border-cinema-border bg-cinema-panel/60 p-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 md:col-span-3 lg:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.search')}</label>
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cinema-muted" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('catalog.searchPlaceholder')}
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.genre')}</label>
          <select value={genre} onChange={(e) => setParam('genre', e.target.value)} className={inputClass}>
            <option value="">{t('catalog.allGenres')}</option>
            {genres.map((g) => (
              <option key={g.id} value={g.name}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.yearFrom')}</label>
            <input
              type="number"
              min={1900}
              max={2030}
              value={yearFrom}
              onChange={(e) => setParam('yearFrom', e.target.value)}
              placeholder={t('catalog.anyYear')}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.yearTo')}</label>
            <input
              type="number"
              min={1900}
              max={2030}
              value={yearTo}
              onChange={(e) => setParam('yearTo', e.target.value)}
              placeholder={t('catalog.anyYear')}
              className={inputClass}
            />
          </div>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.country')}</label>
          <select value={country} onChange={(e) => setParam('country', e.target.value)} className={inputClass}>
            <option value="">{t('catalog.anyCountry')}</option>
            {countries.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.ageRating')}</label>
          <select value={ageRating} onChange={(e) => setParam('ageRating', e.target.value)} className={inputClass}>
            <option value="">{t('catalog.anyRating')}</option>
            {AGE_RATINGS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2 md:col-span-1 lg:col-span-2 lg:col-start-6">
          <label className="mb-1 block text-xs font-semibold text-cinema-muted">{t('catalog.sort')}</label>
          <div className="flex gap-2">
            <select value={sort} onChange={(e) => setParam('sort', e.target.value)} className={inputClass}>
              <option value="popularity">{t('catalog.sortPopularity')}</option>
              <option value="rating">{t('catalog.sortRating')}</option>
              <option value="newest">{t('catalog.sortNewest')}</option>
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="shrink-0 cursor-pointer rounded-lg border border-cinema-border px-3 text-xs font-semibold text-cinema-muted transition hover:border-cinema-red/50 hover:text-cinema-red"
              >
                {t('catalog.reset')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* results */}
      {error ? (
        <EmptyState icon="⚠️" title={t('errors.server')} />
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-cinema-border bg-cinema-card">
              <div className="aspect-[2/3] w-full animate-pulse bg-cinema-panel" />
            </div>
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('catalog.noResults')} subtitle={t('catalog.noResultsHint')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.items.map((m) => (
              <div key={m.id} className="flex">
                <MovieCard movie={m} />
              </div>
            ))}
          </div>

          {/* pagination */}
          {totalPages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-2" aria-label={t('catalog.pagination')}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
                className="cursor-pointer rounded-lg border border-cinema-border px-3 py-2 text-sm text-cinema-soft transition hover:border-cinema-amber/60 disabled:cursor-default disabled:opacity-30"
              >
                ← {t('catalog.prev')}
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center gap-2">
                    {idx > 0 && p - arr[idx - 1] > 1 && <span className="text-cinema-muted">…</span>}
                    <button
                      type="button"
                      onClick={() => goPage(p)}
                      aria-current={p === page ? 'page' : undefined}
                      className={`h-9 w-9 cursor-pointer rounded-lg text-sm font-bold transition ${
                        p === page ? 'bg-cinema-amber text-cinema-ink' : 'border border-cinema-border text-cinema-soft hover:border-cinema-amber/60'
                      }`}
                    >
                      {p}
                    </button>
                  </span>
                ))}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => goPage(page + 1)}
                className="cursor-pointer rounded-lg border border-cinema-border px-3 py-2 text-sm text-cinema-soft transition hover:border-cinema-amber/60 disabled:cursor-default disabled:opacity-30"
              >
                {t('catalog.next')} →
              </button>
            </nav>
          )}
          {loading && data && <div className="mt-6 flex justify-center"><Spinner /></div>}
        </>
      )}
    </div>
  );
}
