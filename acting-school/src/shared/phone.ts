/**
 * Phone numbers as people type them ("010 1234 5678", "+20 101 234 5678",
 * "٠١٠١٢٣٤٥٦٧٨") → the international digits WhatsApp wants ("201012345678").
 * Shared by the web app (wa.me links) and the server (duplicate matching).
 * Budget is $0: WhatsApp means https://wa.me/<number>?text=… links, no API.
 */

/** Arabic-Indic (٠–٩) and Eastern Arabic-Indic (۰–۹) digits → Western digits. */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Only the digits of a phone number (Arabic digits converted); '' for nothing. */
export function phoneDigits(raw: string | null | undefined): string {
  return raw ? westernDigits(raw).replace(/\D/g, '') : '';
}

/** Shortest number we treat as a phone number at all (local numbers without area code are 7+ digits). */
export const MIN_PHONE_DIGITS = 7;
/** E.164 allows at most 15 digits. */
export const MAX_PHONE_DIGITS = 15;

/** A country calling code as stored in settings: 1–4 digits, no leading zero ("20", "971", "1"). */
export const COUNTRY_CODE_RE = /^[1-9]\d{0,3}$/;

/**
 * International digits for a phone number, without "+" (what wa.me wants), or
 * null when it can't be a phone number.
 * - "+20 101 …" or "0020 101 …" → already international: just the digits;
 * - "0101 …" (national trunk prefix 0) → the default country code + the rest;
 * - digits already starting with the country code ("20101…") → as they are;
 * - anything else ("101 …") → the default country code + the digits.
 */
export function internationalPhone(raw: string | null | undefined, defaultCountryCode: string): string | null {
  if (!raw) return null;
  const trimmed = westernDigits(raw).trim();
  let digits = phoneDigits(trimmed);
  if (!digits) return null;
  const cc = COUNTRY_CODE_RE.test(defaultCountryCode) ? defaultCountryCode : '';
  if (trimmed.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = cc + digits.slice(1);
  } else if (!cc || !digits.startsWith(cc)) {
    digits = cc + digits;
  }
  if (digits.length < MIN_PHONE_DIGITS + 1 || digits.length > MAX_PHONE_DIGITS) return null;
  return digits;
}

/** Same person's number? Compared as international digits (so "010…" matches "+20 10…"). */
export function samePhone(a: string | null | undefined, b: string | null | undefined, defaultCountryCode: string): boolean {
  const x = internationalPhone(a, defaultCountryCode);
  return x !== null && x === internationalPhone(b, defaultCountryCode);
}

/**
 * A wa.me link that opens a chat with this number (and a pre-written message
 * when `text` is given), or null when the number can't be used.
 */
export function whatsAppLink(phone: string | null | undefined, defaultCountryCode: string, text?: string): string | null {
  const n = internationalPhone(phone, defaultCountryCode);
  if (!n) return null;
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`;
}

/** A tel: link (keeps a leading "+", drops spaces and punctuation), or null without digits. */
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const s = westernDigits(phone).trim();
  const digits = phoneDigits(s);
  if (!digits) return null;
  return `tel:${s.startsWith('+') ? '+' : ''}${digits}`;
}
