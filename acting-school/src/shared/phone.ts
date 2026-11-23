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

/**
 * Invisible formatting characters that come along when a number is copied from
 * WhatsApp or another right-to-left context: zero-width space/joiners, LRM/RLM,
 * the bidi embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069)
 * and the byte-order mark.
 */
const INVISIBLE_MARKS_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/** No-break and other unusual spaces → a plain space. */
const ODD_SPACES_RE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * A phone number as we store it: Western digits, no invisible marks, single
 * spaces, trimmed. Otherwise kept as typed ("+20 101 234 5678" stays spaced).
 * Applied by the lead and student schemas, so stored numbers can be matched.
 */
export function normalizePhone(raw: string): string {
  return westernDigits(raw).replace(INVISIBLE_MARKS_RE, '').replace(ODD_SPACES_RE, ' ').replace(/\s+/g, ' ').trim();
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
 * Country codes whose national numbers never start with 0 (0 is only the
 * domestic trunk prefix), so "+20 010…", "+20 (0) 100…" or "0020 010…" mean
 * "+20 10…". Egypt and its neighbours, plus where students often come from.
 * Not every country: Italy (39) keeps its 0 after the code (+39 055… is
 * Florence), as do a few others, so a code is added here only when that is
 * certain. Country codes are prefix-free, so a match is unambiguous.
 */
export const TRUNK_ZERO_COUNTRY_CODES: readonly string[] = [
  // Egypt, the Arab world and the region
  '20', '212', '213', '216', '218', '249', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '90',
  // Europe and elsewhere
  '27', '30', '31', '32', '33', '34', '41', '43', '44', '49', '61', '91', '92',
];

/** "20" + "0101…" → "20101…" for the codes above (digits only, international form). */
function dropTrunkZero(digits: string): string {
  for (const code of TRUNK_ZERO_COUNTRY_CODES) {
    if (digits.startsWith(code)) return digits.startsWith(`${code}0`) ? code + digits.slice(code.length + 1) : digits;
  }
  return digits;
}

/** The number without invisible marks and with Western digits, trimmed — what the rules below look at. */
const cleaned = (raw: string) => westernDigits(raw).replace(INVISIBLE_MARKS_RE, '').trim();

/**
 * International digits for a phone number, without "+" (what wa.me wants), or
 * null when it can't be a phone number.
 * - "+20 101 …" or "0020 101 …" → already international: just the digits;
 * - "0101 …" (national trunk prefix 0) → the default country code + the rest;
 * - digits already starting with the country code ("20101…") → as they are;
 * - anything else ("101 …") → the default country code + the digits;
 * - a trunk 0 kept after a country code that never has one ("+20 (0) 10…") is dropped.
 */
export function internationalPhone(raw: string | null | undefined, defaultCountryCode: string): string | null {
  if (!raw) return null;
  const trimmed = cleaned(raw);
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
  digits = dropTrunkZero(digits);
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
  const s = cleaned(phone);
  const digits = phoneDigits(s);
  if (!digits) return null;
  return s.startsWith('+') ? `tel:+${dropTrunkZero(digits)}` : `tel:${digits}`;
}
