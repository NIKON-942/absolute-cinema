import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { mediaService } from '@/services/mediaService';
import { extractServerMessage, errorStatusKey } from '@/services/api';
import { RatingStars } from '@/components/RatingStars';
import { MovieCard } from '@/components/MovieCard';
import { LoadingBlock } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { posterGradient } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/url';
import type { MovieDto } from '@/types';

export default function MovieDetails() {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const { success, error: errorToast } = useToast();
  const navigate = useNavigate();

  const [movie, setMovie] = useState<MovieDto | null>(null);
  const [similar, setSimilar] = useState<MovieDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setMovie(null);
    setSimilar([]);
    mediaService
      .getById(movieId)
      .then((m) => {
        if (cancelled) return;
        setMovie(m);
        mediaService
          .similar(movieId)
          .then((s) => !cancelled && setSimilar(s))
          .catch(() => undefined);
      })
      .catch((err) => {
        if (cancelled) return;
        if (errorStatusKey(err) === 'errors.notFound') setNotFound(true);
        else errorToast(t(errorStatusKey(err)));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [movieId, t, errorToast]);

  if (loading) {
    return (
      <div className="min-h-[60vh]">
        <LoadingBlock />
      </div>
    );
  }
  if (notFound || !movie) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState
          icon="🎞️"
          title={t('movie.notFound')}
          action={<Link to="/catalog" className="rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-black">{t('common.backToCatalog')}</Link>}
        />
      </div>
    );
  }

  const handleRate = async (value: number) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/movie/${movie.id}` } });
      return;
    }
    try {
      const res = await mediaService.rate(movie.id, value);
      setMovie((prev) => (prev ? { ...prev, averageRating: res.averageRating, userRating: res.userRating } : prev));
      success(t('movie.rated', { value }));
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    }
  };

  const handleClearRating = async () => {
    try {
      const res = await mediaService.removeRating(movie.id);
      setMovie((prev) => (prev ? { ...prev, averageRating: res.averageRating, userRating: res.userRating } : prev));
      success(t('movie.ratingCleared'));
    } catch (err) {
      errorToast(extractServerMessage(err) ?? t(errorStatusKey(err)));
    }
  };

  const handleFavorite = async () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/movie/${movie.id}` } });
      return;
    }
    try {
      const res = await mediaService.toggleFavorite(movie.id);
      setMovie((prev) => (prev ? { ...prev, isFavorite: res.isFavorite } : prev));
      success(res.isFavorite ? t('favorites.added') : t('favorites.removed'));
    } catch {
      errorToast(t('favorites.error'));
    }
  };

  const canWatch = Boolean(user?.hasActiveSubscription);
  const watchBlocked = isAuthenticated && !canWatch;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
        {/* poster column */}
        <div>
          <div className="overflow-hidden rounded-2xl border border-cinema-border shadow-card">
            {movie.posterUrl ? (
              <img src={resolveMediaUrl(movie.posterUrl)} alt={movie.title} className="aspect-[2/3] w-full object-cover" />
            ) : (
              <div className={`flex aspect-[2/3] w-full flex-col items-center justify-center gap-3 bg-gradient-to-br p-6 text-center ${posterGradient(movie.id)}`}>
                <span className="text-5xl">🎬</span>
                <span className="font-semibold text-slate-200">{movie.title}</span>
              </div>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {canWatch ? (
              <Link
                to={`/watch/${movie.id}`}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-cinema-red px-6 py-3.5 font-bold text-white transition hover:bg-cinema-red/85 hover:shadow-glow"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                {t('movie.watch')}
              </Link>
            ) : watchBlocked ? (
              <Link
                to="/plans"
                className="flex w-full flex-col items-center gap-1 rounded-xl border border-cinema-amber/50 bg-cinema-amber/10 px-6 py-3.5 text-center transition hover:bg-cinema-amber/20"
              >
                <span className="font-bold text-cinema-amber">🔒 {t('movie.subscribeToWatch')}</span>
                <span className="text-xs text-cinema-muted">{t('movie.subscribeHint')}</span>
              </Link>
            ) : (
              <Link
                to="/plans"
                className="flex w-full flex-col items-center gap-1 rounded-xl border border-cinema-amber/50 bg-cinema-amber/10 px-6 py-3.5 text-center transition hover:bg-cinema-amber/20"
              >
                <span className="font-bold text-cinema-amber">🔒 {t('movie.subscribeToWatch')}</span>
                <span className="text-xs text-cinema-muted">{t('movie.subscribeHintGuest')}</span>
              </Link>
            )}

            <button
              type="button"
              onClick={handleFavorite}
              className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border px-6 py-3 font-semibold transition ${
                movie.isFavorite
                  ? 'border-cinema-red/60 bg-cinema-red/15 text-cinema-red'
                  : 'border-cinema-border bg-cinema-panel text-slate-200 hover:border-cinema-red/50 hover:text-cinema-red'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={movie.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {movie.isFavorite ? t('movie.inFavorites') : t('movie.addToFavorites')}
            </button>
          </div>
        </div>

        {/* info column */}
        <div>
          <h1 className="text-3xl font-extrabold text-slate-50 sm:text-4xl">{movie.title}</h1>
          {movie.originalTitle && movie.originalTitle !== movie.title && (
            <p className="mt-1 text-base text-cinema-muted">{movie.originalTitle}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300">
            {movie.year > 0 && <span>{movie.year}</span>}
            {movie.country && <span>{movie.country}</span>}
            {movie.runtimeMinutes ? (
              <span>
                {Math.floor(movie.runtimeMinutes / 60) > 0 && `${Math.floor(movie.runtimeMinutes / 60)}h `}
                {movie.runtimeMinutes % 60}min
              </span>
            ) : null}
            {movie.ageRating && (
              <span className="rounded border border-cinema-border px-2 py-0.5 text-xs font-semibold">{movie.ageRating}</span>
            )}
            <span>👁 {movie.viewCount.toLocaleString()}</span>
            {movie.availableQualities.length > 0 && (
              <span className="text-cinema-muted">{t('movie.qualities')}: {movie.availableQualities.join(' / ')}</span>
            )}
          </div>

          {/* genres */}
          {movie.genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {movie.genres.map((g) => (
                <Link
                  key={g.id}
                  to={`/catalog?genre=${encodeURIComponent(g.name)}`}
                  className="rounded-full border border-cinema-border bg-cinema-panel px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-cinema-amber/60 hover:text-cinema-amber"
                >
                  {g.name}
                </Link>
              ))}
            </div>
          )}

          {/* rating widget */}
          <section className="mt-6 rounded-2xl border border-cinema-border bg-cinema-panel/60 p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.ratingTitle')}</h2>
            <RatingStars
              value={movie.userRating}
              average={movie.averageRating}
              onRate={handleRate}
              onClear={handleClearRating}
              readOnly={!isAuthenticated}
            />
            {!isAuthenticated && <p className="mt-2 text-xs text-cinema-muted">{t('movie.loginToRate')}</p>}
          </section>

          {/* description */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.description')}</h2>
            <p className="whitespace-pre-line leading-relaxed text-slate-200">{movie.description || t('movie.noDescription')}</p>
          </section>

          {/* trailer */}
          {movie.trailerUrl && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.trailer')}</h2>
              {/youtube\.com|youtu\.be|vimeo\.com/.test(movie.trailerUrl) ? (
                <a
                  href={movie.trailerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-cinema-amber/50 bg-cinema-amber/10 px-5 py-2.5 font-semibold text-cinema-amber transition hover:bg-cinema-amber/20"
                >
                  ▶ {t('movie.watchTrailer')}
                </a>
              ) : (
                <video controls preload="none" src={movie.trailerUrl} className="w-full max-w-2xl rounded-xl border border-cinema-border" />
              )}
            </section>
          )}

          {/* director */}
          {movie.director && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.director')}</h2>
              <p className="font-semibold text-slate-100">{movie.director}</p>
            </section>
          )}

          {/* actors */}
          {movie.actors.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.cast')}</h2>
              <div className="flex flex-wrap gap-3">
                {movie.actors.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-full border border-cinema-border bg-cinema-panel py-1 pl-1 pr-4">
                    {a.photoUrl ? (
                      <img src={resolveMediaUrl(a.photoUrl)} alt={a.name} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cinema-amber/70 to-cinema-red/70 text-xs font-bold text-cinema-black">
                        {a.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="text-sm text-slate-200">{a.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* keywords */}
          {movie.keywords.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cinema-muted">{t('movie.keywords')}</h2>
              <div className="flex flex-wrap gap-2">
                {movie.keywords.map((k) => (
                  <span key={k} className="rounded bg-cinema-card px-2.5 py-1 text-xs text-cinema-muted">#{k}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* related movies (FR-33) */}
      {similar.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-extrabold text-slate-100">{t('movie.related')}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {similar.slice(0, 6).map((m) => (
              <div key={m.id} className="flex">
                <MovieCard movie={m} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
