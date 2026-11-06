import { ArrowLeft, Clapperboard, Eye, Film, Play, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { mediaService } from '@/services/mediaService';
import { extractServerMessage, errorStatusKey } from '@/services/api';
import { RatingStars } from '@/components/RatingStars';
import { MoviePlayback } from '@/components/MoviePlayback';
import { LoadingBlock } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { posterGradient } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/url';
import type { MovieDto } from '@/types';

export default function MovieDetails() {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const [searchParams] = useSearchParams();
  const autoPlay = searchParams.get('play') === '1';
  const { t } = useLanguage();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { success, error: errorToast } = useToast();
  const navigate = useNavigate();
  const feedback = useRef({ t, errorToast });
  feedback.current = { t, errorToast };

  const [movie, setMovie] = useState<MovieDto | null>(null);
  const [similar, setSimilar] = useState<MovieDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
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
        else feedback.current.errorToast(feedback.current.t(errorStatusKey(err)));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [movieId, authLoading, user?.id]);

  if (loading || authLoading) {
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
          icon={<Film size={40} aria-hidden="true" className="inline-block shrink-0 align-middle" />}
          title={t('movie.notFound')}
          action={<Link to="/catalog" className="rounded-lg bg-cinema-amber px-5 py-2.5 font-bold text-cinema-ink">{t('common.backToCatalog')}</Link>}
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

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(new URL(`/movie/${movie.id}`, window.location.origin).href);
      success(t('movie.linkCopied'));
    } catch {
      errorToast(t('movie.shareError'));
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link to="/catalog" className="inline-flex items-center gap-1 text-sm font-semibold text-cinema-muted hover:text-cinema-accent"><ArrowLeft size={16} aria-hidden="true" /> {t('common.backToCatalog')}</Link>
        <h1 className="mt-3 break-words text-3xl font-extrabold text-cinema-strong sm:text-4xl">{movie.title}</h1>
        {movie.originalTitle && movie.originalTitle !== movie.title && <p className="mt-1 text-cinema-muted">{movie.originalTitle}</p>}
      </header>

      <div className={`grid min-w-0 gap-8 ${similar.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_260px]' : ''}`}>
        <div className="min-w-0">
          <MoviePlayback key={`${movie.id}-${user?.id ?? 'guest'}-${user?.hasActiveSubscription ?? false}-${user?.activeSubscription?.tier ?? ''}-${autoPlay}`} initialMovie={movie} autoPlay={autoPlay} />

          <div className="mt-8 grid gap-6 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="hidden self-start overflow-hidden rounded-xl border border-cinema-border sm:block">
              {movie.posterUrl ? (
                <img src={resolveMediaUrl(movie.posterUrl)} alt={movie.title} className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className={`flex aspect-[2/3] items-center justify-center bg-gradient-to-br p-4 text-center ${posterGradient(movie.id)}`}><Clapperboard size={20} aria-hidden="true" className="inline-block shrink-0 align-middle" /> {movie.title}</div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleFavorite}
                  className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-6 py-3 font-semibold transition ${
                    movie.isFavorite
                      ? 'border-cinema-amber/60 bg-cinema-amber/15 text-cinema-accent'
                      : 'border-cinema-border bg-cinema-panel text-cinema-soft hover:border-cinema-amber/50 hover:text-cinema-accent'
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={movie.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  {movie.isFavorite ? t('movie.inFavorites') : t('movie.addToFavorites')}
                </button>
                <button type="button" onClick={handleShare} className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-cinema-border bg-cinema-panel px-6 py-3 font-semibold text-cinema-soft transition hover:border-cinema-amber/60 hover:text-cinema-accent">{t('movie.share')}</button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-cinema-soft">
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
                <span><Eye size={20} aria-hidden="true" className="inline-block shrink-0 align-middle" /> {movie.viewCount.toLocaleString()}</span>
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
                      className="rounded-full border border-cinema-border bg-cinema-panel px-3 py-1 text-xs font-semibold text-cinema-soft transition hover:border-cinema-amber/60 hover:text-cinema-accent"
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
                <p className="whitespace-pre-line leading-relaxed text-cinema-soft">{movie.description || t('movie.noDescription')}</p>
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
                      className="inline-flex items-center gap-2 rounded-xl border border-cinema-amber/50 bg-cinema-amber/10 px-5 py-2.5 font-semibold text-cinema-accent transition hover:bg-cinema-amber/20"
                    >
                      <Play size={16} aria-hidden="true" /> {t('movie.watchTrailer')}
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
                  <p className="font-semibold text-cinema-text">{movie.director}</p>
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
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cinema-amber/70 to-cinema-gold/70 text-xs font-bold text-cinema-ink">
                            {a.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="text-sm text-cinema-soft">{a.name}</span>
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
        </div>

        {similar.length > 0 && (
          <aside className="min-w-0" aria-label={t('movie.related')}>
            <h2 className="mb-4 text-xl font-extrabold text-cinema-text">{t('movie.related')}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {similar.slice(0, 8).map((m) => (
                <Link key={m.id} to={`/movie/${m.id}`} className="group flex min-w-0 gap-3 rounded-xl border border-cinema-border bg-cinema-panel/60 p-2 transition hover:border-cinema-amber/60">
                  {m.posterUrl ? (
                    <img src={resolveMediaUrl(m.posterUrl)} alt="" loading="lazy" className="h-24 w-16 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className={`flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${posterGradient(m.id)}`}><Clapperboard size={20} aria-hidden="true" className="inline-block shrink-0 align-middle" /></span>
                  )}
                  <div className="min-w-0 py-1">
                    <h3 className="line-clamp-2 text-sm font-bold text-cinema-text group-hover:text-cinema-accent">{m.title}</h3>
                    <p className="mt-1 text-xs text-cinema-muted">{[m.year, m.ageRating].filter(Boolean).join(' · ')}</p>
                    {m.averageRating > 0 && <p className="mt-2 text-xs font-bold text-cinema-accent"><Star size={14} aria-hidden="true" className="inline-block shrink-0 align-middle" /> {m.averageRating.toFixed(1)}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
