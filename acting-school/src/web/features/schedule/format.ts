import { parseDate } from '@shared/dates';
import { useFormat } from '@web/lib/format';

/** Whole days from `from` to `to` (negative when `to` is earlier). DST-safe. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

/**
 * Calendar labels on top of useFormat(): same locale (Western digits in
 * Arabic), for the bits useFormat has no style for.
 */
export function useCalendarFormat() {
  const f = useFormat();
  const loc = f.locale;
  return {
    ...f,
    /** "17" */
    dayNumber: (iso: string) => new Intl.DateTimeFormat(loc, { day: 'numeric' }).format(parseDate(iso)),
    /** "Nov" / "نوفمبر" */
    monthShort: (iso: string) => new Intl.DateTimeFormat(loc, { month: 'short' }).format(parseDate(iso)),
    /** "17 – 23 Nov 2026", "28 Nov – 4 Dec 2026" — the locale decides what to repeat. */
    range(from: string, to: string): string {
      const fmt = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric' });
      return fmt.formatRange(parseDate(from), parseDate(to));
    },
    daysBetween,
    /** `iso` relative to `today`, in words: "today", "tomorrow", "in 3 days", "yesterday", "5 days ago". */
    relativeDays(iso: string, today: string): string {
      return new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(daysBetween(today, iso), 'day');
    },
  };
}
