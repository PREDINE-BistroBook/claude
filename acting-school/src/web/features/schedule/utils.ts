import { addDays, eachDay, isValidDate, startOfWeek } from '@shared/dates';
import type { ScheduleEvent, ScheduleFilter } from '@shared/schemas/schedule';

/** A "YYYY-MM-DD" query param, or null when missing / not a real date. */
export function parseDateParam(value: string | null): string | null {
  return value && isValidDate(value) ? value : null;
}

/** Which kinds of events the person's positions let them see (classes: courses.read, auditions: castings.read, interviews: admissions.read). */
export interface VisibleKinds {
  classes: boolean;
  auditions: boolean;
  interviews: boolean;
}

/**
 * The ?show= filter. Someone who sees only one kind of event gets that kind
 * (so an empty day says "No classes" / "No auditions" / "No interviews"); only
 * someone who sees several can pick, and only among the kinds they see.
 */
export function parseFilterParam(value: string | null, sees: VisibleKinds): ScheduleFilter {
  const visible = (['classes', 'auditions', 'interviews'] as const).filter((k) => sees[k]);
  if (visible.length === 0) return 'all';
  if (visible.length === 1) return visible[0]!;
  return (visible as readonly string[]).includes(value ?? '') ? (value as ScheduleFilter) : 'all';
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
  if (filter === 'interviews') return events.filter((e) => e.kind === 'interview');
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
export const eventHref = (e: ScheduleEvent) =>
  e.kind === 'class' ? `/sessions/${e.id}` : e.kind === 'interview' ? `/admissions/${e.leadId}` : `/castings/${e.castingId}`;
