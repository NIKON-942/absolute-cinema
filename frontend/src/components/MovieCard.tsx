import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/context/ToastContext';
import { mediaService } from '@/services/mediaService';
import { posterGradient } from '@/utils/format';
import { resolveMediaUrl } from '@/utils/url';
import type { MovieDto } from '@/types';

interface MovieCardProps {
  movie: MovieDto;
  /** Re-render hook: bump to force favorite refresh from parent state. */
  onToggleFavorite?: (movie: MovieDto, isFavorite: boolean) => void;
  progressPercent?: number;
}

export function MovieCard({ movie, onToggleFavorite, progressPercent }: MovieCardProps) {
  const { t } = useLanguage();
  const [posterFailed, setPosterFailed] = useState(false);
  const { isAuthenticated } = useAuth();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const handleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `/movie/${movie.id}` } });
      return;
    }
    try {
      const res = await mediaService.toggleFavorite(movie.id);
      onToggleFavorite?.(movie, res.isFavorite);
      success(res.isFavorite ? t('favorites.added') : t('favorites.removed'));
    } catch {
      error(t('favorites.error'));
    }
  };

  return (
    <Link
      to={`/movie/${movie.id}`}
      className="group relative block w-40 shrink-0 sm:w-48"
      aria-label={movie.title}
    >
      <div className="relative overflow-hidden rounded-xl border border-cinema-border bg-cinema-card shadow-card transition-all duration-300 group-hover:-translate-y-1 group-hover:border-cinema-amber/50 group-hover:shadow-glow">
        {movie.posterUrl && !posterFailed ? (
          <img
            src={resolveMediaUrl(movie.posterUrl)}
            alt={movie.title}
            loading="lazy"
            className="aspect-[2/3] w-full object-cover transition duration-300 group-hover:opacity-70"
            onError={() => setPosterFailed(true)}
          />
        ) : (
          <div
            className={`flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 bg-gradient-to-br p-3 text-center ${posterGradient(movie.id)}`}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-cinema-accent opacity-70">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
            </svg>
            <span className="line-clamp-3 text-xs font-semibold text-cinema-soft">{movie.title}</span>
          </div>
        )}

        {/* hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/45 group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cinema-amber text-cinema-ink shadow-glow transition-transform group-hover:scale-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          </span>
        </div>

        {/* rating badge */}
        {movie.averageRating > 0 && (
          <span className="media-surface absolute left-2 top-2 rounded-md bg-cinema-black/85 px-1.5 py-0.5 text-xs font-bold text-cinema-accent backdrop-blur">
            ★ {movie.averageRating.toFixed(1)}
          </span>
        )}
        {movie.ageRating?.trim() && (
          <span className="media-surface absolute right-2 top-2 rounded-md bg-cinema-black/85 px-1.5 py-0.5 text-[10px] font-semibold text-cinema-soft backdrop-blur">
            {movie.ageRating}
          </span>
        )}

        {/* favorite heart */}
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={t('favorites.toggle')}
          className={`absolute bottom-2 right-2 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full backdrop-blur transition ${
            movie.isFavorite
              ? 'bg-cinema-amber text-cinema-ink opacity-100'
              : 'bg-cinema-black/70 text-cinema-soft opacity-0 hover:text-cinema-accent group-hover:opacity-100'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={movie.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* continue-watching progress */}
        {progressPercent != null && progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div
              className="h-full bg-cinema-amber"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <h3 className="truncate text-sm font-semibold text-cinema-text transition group-hover:text-cinema-accent" title={movie.title}>
          {movie.title}
        </h3>
        <p className="text-xs text-cinema-muted">
          {movie.year} · {movie.genres[0]?.name ?? t('common.movie')}
        </p>
      </div>
    </Link>
  );
}
