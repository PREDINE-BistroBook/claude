/**
 * Abuse guards for the public website's two forms (the enquiry form "apply"
 * and the casting-call form "casting"), so the public pages (src/server/site/)
 * only do HTTP and HTML:
 * - form tokens: a hidden field `<issuedAt>.<hmac-sha256(siteFormSecret, issuedAt.kind)>`,
 *   refused when missing, forged, younger than 3 s (a bot) or older than 24 h;
 * - rate limits per client address and school-wide (plus photo bytes per day
 *   for castings), checked before any photo is parsed or anything is written.
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

/** The public forms' limits (fixed windows, lib/rateLimit.ts). */
export const SITE_RATE_LIMITS = {
  apply: {
    perAddress: { limit: 5, windowMs: HOUR_MS },
    school: { limit: 300, windowMs: DAY_MS },
  },
  casting: {
    perAddress: { limit: 3, windowMs: HOUR_MS },
    school: { limit: 100, windowMs: DAY_MS },
    /** Photo bytes received per day, school-wide. */
    photoBytes: { limit: 300 * 1024 * 1024, windowMs: DAY_MS },
  },
} as const;

/**
 * Count one submission of `kind` from `clientIp` (c.get('clientIp'); null when
 * unknown — those share one per-address counter). For castings pass the body
 * size (Content-Length, or the bytes read) as `bodyBytes`, counted against the
 * daily photo allowance. Returns **true when a limit is hit**: answer the
 * friendly 429 page (nothing was counted). Call before parsing photos and
 * before any write.
 */
export function siteFormRateLimited(db: DB, kind: SiteFormKind, clientIp: string | null, now: number = Date.now(), bodyBytes = 0): boolean {
  const address = clientIp?.trim() || 'unknown';
  const hits: RateLimitHit[] = [
    { key: `site:${kind}:address:${address}`, ...SITE_RATE_LIMITS[kind].perAddress },
    { key: `site:${kind}:school`, ...SITE_RATE_LIMITS[kind].school },
  ];
  if (kind === 'casting') hits.push({ key: 'site:casting:photo-bytes', ...SITE_RATE_LIMITS.casting.photoBytes, cost: Math.max(0, Math.floor(bodyBytes)) });
  return hitRateLimits(db, hits, now);
}
