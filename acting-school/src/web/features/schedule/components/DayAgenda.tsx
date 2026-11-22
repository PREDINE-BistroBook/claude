import { CalendarOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ScheduleEvent, ScheduleFilter } from '@shared/schemas/schedule';
import { EmptyState, Spinner } from '@web/components/ui';
import { useCalendarFormat } from '../format';
import { eventKey } from '../utils';
import { EventCard } from './EventCard';

/** Phone: the selected day's events as a list. */
export function DayAgenda({
  date,
  today,
  events,
  filter,
  loading,
}: {
  date: string;
  today: string;
  events: ScheduleEvent[];
  filter: ScheduleFilter;
  loading: boolean;
}) {
  const { t } = useTranslation(['schedule', 'common']);
  const f = useCalendarFormat();
  const headingId = `agenda-${date}`;
  return (
    <section aria-labelledby={headingId} aria-busy={loading || undefined}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
        <h2 id={headingId} className="min-w-0 font-semibold text-ink">
          {date === today && <span className="text-accent">{t('todayLabel')} · </span>}
          {f.date(date, date === today ? 'dayMonth' : 'full')}
        </h2>
        {!loading && <span className="shrink-0 text-sm text-muted">{t('events', { count: events.length })}</span>}
      </div>
      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-label={t('loadingWeek')}>
          <Spinner />
        </div>
      ) : events.length ? (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={eventKey(e)}>
              <EventCard event={e} density="comfortable" />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={CalendarOff}
          title={t(`emptyDay.${filter}`)}
          description={t('emptyDay.hint')}
          className="rounded-2xl border border-dashed border-line-strong"
        />
      )}
    </section>
  );
}
