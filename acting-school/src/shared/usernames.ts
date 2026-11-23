/**
 * Usernames: the name a team member signs in with (their email address works
 * in the same field too — see loginInput in schemas/auth.ts).
 *
 * The rules, in one place for the browser and the server:
 * - 3–20 characters from a–z 0–9 . _ - ;
 * - the first one is a letter and the last one a letter or digit, with never
 *   two of . _ - in a row — so <username>@<domain> is always an address mail
 *   systems (and the app's own email check) accept: "abc." or "a..b" are not;
 * - stored and compared lower-case; unique across the team;
 * - not one of RESERVED_USERNAMES (the studio's own mail and web names).
 *
 * A username never contains "@", so whatever is typed at sign-in is an email
 * address when it has one and a username when it doesn't.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** A letter, then 2–19 more: letters and digits, or one of . _ - followed by a letter or digit. */
export const USERNAME_RE = /^[a-z](?:[a-z0-9]|[._-](?=[a-z0-9])){2,19}$/;

/**
 * Names nobody's username may be, because the automatic address that goes
 * with it (<username>@<emailDomain>) is one the studio itself needs: the
 * addresses certificate authorities send domain checks to (admin@,
 * administrator@, hostmaster@, postmaster@, webmaster@), the ones RFC 2142
 * names for a domain (info@ — the studio's public address in Part H —,
 * support@, abuse@, security@, …) and the usual system names. Refused for
 * everyone, managers and the operator included; the backfill and the
 * suggestions skip them (admin → admin2).
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'abuse', 'admin', 'administrator', 'api', 'billing', 'contact', 'do-not-reply', 'donotreply', 'ftp', 'help',
  'hostmaster', 'info', 'mail', 'mailer-daemon', 'marketing', 'news', 'no-reply', 'noc', 'noreply', 'null',
  'postmaster', 'root', 'sales', 'security', 'ssl-admin', 'ssladmin', 'support', 'sysadmin', 'usenet', 'uucp',
  'webmaster', 'www',
]);

/**
 * Names that read as a position in the studio (ceo@, cfo@ — Part H's studio
 * addresses — owner, director, …). Someone who manages the team (staff.manage)
 * or the operator may give one; nobody can take one for themselves in My
 * profile, where it would bring them the address and make lockout recovery by
 * that name (npm run owner -- ceo) pick the wrong person.
 */
export const ROLE_USERNAMES: ReadonlySet<string> = new Set([
  'ceo', 'cfo', 'coo', 'cto', 'owner', 'director', 'manager', 'finance', 'accounts', 'hr',
  'executive_director', 'head_of_casting', 'casting_team', 'video_editor', 'acting_coach',
]);

export function isReservedUsername(value: string): boolean {
  return RESERVED_USERNAMES.has(value);
}

export function isRoleUsername(value: string): boolean {
  return ROLE_USERNAMES.has(value);
}

/** As typed → as stored and compared: no spaces around it, lower-case. Whether it is allowed is USERNAME_RE's job. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Follows the rules (USERNAME_RE) and is not reserved. */
export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value) && !isReservedUsername(value);
}

/**
 * Cleaned towards the rules: one separator where several were in a row
 * ("a..b" → "a.b"), cut to the length rule, no separator at the end — so a
 * name or an address can be turned into a username.
 */
function tidyUsername(text: string): string {
  return text
    .replace(/[._-]{2,}/g, (run) => run[0]!)
    .replace(/^[^a-z]+/, '')
    .slice(0, USERNAME_MAX)
    .replace(/[._-]+$/, '');
}

/** Accents off, lower-case: "José" → "jose". Letters of other scripts are left as they are (and dropped by the callers). */
const plainLatin = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The Latin letters and digits of one word of a name; '' for a word with none (an Arabic name). */
const latinWord = (word: string) => plainLatin(word).replace(/[^a-z0-9]/g, '');

/**
 * Usernames to offer for a person's name, best first: the first name, then
 * first.last — "Ahmed Abdellah" → ['ahmed', 'ahmed.abdellah']. Only Latin
 * letters count: a name written only in Arabic gives [] (the person adding
 * types a username). Every entry is a valid username.
 */
export function usernameCandidates(name: string): string[] {
  const words = name.split(/\s+/).map(latinWord).filter(Boolean);
  const first = words[0];
  if (!first) return [];
  const last = words.length > 1 ? words[words.length - 1]! : null;
  const candidates = [first, ...(last ? [`${first}.${last}`] : [])].map(tidyUsername);
  return [...new Set(candidates)].filter(isValidUsername);
}

/**
 * The username an email address stands for — its part before the "@", cleaned
 * to the rules ("Tom.Wilkins@x" → "tom.wilkins", "abc.@x" → "abc") — or null
 * when nothing valid is left (an Arabic or one-letter local part). A reserved
 * name comes back as it is, as a starting point: firstFreeUsername numbers it.
 */
export function usernameFromEmail(email: string): string | null {
  const local = email.split('@')[0] ?? '';
  const cleaned = tidyUsername(plainLatin(local).replace(/[^a-z0-9._-]/g, ''));
  return USERNAME_RE.test(cleaned) ? cleaned : null;
}

/** `base` with a number on the end, still within the length rule: ('ahmed', 2) → 'ahmed2'. */
export function numberedUsername(base: string, n: number): string {
  const digits = String(n);
  return `${base.slice(0, USERNAME_MAX - digits.length)}${digits}`;
}

/**
 * The first free username: each candidate as it is, then the first candidate
 * with a number (ahmed2, ahmed3, …). A reserved name counts as taken
 * (admin@… → admin2). null when there is nothing to start from.
 * Deterministic: the same candidates and the same taken names give the same answer.
 */
export function firstFreeUsername(candidates: readonly string[], taken: (username: string) => boolean): string | null {
  for (const c of candidates) if (!isReservedUsername(c) && !taken(c)) return c;
  const base = candidates[0];
  if (!base) return null;
  for (let n = 2; n < 10_000; n++) {
    const c = numberedUsername(base, n);
    if (!taken(c)) return c;
  }
  return null;
}

/** The address an account gets when nobody types one: <username>@<the school's email domain>. */
export function automaticEmail(username: string, emailDomain: string): string {
  return `${username}@${emailDomain}`;
}

/** A domain name as the emailDomain setting stores it: lower-case labels and a top-level name, no "@", no spaces. */
export const EMAIL_DOMAIN_RE = /^(?=.{4,190}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
