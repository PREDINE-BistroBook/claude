/**
 * Phone numbers in SQL. Numbers are stored as typed (normalised since the
 * admissions module: Western digits, no invisible marks), but older rows can
 * hold Arabic-Indic digits ("٠١٠…") or bidi marks pasted from WhatsApp, so
 * matching never relies on a fixed list of separators: the `phone_digits()`
 * SQL function is phoneDigits() from shared/phone.ts itself.
 */
import type Database from 'better-sqlite3';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { MIN_PHONE_DIGITS, normalizePhone, phoneDigits } from '../../shared/phone';

/** Registers phone_digits(text) on a connection (createDb does it for every database). */
export function registerPhoneFunctions(sqlite: Database.Database) {
  sqlite.function('phone_digits', { deterministic: true }, (v: unknown) => (typeof v === 'string' ? phoneDigits(v) : ''));
}

/** The digits of a phone column: "+20 (10) ١٢٣-4567" → "20101234567"; '' for NULL. */
export function phoneDigitsSql(col: SQLWrapper): SQL<string> {
  return sql<string>`phone_digits(${col})`;
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
