import clsx from 'clsx';
import { useCalendarFormat } from '../../schedule/format';

/** Calendar-page tile: short weekday over the day number. */
export function DateTile({ date, tone = 'accent' }: { date: string; tone?: 'accent' | 'neutral' | 'warning' | 'danger' | 'info' }) {
  const f = useCalendarFormat();
  return (
    <span
      aria-hidden
      className={clsx(
        'flex w-14 flex-col items-center justify-center rounded-xl py-1.5 leading-tight',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'warning' && 'bg-warning-soft text-warning',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'info' && 'bg-info-soft text-info',
      )}
    >
      <span className="max-w-full truncate px-1 text-[11px] font-medium">{f.date(date, 'weekdayShort')}</span>
      <span className="text-lg font-semibold tabular-nums text-ink">{f.dayNumber(date)}</span>
    </span>
  );
}

/** Start / end time stacked, for class rows. */
export function TimeStack({ start, end }: { start: string; end: string }) {
  const f = useCalendarFormat();
  return (
    <span className="block w-16 text-sm leading-tight tabular-nums">
      <span className="block font-semibold text-ink">{f.time(start)}</span>
      <span className="mt-0.5 block text-xs text-muted">{f.time(end)}</span>
    </span>
  );
}
