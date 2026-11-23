import { describe, expect, it } from 'vitest';
import { rateLimits } from '../../src/server/db/schema';
import { DAY_MS, HOUR_MS, hitRateLimit, hitRateLimits, MAX_RATE_LIMIT_WINDOW_MS } from '../../src/server/lib/rateLimit';
import { SITE_RATE_LIMITS, siteFormRateLimited } from '../../src/server/lib/siteForms';
import { testDb } from '../helpers';

const T0 = Date.UTC(2026, 10, 23, 10, 0, 0);
const rows = (db: ReturnType<typeof testDb>) => db.select().from(rateLimits).all();

describe('hitRateLimit (fixed windows in rate_limits)', () => {
  it('allows `limit` hits per window, then refuses without counting the refused ones', () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) expect(hitRateLimit(db, 'k', 5, HOUR_MS, T0 + i * 1000)).toBe(false);
    expect(hitRateLimit(db, 'k', 5, HOUR_MS, T0 + 10_000)).toBe(true);
    expect(hitRateLimit(db, 'k', 5, HOUR_MS, T0 + 20_000)).toBe(true);
    expect(rows(db)).toEqual([{ key: 'k', count: 5, windowStart: T0 }]);
  });

  it('a new window starts once the old one is over (at its first hit, not on the clock)', () => {
    const db = testDb();
    for (let i = 0; i < 3; i++) hitRateLimit(db, 'k', 3, HOUR_MS, T0);
    expect(hitRateLimit(db, 'k', 3, HOUR_MS, T0 + HOUR_MS - 1)).toBe(true);
    expect(hitRateLimit(db, 'k', 3, HOUR_MS, T0 + HOUR_MS)).toBe(false);
    expect(rows(db)).toEqual([{ key: 'k', count: 1, windowStart: T0 + HOUR_MS }]);
  });

  it('keys count separately', () => {
    const db = testDb();
    expect(hitRateLimit(db, 'a', 1, HOUR_MS, T0)).toBe(false);
    expect(hitRateLimit(db, 'a', 1, HOUR_MS, T0)).toBe(true);
    expect(hitRateLimit(db, 'b', 1, HOUR_MS, T0)).toBe(false);
  });

  it('a cost counts as that many hits; a cost over the limit is refused outright', () => {
    const db = testDb();
    expect(hitRateLimit(db, 'bytes', 100, DAY_MS, T0, 60)).toBe(false);
    expect(hitRateLimit(db, 'bytes', 100, DAY_MS, T0, 41)).toBe(true);
    expect(hitRateLimit(db, 'bytes', 100, DAY_MS, T0, 40)).toBe(false);
    expect(hitRateLimit(db, 'other', 100, DAY_MS, T0, 101)).toBe(true);
    expect(rows(db).find((r) => r.key === 'other')).toBeUndefined();
  });

  it('deletes rows past the longest window as new hits come in', () => {
    const db = testDb();
    hitRateLimit(db, 'old', 5, HOUR_MS, T0);
    hitRateLimit(db, 'recent', 5, HOUR_MS, T0 + DAY_MS - HOUR_MS);
    hitRateLimit(db, 'now', 5, HOUR_MS, T0 + DAY_MS + 1);
    expect(rows(db).map((r) => r.key).sort()).toEqual(['now', 'recent']);
  });

  it('refuses windows it could not keep (over 24 h, zero or negative)', () => {
    const db = testDb();
    expect(() => hitRateLimit(db, 'k', 5, MAX_RATE_LIMIT_WINDOW_MS + 1, T0)).toThrow();
    expect(() => hitRateLimit(db, 'k', 5, 0, T0)).toThrow();
    expect(() => hitRateLimit(db, 'k', 5, -1, T0)).toThrow();
    expect(rows(db)).toEqual([]);
  });
});

