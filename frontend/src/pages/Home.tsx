import { Clapperboard, Sparkles, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { mediaService } from '@/services/mediaService';
import { Carousel } from '@/components/Carousel';
import { MovieCard } from '@/components/MovieCard';
import { RowSkeleton, LoadingBlock } from '@/components/Spinner';
import { posterGradient } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/url';
import type { GenreDto, MovieDto, WatchProgressDto } from '@/types';

interface GenreRow {
  genre: GenreDto;
  movies: MovieDto[];
}

export default function Home() {
  const { t } = useLanguage();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const [popular, setPopular] = useState<MovieDto[] | null>(null);
  const [newest, setNewest] = useState<MovieDto[] | null>(null);
  const [recommended, setRecommended] = useState<MovieDto[] | null>(null);
  const [progress, setProgress] = useState<WatchProgressDto[] | null>(null);
  const [genreRows, setGenreRows] = useState<GenreRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [favOverrides, setFavOverrides] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pop, fresh, genres] = await Promise.all([
          mediaService.list({ sort: 'popularity', limit: 14, page: 1 }),
          mediaService.list({ sort: 'newest', limit: 14, page: 1 }),
          mediaService.genres(),
        ]);
        if (cancelled) return;
        setPopular(pop.items);
        setNewest(fresh.items);

        // one carousel per genre (up to 4 genres)
        const topGenres = genres.slice(0, 4);
        const rows = await Promise.all(
          topGenres.map(async (genre) => ({
            genre,
            movies: (await mediaService.list({ genre: genre.name, sort: 'popularity', limit: 12, page: 1 })).items,
          })),
        );
        if (cancelled) return;
        setGenreRows(rows);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    mediaService
      .recommendations()
      .then((r) => !cancelled && setRecommended(r))
      .catch(() => !cancelled && setRecommended([]));
    mediaService
      .progress()
      .then((r) => !cancelled && setProgress(r))
      .catch(() => !cancelled && setProgress([]));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const onToggleFavorite = (movie: MovieDto, isFavorite: boolean) => {
    const patch = (m: MovieDto): MovieDto => (m.id === movie.id ? { ...m, isFavorite } : m);
    setPopular((prev) => prev?.map(patch) ?? prev);
    setNewest((prev) => prev?.map(patch) ?? prev);
    setRecommended((prev) => prev?.map(patch) ?? prev);
    setGenreRows((prev) => prev?.map((row) => ({ ...row, movies: row.movies.map(patch) })) ?? prev);
    setFavOverrides((prev) => ({ ...prev, [movie.id]: isFavorite }));
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-20 text-center">
        <p className="mb-4 text-lg text-cinema-muted">{t('errors.server')}</p>
        <Link to="/" className="rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink">
          {t('common.retry')}
        </Link>
      </div>
    );
  }

  const hero = popular?.[0];
  const continueWatching = (progress ?? [])
    .filter((p) => p.durationSeconds > 0 && p.positionSeconds < p.durationSeconds - 30)
    .slice(0, 10);
  const continueWatchingMovies: MovieDto[] = continueWatching.map((p) => ({
    id: p.movieId,
    isHidden: false,
    title: p.movieTitle,
    originalTitle: '',
    description: '',
    year: p.year,
    country: '',
    countryId: null,
    ageRating: '',
    director: '',
    directorId: null,
    runtimeMinutes: null,
    trailerUrl: null,
    keywords: [],
    posterUrl: p.posterUrl,
    masterVideoUrl: null,
    transcodeStatus: 'none',
    genres: p.genres,
    actors: [],
    viewCount: 0,
    averageRating: 0,
    userRating: null,
    isFavorite: favOverrides[p.movieId] ?? false,
    availableQualities: [],
    createdAt: '',
  }));

  return (
    <div className="pb-10">
      {/* hero banner */}
      {hero ? (
        <section className="media-surface relative mb-10 overflow-hidden bg-cinema-black text-cinema-text">
          <div className="absolute inset-0">
            {hero.posterUrl ? (
              <img
                src={resolveMediaUrl(hero.posterUrl)}
                alt=""
                className="h-full w-full scale-110 object-cover object-top opacity-40 blur-sm"
              />
            ) : (
              <div className={`h-full w-full bg-gradient-to-br ${posterGradient(hero.id)} opacity-60`} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-cinema-black via-cinema-black/70 to-cinema-black/30" />
            <div className="absolute inset-0 bg-gradient-to-r from-cinema-black via-transparent to-transparent" />
          </div>
          <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-16 sm:flex-row sm:items-end sm:py-24">
            <div className="w-36 shrink-0 overflow-hidden rounded-xl border border-cinema-border shadow-card sm:w-48">
              {hero.posterUrl ? (
                <img src={resolveMediaUrl(hero.posterUrl)} alt={hero.title} className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className={`flex aspect-[2/3] items-center justify-center bg-gradient-to-br text-4xl ${posterGradient(hero.id)}`}><Clapperboard size={40} aria-hidden="true" className="shrink-0" /></div>
              )}
            </div>
            <div className="max-w-xl">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-cinema-accent">{t('home.featured')}</p>
              <h1 className="mb-3 text-3xl font-extrabold text-cinema-strong sm:text-5xl">{hero.title}</h1>
              <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-cinema-soft">
                {hero.year > 0 && <span>{hero.year}</span>}
                {hero.averageRating > 0 && <span className="font-bold text-cinema-accent"><Star size={14} aria-hidden="true" className="inline-block shrink-0 align-middle" /> {hero.averageRating.toFixed(1)}</span>}
                {hero.ageRating && <span className="rounded border border-cinema-border px-1.5 py-0.5 text-xs">{hero.ageRating}</span>}
                {hero.genres.slice(0, 3).map((g) => (
                  <span key={g.id} className="text-cinema-muted">{g.name}</span>
                ))}
              </p>
              <p className="mb-6 line-clamp-3 text-sm leading-relaxed text-cinema-soft sm:text-base">{hero.description}</p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to={`/movie/${hero.id}?play=1#movie-player`}
                  className="flex items-center gap-2 rounded-lg bg-cinema-amber px-6 py-3 font-bold text-cinema-ink transition hover:bg-cinema-amber/90 hover:shadow-glow"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                  {t('home.watchNow')}
                </Link>
                <Link
                  to={`/movie/${hero.id}`}
                  className="rounded-lg border border-cinema-border bg-cinema-black/60 px-6 py-3 font-semibold text-cinema-text backdrop-blur transition hover:border-cinema-amber/60"
                >
                  {t('home.moreInfo')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="mx-auto max-w-7xl px-4 pt-16">
          <LoadingBlock />
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4">
        {/* continue watching (auth) */}
        {isAuthenticated && continueWatchingMovies.length > 0 && (
          <Carousel title={t('home.continueWatching')}>
            {continueWatchingMovies.map((m) => {
              const p = continueWatching.find((x) => x.movieId === m.id)!;
              return <MovieCard key={m.id} movie={m} progressPercent={(p.positionSeconds / p.durationSeconds) * 100} onToggleFavorite={onToggleFavorite} />;
            })}
          </Carousel>
        )}

        {/* recommended */}
        {isAuthenticated && recommended === null && <RowSkeleton />}
        {isAuthenticated && recommended !== null && recommended.length > 0 && (
          <Carousel title={t('home.recommendedForYou')}>
            {recommended.map((m) => (
              <MovieCard key={m.id} movie={m} onToggleFavorite={onToggleFavorite} />
            ))}
          </Carousel>
        )}
        {!authLoading && !isAuthenticated && (
          <section className="mb-10 flex flex-col items-start gap-4 rounded-2xl border border-cinema-amber/30 bg-gradient-to-r from-cinema-card via-cinema-panel to-cinema-panel p-6 sm:flex-row sm:items-center">
            <span className="text-3xl"><Sparkles size="1em" aria-hidden="true" className="inline-block shrink-0 align-middle" /></span>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-cinema-text">{t('home.recommendedTitle')}</h2>
              <p className="text-sm text-cinema-muted">{t('home.recommendedSubtitle')}</p>
            </div>
            <Link to="/login" className="rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink transition hover:shadow-glow">
              {t('nav.login')}
            </Link>
          </section>
        )}

        {popular === null ? <RowSkeleton /> : popular.length > 0 && (
          <Carousel title={t('home.popular')} action={<Link to="/catalog?sort=popularity" className="text-sm font-semibold text-cinema-accent hover:underline">{t('common.viewAll')}</Link>}>
            {popular.map((m) => <MovieCard key={m.id} movie={m} onToggleFavorite={onToggleFavorite} />)}
          </Carousel>
        )}

        {newest === null ? <RowSkeleton /> : newest.length > 0 && (
          <Carousel title={t('home.newReleases')} action={<Link to="/catalog?sort=newest" className="text-sm font-semibold text-cinema-accent hover:underline">{t('common.viewAll')}</Link>}>
            {newest.map((m) => <MovieCard key={m.id} movie={m} onToggleFavorite={onToggleFavorite} />)}
          </Carousel>
        )}

        {genreRows === null && <RowSkeleton />}
        {genreRows?.map((row) =>
          row.movies.length > 0 ? (
            <Carousel
              key={row.genre.id}
              title={row.genre.name}
              action={<Link to={`/catalog?genre=${encodeURIComponent(row.genre.name)}`} className="text-sm font-semibold text-cinema-accent hover:underline">{t('common.viewAll')}</Link>}
            >
              {row.movies.map((m) => <MovieCard key={m.id} movie={m} onToggleFavorite={onToggleFavorite} />)}
            </Carousel>
          ) : null,
        )}
      </div>
    </div>
  );
}
