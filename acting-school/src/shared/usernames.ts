/**
 * Usernames: the name a team member signs in with (their email address works
 * in the same field too — see loginInput in schemas/auth.ts).
 *
 * The rules, in one place for the browser and the server:
 * - 3–20 characters from a–z 0–9 . _ - ;
 * - the first one is a letter;
 * - stored and compared lower-case; unique across the team.
 *
 * A username never contains "@", so whatever is typed at sign-in is an email
 * address when it has one and a username when it doesn't.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,19}$/;

/** As typed → as stored and compared: no spaces around it, lower-case. Whether it is allowed is USERNAME_RE's job. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
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
  const candidates = [first, ...(last ? [`${first}.${last}`] : [])].map((c) => c.replace(/^[^a-z]+/, '').slice(0, USERNAME_MAX));
  return [...new Set(candidates)].filter(isValidUsername);
}

/**
 * The username an email address stands for — its part before the "@", cleaned
 * to the rules ("Tom.Wilkins@x" → "tom.wilkins") — or null when nothing valid
 * is left (an Arabic or one-letter local part).
 */
export function usernameFromEmail(email: string): string | null {
  const local = email.split('@')[0] ?? '';
  const cleaned = plainLatin(local)
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, USERNAME_MAX);
  return isValidUsername(cleaned) ? cleaned : null;
}

/** `base` with a number on the end, still within the length rule: ('ahmed', 2) → 'ahmed2'. */
export function numberedUsername(base: string, n: number): string {
  const digits = String(n);
  return `${base.slice(0, USERNAME_MAX - digits.length)}${digits}`;
}

/**
 * The first free username: each candidate as it is, then the first candidate
 * with a number (ahmed2, ahmed3, …). null when there is nothing to start from.
 * Deterministic: the same candidates and the same taken names give the same answer.
 */
export function firstFreeUsername(candidates: readonly string[], taken: (username: string) => boolean): string | null {
  for (const c of candidates) if (!taken(c)) return c;
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
