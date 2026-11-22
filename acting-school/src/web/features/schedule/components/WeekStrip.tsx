import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useCalendarFormat } from '../format';

/**
 * Phone: the seven days of the week as a row of buttons. Today is outlined,
 * the selected day filled; a dot marks days with something on.
 */
export function WeekStrip({
  days,
  selected,
  today,
  counts,
  onSelect,
}: {
  days: string[];
  selected: string;
  today: string;
  counts: Map<string, number>;
  onSelect: (date: string) => void;
}) {
  const { t } = useTranslation('schedule');
  const f = useCalendarFormat();
  return (
    <div role="group" aria-label={t('days')} className="grid grid-cols-7 gap-1 rounded-2xl border border-line bg-surface p-1.5">
      {days.map((d) => {
        const isSelected = d === selected;
        const isToday = d === today;
        const n = counts.get(d) ?? 0;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={isSelected}
            aria-current={isToday ? 'date' : undefined}
            aria-label={[f.date(d, 'full'), isToday ? t('todayLabel') : null, t('events', { count: n })].filter(Boolean).join(', ')}
            className={clsx(
              'flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors',
              isSelected
                ? 'bg-accent text-accent-ink shadow-sm'
                : isToday
                  ? 'text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent-soft'
                  : 'text-ink hover:bg-surface-2',
            )}
          >
            <span className={clsx('max-w-full truncate text-[11px] font-medium leading-tight', !isSelected && !isToday && 'text-muted')}>
              {f.date(d, 'weekdayShort')}
            </span>
            <span className="text-base font-semibold leading-tight tabular-nums">{f.dayNumber(d)}</span>
            <span
              aria-hidden
              className={clsx('size-1.5 rounded-full', n === 0 ? 'bg-transparent' : isSelected ? 'bg-accent-ink' : 'bg-accent')}
            />
          </button>
        );
      })}
    </div>
  );
}
