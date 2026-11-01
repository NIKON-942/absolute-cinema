import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '@/context/LanguageContext';

interface CarouselProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** Horizontally scrollable row with arrow controls. */
export function Carousel({ title, subtitle, action, children }: CarouselProps) {
  const { t } = useLanguage();
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  };

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 sm:text-2xl">{title}</h2>
          {subtitle && <p className="text-sm text-cinema-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <div className="hidden gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              disabled={atStart}
              aria-label={t('carousel.scrollLeft')}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-cinema-border bg-cinema-panel text-slate-200 transition hover:border-cinema-amber/60 hover:text-cinema-amber disabled:cursor-default disabled:opacity-30"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              disabled={atEnd}
              aria-label={t('carousel.scrollRight')}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-cinema-border bg-cinema-panel text-slate-200 transition hover:border-cinema-amber/60 hover:text-cinema-amber disabled:cursor-default disabled:opacity-30"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div
        ref={trackRef}
        onScroll={updateArrows}
        className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2"
      >
        {children}
      </div>
    </section>
  );
}
