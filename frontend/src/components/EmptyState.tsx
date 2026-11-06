import { Clapperboard } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactElement;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-cinema-border bg-cinema-panel/50 px-6 py-16 text-center">
      <div className="text-4xl text-cinema-muted">{icon ?? <Clapperboard size={40} aria-hidden="true" className="inline-block shrink-0 align-middle" />}</div>
      <h3 className="text-lg font-semibold text-cinema-text">{title}</h3>
      {subtitle && <p className="max-w-md text-sm text-cinema-muted">{subtitle}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
