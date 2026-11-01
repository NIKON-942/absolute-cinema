import { useLanguage } from '@/context/LanguageContext';
import { qualityRank } from '@/utils/plans';
import type { Quality } from '@/types';

interface QualitySelectorProps {
  qualities: Quality[];
  value: Quality;
  onChange: (quality: Quality) => void;
  /** Plan cap — qualities above it trigger onLockedQuality (upgrade prompt). */
  maxQuality?: Quality;
  onLockedQuality?: (quality: Quality) => void;
  compact?: boolean;
}

/** 480p / 720p / 1080p switcher. Switching preserves currentTime (handled by VideoPlayer). */
export function QualitySelector({ qualities, value, onChange, maxQuality = '1080p', onLockedQuality, compact }: QualitySelectorProps) {
  const { t } = useLanguage();
  const order: Quality[] = ['480p', '720p', '1080p'];
  const available = order.filter((q) => qualities.includes(q));

  if (available.length === 0) {
    return <span className="text-xs text-cinema-muted">{t('player.noQualities')}</span>;
  }

  const pick = (q: Quality) =>
    qualityRank(q) > qualityRank(maxQuality) ? onLockedQuality?.(q) : onChange(q);

  const buttonClass = (q: Quality) => {
    const locked = qualityRank(q) > qualityRank(maxQuality);
    if (q === value) return 'bg-cinema-amber text-cinema-ink';
    return locked ? 'text-cinema-muted hover:bg-white/10' : 'text-cinema-soft hover:bg-white/10';
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1" role="group" aria-label={t('player.quality')}>
        {available.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => pick(q)}
            aria-pressed={q === value}
            title={qualityRank(q) > qualityRank(maxQuality) ? t('player.qualityLocked', { quality: q }) : undefined}
            className={`cursor-pointer rounded px-2 py-1 text-xs font-bold transition ${buttonClass(q)}`}
          >
            {q}
            {qualityRank(q) > qualityRank(maxQuality) && ' 🔒'}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-cinema-border bg-cinema-panel p-1" role="group" aria-label={t('player.quality')}>
      {available.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => pick(q)}
          aria-pressed={q === value}
          title={qualityRank(q) > qualityRank(maxQuality) ? t('player.qualityLocked', { quality: q }) : undefined}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-bold transition ${buttonClass(q)}`}
        >
          {q}
          {qualityRank(q) > qualityRank(maxQuality) && ' 🔒'}
        </button>
      ))}
    </div>
  );
}
