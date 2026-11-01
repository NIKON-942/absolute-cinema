import { useLanguage } from '@/context/LanguageContext';

export function Spinner({ size = 8, className = '' }: { size?: number; className?: string }) {
  const { t } = useLanguage();
  return (
    <span
      role="status"
      aria-label={t('common.loading')}
      className={`inline-block animate-spin rounded-full border-cinema-muted/30 border-t-cinema-amber ${className}`}
      style={{ width: `${size * 4}px`, height: `${size * 4}px`, borderWidth: '3px', borderStyle: 'solid' }}
    />
  );
}

/** Full-section centered loading state. */
export function LoadingBlock({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 text-cinema-muted">
      <Spinner size={10} />
      <p className="text-sm">{label ?? t('common.loading')}</p>
    </div>
  );
}

/** Poster-shaped skeleton card grid. */
export function CardSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="relative w-40 shrink-0 overflow-hidden rounded-xl border border-cinema-border bg-cinema-card sm:w-48"
        >
          <div className="aspect-[2/3] w-full animate-pulse bg-cinema-panel" />
          <div className="space-y-2 p-3">
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-cinema-panel" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-cinema-panel" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="mb-10">
      <div className="mb-4 h-6 w-52 animate-pulse rounded bg-cinema-card" />
      <CardSkeletons />
    </div>
  );
}
