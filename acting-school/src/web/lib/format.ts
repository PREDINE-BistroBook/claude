import { useTranslation } from 'react-i18next';
import { ageOn, parseDate } from '@shared/dates';

/**
 * Locale-aware formatting. Arabic uses Western digits (nu-latn) so phone
 * numbers, times and dates read the same as the data people type in.
 */
export function intlLocale(lang: string): string {
  return lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
}

export type DateStyle = 'full' | 'long' | 'medium' | 'short' | 'weekday' | 'weekdayShort' | 'dayMonth' | 'monthYear';

const DATE_OPTS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  short: { day: 'numeric', month: 'short' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
  weekdayShort: { weekday: 'short' },
  dayMonth: { day: 'numeric', month: 'long' },
  monthYear: { month: 'long', year: 'numeric' },
};

/** Formatting functions bound to the current language. Re-renders on language change. */
export function useFormat() {
  const { i18n } = useTranslation();
  return makeFormat(i18n.language);
}

/**
 * The same formatting functions for a given language — for text written in a
 * language other than the screen's (e.g. a WhatsApp message in Arabic sent
 * from the English UI). Prefer useFormat() for what's on screen.
 */
export function makeFormat(language: string) {
  const loc = intlLocale(language);
  return {
    locale: loc,
    /** "YYYY-MM-DD" → localised date. */
    date(iso: string | null | undefined, style: DateStyle = 'medium'): string {
      if (!iso) return '';
      return new Intl.DateTimeFormat(loc, DATE_OPTS[style]).format(parseDate(iso.slice(0, 10)));
    },
    /** "HH:MM" → localised time (24h in English, 12h with ص/م in Arabic). */
    time(hhmm: string | null | undefined): string {
      if (!hhmm) return '';
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      return new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m));
    },
    timeRange(start: string, end: string): string {
      return `${this.time(start)} – ${this.time(end)}`;
    },
    /** "YYYY-MM-DDTHH:MM" → date + time. */
    dateTime(dt: string | null | undefined, style: DateStyle = 'weekday'): string {
      if (!dt) return '';
      const sep = language === 'ar' ? '، ' : ', ';
      return `${this.date(dt.slice(0, 10), style)}${sep}${this.time(dt.slice(11, 16))}`;
    },
    /** Epoch ms → date. */
    timestamp(ms: number | null | undefined, style: DateStyle = 'medium'): string {
      if (!ms) return '';
      return new Intl.DateTimeFormat(loc, DATE_OPTS[style]).format(new Date(ms));
    },
    /** Epoch ms → date and time ("24 Nov 2026, 14:05"). */
    timestampTime(ms: number | null | undefined, style: DateStyle = 'medium'): string {
      if (!ms) return '';
      return new Intl.DateTimeFormat(loc, { ...DATE_OPTS[style], hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
    },
    /** 0 = Sunday … 6 = Saturday → "Sun" / "الأحد". */
    weekday(n: number, width: 'long' | 'short' = 'short'): string {
      // 2023-01-01 was a Sunday.
      return new Intl.DateTimeFormat(loc, { weekday: width }).format(new Date(2023, 0, 1 + n));
    },
    number(n: number, opts?: Intl.NumberFormatOptions): string {
      return new Intl.NumberFormat(loc, opts).format(n);
    },
    percent(ratio: number): string {
      return new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
    },
  };
}

export { ageOn };

export function fullName(p: { firstName: string; lastName: string } | null | undefined): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

/** Stage name if set, else the real name. */
export function displayName(p: { firstName: string; lastName: string; stageName?: string | null }): string {
  return p.stageName?.trim() || fullName(p);
}