describe('hitRateLimits (several counters at once)', () => {
  it('counts every counter only when none would go over', () => {
    const db = testDb();
    const hits = [
      { key: 'address', limit: 2, windowMs: HOUR_MS },
      { key: 'school', limit: 3, windowMs: DAY_MS },
    ];
    expect(hitRateLimits(db, hits, T0)).toBe(false);
    expect(hitRateLimits(db, hits, T0)).toBe(false);
    // The address is full: refused, and the school counter isn't touched.
    expect(hitRateLimits(db, hits, T0)).toBe(true);
    expect(rows(db).find((r) => r.key === 'school')!.count).toBe(2);
    // Another address still gets the school's last place.
    expect(hitRateLimits(db, [{ key: 'address2', limit: 2, windowMs: HOUR_MS }, hits[1]!], T0)).toBe(false);
    expect(hitRateLimits(db, [{ key: 'address3', limit: 2, windowMs: HOUR_MS }, hits[1]!], T0)).toBe(true);
    expect(rows(db).find((r) => r.key === 'address3')).toBeUndefined();
  });
});

describe('siteFormRateLimited (the public forms’ limits)', () => {
  it('apply: 5 per hour per address, 300 per day school-wide', () => {
    const db = testDb();
    expect(SITE_RATE_LIMITS.apply).toEqual({ perAddress: { limit: 5, windowMs: HOUR_MS }, school: { limit: 300, windowMs: DAY_MS } });
    for (let i = 0; i < 5; i++) expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0)).toBe(false);
    expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0)).toBe(true);
    expect(siteFormRateLimited(db, 'apply', '198.51.100.8', T0)).toBe(false);
    // The other form has its own counters.
    expect(siteFormRateLimited(db, 'casting', '198.51.100.7', T0, 1000)).toBe(false);
    // An hour later the address may send again.
    expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0 + HOUR_MS)).toBe(false);

    // School-wide: 300 a day, whatever the address.
    const busy = testDb();
    for (let i = 0; i < 300; i++) expect(siteFormRateLimited(busy, 'apply', `10.0.${Math.floor(i / 5)}.${i % 5}`, T0)).toBe(false);
    expect(siteFormRateLimited(busy, 'apply', '10.9.9.9', T0)).toBe(true);
    expect(siteFormRateLimited(busy, 'apply', '10.9.9.9', T0 + DAY_MS)).toBe(false);
  });

  it('casting: 3 per hour per address, 100 per day school-wide, 300 MB of photos per day', () => {
    const db = testDb();
    for (let i = 0; i < 3; i++) expect(siteFormRateLimited(db, 'casting', '203.0.113.1', T0, 1024)).toBe(false);
    expect(siteFormRateLimited(db, 'casting', '203.0.113.1', T0, 1024)).toBe(true);

    const busy = testDb();
    for (let i = 0; i < 100; i++) expect(siteFormRateLimited(busy, 'casting', `10.1.${Math.floor(i / 3)}.${i % 3}`, T0, 1)).toBe(false);
    expect(siteFormRateLimited(busy, 'casting', '10.9.9.9', T0, 1)).toBe(true);

    const bytes = testDb();
    const mb = 1024 * 1024;
    // 15 bodies of 20 MB fill the day's 300 MB; the 16th is refused even from a new address.
    for (let i = 0; i < 15; i++) expect(siteFormRateLimited(bytes, 'casting', `10.2.0.${i}`, T0, 20 * mb)).toBe(false);
    expect(siteFormRateLimited(bytes, 'casting', '10.2.1.1', T0, 20 * mb)).toBe(true);
    // The refusal counted nothing: that address may still send a small one.
    expect(siteFormRateLimited(bytes, 'casting', '10.2.1.1', T0, 0)).toBe(false);
  });

  it('an unknown client address shares one counter', () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) siteFormRateLimited(db, 'apply', i % 2 ? null : '  ', T0);
    expect(siteFormRateLimited(db, 'apply', null, T0)).toBe(true);
    expect(rows(db).map((r) => r.key).sort()).toEqual(['site:apply:address:unknown', 'site:apply:school']);
  });
});
