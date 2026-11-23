import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';

/** Underlined tabs; scrolls sideways on narrow screens, keeping the active tab in view. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Counts often arrive after the first render and widen the tabs, so re-check when they change.
  const layoutKey = tabs.map((tab) => `${tab.id}:${tab.count ?? ''}`).join('|');
  // On a phone the strip scrolls sideways: bring the active tab into view (e.g. opened from a link to a later tab).
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const l = list.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.left < l.left) list.scrollBy({ left: r.left - l.left - 16 });
    else if (r.right > l.right) list.scrollBy({ left: r.right - l.right + 16 });
  }, [value, layoutKey]);
  return (
    <div ref={listRef} role="tablist" className={clsx('-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0', className)}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={clsx(
              '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={clsx('rounded-full px-1.5 text-xs', active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted')}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pill segmented control for filters (e.g. status). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** Accessible name for the group. */
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
