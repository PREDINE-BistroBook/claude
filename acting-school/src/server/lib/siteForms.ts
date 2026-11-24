/**
 * Abuse guards for the public website's two forms (the enquiry form "apply"
 * and the casting-call form "casting"), so the public pages (src/server/site/)
 * only do HTTP and HTML:
 * - form tokens: a hidden field `<issuedAt>.<hmac-sha256(siteFormSecret, issuedAt.kind)>`,
 *   refused when missing, forged, younger than 3 s (a bot) or older than 24 h;
 * - rate limits, in two steps: before a body is read every POST counts as one
 *   attempt of its client address (siteFormRateLimited, which also refuses
 *   when the address or the school has used up what may be stored); what is
 *   actually stored — submissions per address and school-wide, photo bytes per
 *   day — is counted at the write (countSiteFormSubmission), so junk that
 *   stores nothing can't use up the school's allowance.
 * The writes themselves: createWebsiteLead (lib/admissions.ts) and
 * createCastingApplication (lib/castingApplications.ts).
 */
import { createHmac } from 'node:crypto';
import type { DB } from '../db/database';
import { sameSecret } from './password';
import { DAY_MS, HOUR_MS, hitRateLimits, type RateLimitHit } from './rateLimit';
import { getSiteFormSecret } from './siteContent';

export type SiteFormKind = 'apply' | 'casting';

// ── Form tokens ─────────────────────────────────────────────────────────────

/** A form sent sooner than this after the page was served is a bot. */
export const FORM_TOKEN_MIN_AGE_MS = 3_000;
/** A page left open longer than this has to be reloaded. */
export const FORM_TOKEN_MAX_AGE_MS = DAY_MS;

function sign(secret: string, issuedAt: number, kind: SiteFormKind): string {
  return createHmac('sha256', secret).update(`${issuedAt}.${kind}`).digest('hex');
}

/** The hidden token for a form of `kind` rendered now (`now`: epoch ms). */
export function issueFormToken(db: DB, kind: SiteFormKind, now: number = Date.now()): string {
  return `${now}.${sign(getSiteFormSecret(db), now, kind)}`;
}

/** Why a token was refused, or 'ok'. Anything but 'ok': re-render the form with "please try again", store nothing. */
export type FormTokenCheck = 'ok' | 'missing' | 'invalid' | 'too_fast' | 'expired';

/** Check a submitted token for a form of `kind` (signature compared in constant time). */
export function checkFormToken(db: DB, token: unknown, kind: SiteFormKind, now: number = Date.now()): FormTokenCheck {
  if (typeof token !== 'string' || !token) return 'missing';
  const m = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(token.trim());
  if (!m) return 'invalid';
  const issuedAt = Number(m[1]);
  if (!sameSecret(m[2]!, sign(getSiteFormSecret(db), issuedAt, kind))) return 'invalid';
  const age = now - issuedAt;
  if (age < FORM_TOKEN_MIN_AGE_MS) return 'too_fast';
  if (age > FORM_TOKEN_MAX_AGE_MS) return 'expired';
  return 'ok';
}

// ── Rate limits ─────────────────────────────────────────────────────────────

/**
 * The public forms' limits (fixed windows, lib/rateLimit.ts).
 * - `attempts`: every POST of one client address, counted before its body is
 *   read — whatever becomes of it (a mistake in the form, a bad token, junk).
 *   Generous: someone who gets the form wrong a few times must still get through.
 * - `perAddress`: what one address may have *stored* per hour;
 * - `school`: what may be stored per day, from everyone together;
 * - `photoBytes`: bytes of casting photos kept per day, school-wide.
 */
export const SITE_RATE_LIMITS = {
  apply: {
    attempts: { limit: 20, windowMs: HOUR_MS },
    perAddress: { limit: 5, windowMs: HOUR_MS },
    school: { limit: 300, windowMs: DAY_MS },
  },
  casting: {
    attempts: { limit: 12, windowMs: HOUR_MS },
    perAddress: { limit: 3, windowMs: HOUR_MS },
    school: { limit: 100, windowMs: DAY_MS },
    /** Photo bytes kept per day, school-wide. */
    photoBytes: { limit: 300 * 1024 * 1024, windowMs: DAY_MS },
  },
} as const;

