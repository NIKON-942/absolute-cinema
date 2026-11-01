import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface RatingStarsProps {
  value: number | null; // current user rating 1..10
  average: number; // 0..10
  count?: number;
  onRate: (value: number) => void;
  onClear?: () => void;
  readOnly?: boolean;
  size?: number;
}

/** 10-point rating widget (1..10). Hover previews, click sets, right-click area clears. */
export function RatingStars({ value, average, onRate, onClear, readOnly, size = 26 }: RatingStarsProps) {
  const { t } = useLanguage();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className="flex items-center gap-0.5"
        onMouseLeave={() => setHover(null)}
        role={readOnly ? 'img' : 'radiogroup'}
        aria-label={t('movie.rateOutOf10')}
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            aria-label={`${t('movie.setRating')} ${n}`}
            onMouseEnter={() => !readOnly && setHover(n)}
            onClick={() => !readOnly && onRate(n)}
            className={`cursor-pointer transition-transform ${readOnly ? 'cursor-default' : 'hover:scale-110 active:scale-95'}`}
          >
            <svg
              width={size}
              height={size}
              viewBox="0 0 24 24"
              fill={n <= shown ? '#f5b942' : 'none'}
              stroke={n <= shown ? '#f5b942' : '#4b5069'}
              strokeWidth="1.6"
            >
              <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.65 1.13 6.58L12 17.57l-5.9 3.1 1.13-6.58L2.45 9.44l6.6-.96L12 2.5z" />
            </svg>
          </button>
        ))}
      </div>
      <div className="flex flex-col text-sm">
        <span className="font-bold text-cinema-amber">{average > 0 ? average.toFixed(1) : '—'}/10</span>
        <span className="text-xs text-cinema-muted">
          {value ? t('movie.yourRating', { value }) : t('movie.notRated')}
        </span>
      </div>
      {!readOnly && value != null && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer rounded-md border border-cinema-border px-2.5 py-1 text-xs text-cinema-muted transition hover:border-cinema-red/60 hover:text-cinema-red"
        >
          {t('movie.clearRating')}
        </button>
      )}
    </div>
  );
}
