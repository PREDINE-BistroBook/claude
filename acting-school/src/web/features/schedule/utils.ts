import { addDays, eachDay, isValidDate, startOfWeek } from '@shared/dates';
import { SCHEDULE_FILTERS, type ScheduleEvent, type ScheduleFilter } from '@shared/schemas/schedule';

/** A "YYYY-MM-DD" query param, or null when missing / not a real date. */
export function parseDateParam(value: string | null): string | null {
  return value && isValidDate(value) ? value : null;
}

export function parseFilterParam(value: string | null, canSeeAuditions: boolean): ScheduleFilter {
  if (!canSeeAuditions) return 'all';
  return (SCHEDULE_FILTERS as readonly string[]).includes(value ?? '') ? (value as ScheduleFilter) : 'all';
}

/** The 7 days of the week containing `date`. */
export function weekOf(date: string, weekStartsOn: number): { from: string; to: string; days: string[] } {
  const from = startOfWeek(date, weekStartsOn);
  const to = addDays(from, 6);
  return { from, to, days: eachDay(from, to) };
}

export function filterEvents(events: readonly ScheduleEvent[], filter: ScheduleFilter): ScheduleEvent[] {
  if (filter === 'classes') return events.filter((e) => e.kind === 'class');
  if (filter === 'auditions') return events.filter((e) => e.kind === 'audition');
  return [...events];
}

/** Events per date; the API already sorts them by date then time. */
export function groupByDate(events: readonly ScheduleEvent[]): Map<string, ScheduleEvent[]> {
  const out = new Map<string, ScheduleEvent[]>();
  for (const e of events) {
    const list = out.get(e.date);
    if (list) list.push(e);
    else out.set(e.date, [e]);
  }
  return out;
}

export const eventKey = (e: ScheduleEvent) => `${e.kind}-${e.id}`;
export const eventHref = (e: ScheduleEvent) => (e.kind === 'class' ? `/sessions/${e.id}` : `/castings/${e.castingId}`);