const PHOTO_BYTES_KEY = 'site:casting:photo-bytes';

/** The 8 groups of an IPv6 address ("2001:db8::1", "::ffff:192.0.2.1"), or null when it isn't one. */
function ipv6Groups(address: string): number[] | null {
  let text = address;
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const o = dotted.slice(2).map(Number) as [number, number, number, number];
    if (o.some((n) => n > 255)) return null;
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...new Array<number>(Math.max(missing, 0)).fill(0), ...tail];
}

/**
 * What the per-address counters are keyed by. An IPv4 address counts whole
 * (also when written as an IPv4-mapped IPv6 address); an IPv6 address by its
 * /64 — one home line, phone or server holds a whole /64, so its 18 billion
 * billion addresses must share one counter. No address: 'unknown' (shared).
 */
export function siteAddressKey(clientIp: string | null | undefined): string {
  const raw = (clientIp ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!raw) return 'unknown';
  if (!raw.includes(':')) return raw.slice(0, 64);
  const g = ipv6Groups(raw);
  if (!g) return raw.slice(0, 64);
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(':')}::/64`;
}

const attemptsKey = (kind: SiteFormKind, address: string) => `site:${kind}:attempts:${address}`;
const addressKey = (kind: SiteFormKind, address: string) => `site:${kind}:address:${address}`;
const schoolKey = (kind: SiteFormKind) => `site:${kind}:school`;

/**
 * **Before a POST's body is read** (with or without a Content-Length): count
 * one attempt from `clientIp` (c.get('clientIp'); null when unknown — those
 * share one counter) and look — without counting — whether that address or
 * the school has already used up what may be stored (and, for castings, the
 * day's photo allowance). Returns **true when a limit is hit**: answer the
 * friendly 429 page (nothing was counted).
 */
export function siteFormRateLimited(db: DB, kind: SiteFormKind, clientIp: string | null, now: number = Date.now()): boolean {
  const address = siteAddressKey(clientIp);
  const limits = SITE_RATE_LIMITS[kind];
  const hits: RateLimitHit[] = [
    { key: attemptsKey(kind, address), ...limits.attempts },
    { key: addressKey(kind, address), ...limits.perAddress, peek: true },
    { key: schoolKey(kind), ...limits.school, peek: true },
  ];
  if (kind === 'casting') hits.push({ key: PHOTO_BYTES_KEY, ...SITE_RATE_LIMITS.casting.photoBytes, peek: true });
  return hitRateLimits(db, hits, now);
}

/**
 * **At the write**, once the token and validation have passed and immediately
 * before storing (nothing awaits in between): count one stored submission of
 * `kind` for the address and for the school, plus — castings — the bytes of
 * the photos about to be kept. Returns **true when a limit is hit**: store
 * nothing and answer the 429 page (nothing was counted).
 */
export function countSiteFormSubmission(db: DB, kind: SiteFormKind, clientIp: string | null, now: number = Date.now(), photoBytes = 0): boolean {
  const address = siteAddressKey(clientIp);
  const limits = SITE_RATE_LIMITS[kind];
  const hits: RateLimitHit[] = [
    { key: addressKey(kind, address), ...limits.perAddress },
    { key: schoolKey(kind), ...limits.school },
  ];
  if (kind === 'casting') hits.push({ key: PHOTO_BYTES_KEY, ...SITE_RATE_LIMITS.casting.photoBytes, cost: Math.max(0, Math.floor(photoBytes)) });
  return hitRateLimits(db, hits, now);
}

/**
 * The honeypot was filled (a bot; the answer pretends success and nothing is
 * stored): count it like a stored submission of that address only, so the bot
 * meets the same per-address limit as a real sender — and never touches the
 * school-wide allowance.
 */
export function countSiteFormTrap(db: DB, kind: SiteFormKind, clientIp: string | null, now: number = Date.now()): void {
  hitRateLimits(db, [{ key: addressKey(kind, siteAddressKey(clientIp)), ...SITE_RATE_LIMITS[kind].perAddress }], now);
}
