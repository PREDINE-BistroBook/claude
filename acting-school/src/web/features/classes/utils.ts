import { addDays, nowTime, parseDate, todayISO, weekdayOf } from '@shared/dates';
import type { ClassSession, ScheduleSlot } from '@shared/schemas/courses';
import type { useFormat } from '@web/lib/format';

type Format = ReturnType<typeof useFormat>;

/** Position of a weekday in a week that starts on `weekStart`. */
export const weekdayRank = (weekday: number, weekStart: number) => (weekday - weekStart + 7) % 7;

/** The seven weekdays in display order for this school. */
export function orderedWeekdays(weekStart: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => (weekStart + i) % 7);
}

/**
 * Weekly schedule as short lines, one per time range:
 *   ["Tue, Thu · 18:00 – 20:00", "Sat · 10:00 – 13:00"]
 */
export function scheduleLines(slots: readonly ScheduleSlot[], f: Format, weekStart: number, separator = ', '): string[] {
  const groups = new Map<string, { start: string; end: string; days: number[] }>();
  for (const s of slots) {
    const key = `${s.startTime}-${s.endTime}`;
    const g = groups.get(key) ?? { start: s.startTime, end: s.endTime, days: [] };
    if (!g.days.includes(s.weekday)) g.days.push(s.weekday);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, days: g.days.sort((a, b) => weekdayRank(a, weekStart) - weekdayRank(b, weekStart)) }))
    .sort((a, b) => weekdayRank(a.days[0]!, weekStart) - weekdayRank(b.days[0]!, weekStart) || a.start.localeCompare(b.start))
    .map((g) => `${g.days.map((d) => f.weekday(d)).join(separator)} · ${f.timeRange(g.start, g.end)}`);
}

/** How many sessions the weekly slots produce between two dates (same rule as the server). */
export function countOccurrences(slots: readonly { weekday: number; startTime: string }[], from: string, to: string): number {
  if (!from || !to || to < from) return 0;
  const perWeekday = new Map<number, Set<string>>();
  for (const s of slots) {
    const set = perWeekday.get(s.weekday) ?? new Set<string>();
    set.add(s.startTime);
    perWeekday.set(s.weekday, set);
  }
  let n = 0;
  const first = weekdayOf(from);
  for (const [weekday, times] of perWeekday) {
    let d = addDays(from, (weekday - first + 7) % 7);
    while (d <= to) {
      n += times.size;
      d = addDays(d, 7);
    }
  }
  return n;
}

/** Whole days between two "YYYY-MM-DD" strings. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

/** A session is "past" once it has ended. */
export function isPast(s: Pick<ClassSession, 'date' | 'endTime'>, today = todayISO(), now = nowTime()): boolean {
  return s.date < today || (s.date === today && s.endTime <= now);
}

/** Held but nobody marked yet. */
export function needsAttendance(s: ClassSession, today?: string, now?: string): boolean {
  return s.status === 'scheduled' && !s.attendanceTaken && isPast(s, today, now);
}

/** Tone for an attendance rate (0–1). */
export function rateTone(rate: number): 'success' | 'warning' | 'danger' {
  return rate >= 0.8 ? 'success' : rate >= 0.6 ? 'warning' : 'danger';
}
