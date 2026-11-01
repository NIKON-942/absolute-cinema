import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  /** Compare two rows for sorting; defaults to string/number comparison on key. */
  compare?: (a: T, b: T) => number;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface AdminTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Extra trailing column with row actions (edit/delete/...). */
  actions?: (row: T) => ReactNode;
  emptyMessage: string;
}

export function AdminTable<T>({ columns, rows, rowKey, actions, emptyMessage }: AdminTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortable) return rows;
    const getter = (row: T): string | number => {
      const value = (row as Record<string, unknown>)[sortKey];
      return typeof value === 'number' ? value : String(value ?? '');
    };
    const cmp = col.compare ?? ((a: T, b: T) => {
      const va = getter(a);
      const vb = getter(b);
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va).localeCompare(String(vb));
    });
    return [...rows].sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)));
  }, [rows, sortKey, sortDir, columns]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-cinema-border">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-cinema-border bg-cinema-panel text-xs uppercase tracking-wide text-cinema-muted">
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 font-semibold ${col.className ?? ''}`}>
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex cursor-pointer items-center gap-1 transition hover:text-slate-100"
                  >
                    {col.label}
                    <span className={`text-[10px] ${sortKey === col.key ? 'text-cinema-amber' : 'opacity-40'}`}>
                      {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
                    </span>
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
            {actions && <th className="px-4 py-3 text-right font-semibold">⚙</th>}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-10 text-center text-cinema-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
          {sortedRows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-cinema-border/60 transition last:border-0 hover:bg-cinema-card/50">
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 text-slate-200 ${col.className ?? ''}`}>
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
              {actions && <td className="px-4 py-3 text-right">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
