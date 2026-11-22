import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ScheduleEvent } from '@shared/schemas/schedule';
import { useCalendarFormat } from '../format';
import { eventKey } from '../utils';
import { EventCard } from './EventCard';

/** Desktop: one column per day, events stacked by time. */
export function WeekGrid({
  days,
  today,
  byDate,
  loading,
}: {
  days: string[];
  today: string;
  byDate: Map<string, ScheduleEvent[]>;
  /** Showing the previous week's data while this one loads. */
  loading: boolean;
}) {
  const { t } = useTranslation('schedule');
  const f = useCalendarFormat();
  return (
    <div className={clsx('grid grid-cols-7 gap-2 transition-opacity', loading && 'opacity-60')} aria-busy={loading || undefined}>
      {days.map((d) => {
        const isToday = d === today;
        const events = loading ? [] : (byDate.get(d) ?? []);
        return (
          <section key={d} aria-label={f.date(d, 'full')} className="flex min-w-0 flex-col">
            <header
              className={clsx('mb-2 rounded-xl px-2 py-2 text-center', isToday ? 'bg-accent-soft text-accent' : 'text-muted')}
              aria-current={isToday ? 'date' : undefined}
            >
              <div className="truncate text-xs font-medium">{f.date(d, 'weekdayShort')}</div>
              <div className={clsx('text-xl font-semibold leading-tight tabular-nums', isToday ? 'text-accent' : 'text-ink')}>{f.dayNumber(d)}</div>
            </header>
            <div
              className={clsx(
                'flex min-h-56 flex-1 flex-col gap-1.5 rounded-xl border p-1.5',
                isToday ? 'border-accent/30 bg-surface' : 'border-line bg-surface/60',
              )}
            >
              {loading ? (
                <div className="space-y-1.5" aria-hidden>
                  <div className="h-16 animate-pulse rounded-lg bg-surface-2" />
                </div>
              ) : events.length ? (
                events.map((e) => <EventCard key={eventKey(e)} event={e} density="compact" />)
              ) : (
                <p className="m-auto px-1 text-center text-xs text-muted">{t('emptyDayShort')}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
