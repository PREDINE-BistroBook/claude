/**
 * Small rendering helpers for the public website. Everything goes through
 * hono/html's `html` template, which escapes every interpolated value;
 * `raw()` is only ever used here for fixed markup written in this file (the
 * icons and the brand mark), never for stored or submitted text.
 */
import { html, raw } from 'hono/html';
import { brandMarkSvg } from '../../shared/brand';
import type { Locale } from '../../shared/enums';
import { internationalPhone, telLink } from '../../shared/phone';
import type { ScheduleSlot } from '../../shared/schemas/courses';
import { INTL_LOCALE, fmt, type SiteStrings } from './i18n';

export type Html = ReturnType<typeof html>;

/** A rendered page as a string (everything here renders synchronously: no async components). */
export function htmlString(h: Html): string {
  if (h instanceof Promise) throw new Error('site pages render synchronously');
  return h.toString();
}

// ── Icons (lucide, ISC; decorative: every icon sits next to a visible label) ──

const ICONS = {
  whatsapp:
    '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/><path d="M9.6 8.2c.3-.3.7-.3.9 0l.9 1.2c.2.3.2.7-.1.9l-.5.5c.4.9 1.1 1.6 2 2l.5-.5c.3-.3.7-.3.9-.1l1.2.9c.3.2.3.6 0 .9l-.6.6c-.5.5-1.2.6-1.8.3-1.8-.8-3.4-2.4-4.2-4.2-.3-.6-.2-1.3.3-1.8z" fill="currentColor" stroke="none"/>',
  phone:
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  camera:
    '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  clapper:
    '<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
  level: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** An inline icon (24×24 grid, currentColor). Directional ones get class "flip" (mirrored in Arabic). */
export function icon(name: IconName, cls = 'i'): Html {
  const flip = name === 'arrow' || name === 'back' ? ' flip' : '';
  return raw(
    `<svg class="${cls}${flip}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`,
  );
}

let markCount = 0;
/** The studio's mark (src/shared/brand.ts), inline; decorative (the name is always next to it). */
export function brandMark(cls: string): Html {
  const svg = brandMarkSvg(`m${++markCount % 1000}`).replace('<svg ', `<svg class="${cls}" aria-hidden="true" focusable="false" `);
  return raw(svg);
}

/** The brand mark as a data: URI (the favicon; CSP img-src allows data:). */
export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(brandMarkSvg('f'))}`;

// ── Text ────────────────────────────────────────────────────────────────────

/** A multi-paragraph text → <p> elements, split on blank lines; single line breaks become <br>. Escaped. */
export function paragraphs(text: string, cls?: string): Html {
  const parts = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return html`${parts.map((p) => {
    const lines = p.split('\n');
    return html`<p${cls ? html` class="${cls}"` : ''}>${lines.map((line, i) => (i ? html`<br>${line}` : line))}</p>`;
  })}`;
}

/** The first paragraph, cut to about `max` characters on a word boundary (for cards and meta descriptions). */
export function excerpt(text: string, max = 180): string {
  const first = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:،؛]+$/, '')}…`;
}

// ── Contact links ───────────────────────────────────────────────────────────

/** wa.me link with a message in the page's language, or null when the number can't be used. */
export function waLink(phone: string | null | undefined, countryCode: string, text: string): string | null {
  const n = internationalPhone(phone, countryCode);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

export { telLink };

/** https://instagram.com/<handle>/ (the handle is validated when saved: letters, digits, . and _). */
export function instagramUrl(handle: string | null | undefined): string | null {
  return handle && /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

// ── Dates and times ─────────────────────────────────────────────────────────

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(lang: Locale, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(opts)}`;
  let f = dateFormats.get(key);
  if (!f) {
    // Dates are school-local strings: format them as UTC instants so the runtime's zone never shifts the day.
    f = new Intl.DateTimeFormat(INTL_LOCALE[lang], { ...opts, timeZone: 'UTC' });
    dateFormats.set(key, f);
  }
  return f;
}

/** "2026-12-05" → "5 December 2026" / "5 ديسمبر 2026". */
export function formatDate(lang: Locale, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return dateFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "18:30" → "6:30 pm" / "6:30 م". */
export function formatTime(lang: Locale, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dateFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2023, 0, 1, h, m)));
}

/** 0 = Sunday … 6 = Saturday → "Saturday" / "السبت". */
export function weekdayName(lang: Locale, weekday: number): string {
  // 2023-01-01 was a Sunday.
  return dateFormat(lang, { weekday: 'long' }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));
}

/** "5 December 2026 to 30 January 2027". */
export function dateRange(lang: Locale, t: SiteStrings, start: string, end: string): string {
  return start === end ? formatDate(lang, start) : fmt(t.workshop.dateRange, { start: formatDate(lang, start), end: formatDate(lang, end) });
}

/**
 * Weekly slots as lines a visitor reads at a glance, days with the same hours
 * together: ["Saturday and Tuesday, 6:00 pm – 8:00 pm"].
 */
export function scheduleLines(lang: Locale, schedule: readonly ScheduleSlot[]): string[] {
  const groups = new Map<string, number[]>();
  for (const s of schedule) {
    const key = `${s.startTime}-${s.endTime}`;
    const days = groups.get(key) ?? [];
    if (!days.includes(s.weekday)) days.push(s.weekday);
    groups.set(key, days);
  }
  const list = new Intl.ListFormat(INTL_LOCALE[lang], { style: 'long', type: 'conjunction' });
  const sep = lang === 'ar' ? '، ' : ', ';
  return [...groups.entries()].map(([key, days]) => {
    const [start, end] = key.split('-') as [string, string];
    return `${list.format(days.map((d) => weekdayName(lang, d)))}${sep}${formatTime(lang, start)} – ${formatTime(lang, end)}`;
  });
}
