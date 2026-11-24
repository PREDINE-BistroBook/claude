/**
 * Phone numbers in SQL. Numbers are stored as typed (normalised since the
 * admissions module: Western digits, no invisible marks), but older rows can
 * hold Arabic-Indic digits ("٠١٠…") or bidi marks pasted from WhatsApp, so
 * matching never relies on a fixed list of separators: students and leads keep
 * `phone_digits`, phoneDigits() from shared/phone.ts of their phone, written by
 * the app on every write (withPhoneDigits) and filled in at startup for older
 * rows (backfillPhoneDigits). A stored column rather than a SQL function:
 * SQLite on Cloudflare Durable Objects can't register JS functions.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { MIN_PHONE_DIGITS, normalizePhone, phoneDigits } from '../../shared/phone';
import type { DB } from '../db/database';
import { leads, students } from '../db/schema';

/**
 * Insert/update values with `phoneDigits` in step with `phone`. Every write of
 * students.phone or leads.phone goes through it; values without a phone key are
 * returned as they are.
 */
export function withPhoneDigits<T extends { phone?: string | null }>(values: T): T & { phoneDigits?: string | null } {
  if (values.phone === undefined) return values;
  return { ...values, phoneDigits: values.phone === null ? null : phoneDigits(values.phone) };
}

/** Startup: rows with a phone but no phone_digits yet (written before the column existed) get it. Returns how many. */
export function backfillPhoneDigits(db: DB): number {
  let n = 0;
  db.transaction((tx) => {
    for (const table of [students, leads] as const) {
      const rows = tx
        .select({ id: table.id, phone: table.phone })
        .from(table)
        .where(and(isNotNull(table.phone), isNull(table.phoneDigits)))
        .all();
      for (const r of rows) {
        tx.update(table).set({ phoneDigits: phoneDigits(r.phone) }).where(eq(table.id, r.id)).run();
        n++;
      }
    }
  });
  return n;
}

/**
 * When a search term looks like (part of) a phone number, the digit runs to
 * look for in stored numbers' digits; null when it doesn't. Covers:
 * - the digits as typed (Arabic digits and pasted marks included): "0122 000" → "0122000";
 * - a local number with its trunk 0 against one stored internationally: "0101…" → also "101…";
 * - an international number against one stored locally: "+20 100 765 4321",
 *   "0020 100…" or "20100…" → also "1007654321" (a trunk 0 after the code dropped too).
 */
export function phoneSearchDigits(term: string, countryCode: string): string[] | null {
  const plain = normalizePhone(term);
  const digits = plain.replace(/[\s\-().+/]/g, '');
  if (!/^\d{3,}$/.test(digits)) return null;
  const out = new Set([digits]);
  if (digits.startsWith('0') && !digits.startsWith('00') && digits.length > 3) out.add(digits.slice(1));
  const intl = plain.startsWith('+')
    ? digits
    : digits.startsWith('00')
      ? digits.slice(2)
      : countryCode && digits.startsWith(countryCode) && digits.length > MIN_PHONE_DIGITS
        ? digits
        : null;
  if (intl && countryCode && intl.startsWith(countryCode)) {
    let national = intl.slice(countryCode.length);
    if (national.startsWith('0')) national = national.slice(1);
    if (national.length >= 3) out.add(national);
  }
  return [...out];
}
