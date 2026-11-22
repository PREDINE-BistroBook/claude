import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { addDays, todayISO } from '@shared/dates';
import type { ScheduleFilter } from '@shared/schemas/schedule';
import { Button, ErrorState, PageHeader, PageLoader, Segmented, Spinner } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { usePrefetchAdjacentWeeks, useSchedule, useWeekStart } from './api';
import { DayAgenda } from './components/DayAgenda';
import { WeekGrid } from './components/WeekGrid';
import { WeekStrip } from './components/WeekStrip';
import { useCalendarFormat } from './format';
import { filterEvents, groupByDate, parseDateParam, parseFilterParam, weekOf } from './utils';

/** Square previous/next button; the chevron mirrors in RTL so "previous" always points back. */
function StepButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-surface text-ink transition-colors hover:bg-surface-2"
    >
      <Icon className="size-5 rtl:-scale-x-100" aria-hidden />
    </button>
  );
}

export default function SchedulePage() {
  const { t } = useTranslation(['schedule', 'common']);
  const { can } = useAuth();
  const f = useCalendarFormat();
  const [params, setParams] = useSearchParams();
  const canSeeAuditions = can('castings.read');

  const today = todayISO();
  const selected = parseDateParam(params.get('date')) ?? today;
  const filter = parseFilterParam(params.get('show'), canSeeAuditions);

  const { weekStartsOn, ready } = useWeekStart();
  const week = useMemo(() => weekOf(selected, weekStartsOn), [selected, weekStartsOn]);
  const schedule = useSchedule(week.from, week.to, ready);
  usePrefetchAdjacentWeeks(week.from, ready && schedule.isSuccess);

  // Start from the live URL, not this render's params: router updates land in a
  // transition, so a quick second tap could otherwise undo the first one.
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true, flushSync: true });
  };
  const selectDate = (d: string) => update({ date: d === today ? null : d });
  /** Move by whole weeks from the date in the live URL (two quick taps = two weeks). */
  const stepWeek = (dir: 1 | -1) => {
    const current = parseDateParam(new URLSearchParams(window.location.search).get('date')) ?? today;
    selectDate(addDays(current, 7 * dir));
  };
  const setFilter = (v: ScheduleFilter) => update({ show: v === 'all' ? null : v });

  // Placeholder data is the previous week's: don't spread it over this week's days.
  const loadingWeek = schedule.isPlaceholderData;
  const events = useMemo(() => filterEvents(schedule.data?.items ?? [], filter), [schedule.data, filter]);
  const byDate = useMemo(() => groupByDate(events), [events]);
  const counts = useMemo(() => new Map([...byDate].map(([d, list]) => [d, list.length])), [byDate]);

  const filterOptions: { value: ScheduleFilter; label: string }[] = [
    { value: 'all', label: t('filter.all') },
    { value: 'classes', label: t('filter.classes') },
    { value: 'auditions', label: t('filter.auditions') },
  ];

  let body;
  if (!ready || schedule.isPending) body = <PageLoader />;
  else if (schedule.isError && !schedule.data) body = <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />;
  else
    body = (
      <>
        {/* Phone: day strip + that day's agenda */}
        <div className="space-y-4 lg:hidden">
          <WeekStrip days={week.days} selected={selected} today={today} counts={loadingWeek ? new Map() : counts} onSelect={selectDate} />
          <DayAgenda date={selected} today={today} events={byDate.get(selected) ?? []} filter={filter} loading={loadingWeek} />
        </div>
        {/* Desktop: the whole week */}
        <div className="hidden lg:block">
          <WeekGrid days={week.days} today={today} byDate={byDate} loading={loadingWeek} />
        </div>
      </>
    );

  return (
    <div>
      <PageHeader title={t('title')} subtitle={canSeeAuditions ? t('subtitle') : t('subtitleClasses')} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('weekNavigation')} className="flex min-w-0 items-center gap-2">
          <StepButton icon={ChevronLeft} label={t('previousWeek')} onClick={() => stepWeek(-1)} />
          <Button onClick={() => selectDate(today)} title={t('goToToday')}>
            {t('common:actions.today')}
          </Button>
          <StepButton icon={ChevronRight} label={t('nextWeek')} onClick={() => stepWeek(1)} />
          <h2 className="ms-1 flex min-w-0 items-center gap-2 text-base font-semibold text-ink" aria-live="polite">
            <span className="truncate">{f.range(week.from, week.to)}</span>
            {ready && schedule.isFetching && <Spinner className="size-4" />}
          </h2>
        </div>
        {canSeeAuditions && (
          <Segmented
            label={t('filter.label')}
            options={filterOptions}
            value={filter}
            onChange={setFilter}
            className="w-full *:flex-1 sm:w-auto sm:*:flex-none"
          />
        )}
      </div>

      {body}
    </div>
  );
}
