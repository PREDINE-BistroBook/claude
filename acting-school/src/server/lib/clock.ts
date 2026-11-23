/**
 * "Today" and "now" on the server, in the school's time zone (AppConfig
 * timeZone, default Africa/Cairo) — never the runtime's: Cloudflare Workers
 * always run in UTC, so between midnight and 02:00/03:00 in Cairo the runtime's
 * date is still yesterday. Dates stay plain school-local strings
 * (shared/dates.ts); only these helpers look at the clock. The browser keeps
 * using todayISO()/nowTime() from shared/dates.ts (its own local time).
 */
import type { Context } from 'hono';
import type { AppEnv } from '../env';

export const DEFAULT_TIME_ZONE = 'Africa/Cairo';

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of `instant` in `timeZone`. */
function wallClock(timeZone: string, instant: Date) {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // Some engines answer "24" for midnight even with h23.
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
    second: Number(parts.second),
  };
}

/** True when the runtime knows this IANA zone ("Africa/Cairo"). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The date in `timeZone`, "YYYY-MM-DD". */
export function todayIn(timeZone: string, instant: Date = new Date()): string {
  return wallClock(timeZone, instant).date;
}

/** The time of day in `timeZone`, "HH:MM". */
export function nowTimeIn(timeZone: string, instant: Date = new Date()): string {
  return wallClock(timeZone, instant).time;
}

/**
 * Epoch milliseconds of a school-local wall-clock time ("YYYY-MM-DD", "HH:MM")
 * in `timeZone` (e.g. to date a seeded record "that day at 10:00").
 */
export function epochAt(timeZone: string, date: string, time = '00:00'): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  // The zone's offset at that moment, measured by formatting it back; twice for DST edges.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(timeZone, new Date(guess));
    const [wy, wm, wd] = w.date.split('-').map(Number) as [number, number, number];
    const [wh, wmin] = w.time.split(':').map(Number) as [number, number];
    const shown = Date.UTC(wy, wm - 1, wd, wh, wmin, w.second);
    guess += asUtc - shown;
  }
  return guess;
}

/** Today at the school (the request's AppConfig time zone). */
export function schoolToday(c: Context<AppEnv>): string {
  return todayIn(c.get('config').timeZone);
}

/** The school's time of day, "HH:MM". */
export function schoolNowTime(c: Context<AppEnv>): string {
  return nowTimeIn(c.get('config').timeZone);
}
