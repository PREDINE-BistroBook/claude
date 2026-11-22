/**
 * Calendar helpers on plain strings. The school runs in one place, so dates are
 * stored as local "YYYY-MM-DD", times as "HH:MM" and date-times as
 * "YYYY-MM-DDTHH:MM" with no time zone. Never pass these through `new Date(str)`
 * (that parses as UTC and shifts the day); use the helpers here.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Local Date at midnight for a "YYYY-MM-DD" string. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

/** Current local time as "HH:MM". */
export function nowTime(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(s: string): number {
  return parseDate(s).getDay();
}

/** First day of the week containing `s`, for a week starting on `weekStartsOn` (0 Sun, 1 Mon, 6 Sat). */
export function startOfWeek(s: string, weekStartsOn: number = 1): string {
  const diff = (weekdayOf(s) - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

/** Inclusive list of dates from `from` to `to`. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole years between `dob` and `on` (default today); null if dob is missing. */
export function ageOn(dob: string | null | undefined, on: string = todayISO()): number | null {
  if (!dob || !isValidDate(dob)) return null;
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/** Minutes since midnight for "HH:MM". */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function splitDateTime(dt: string): { date: string; time: string } {
  const [date, time] = dt.split('T') as [string, string];
  return { date, time };
}
