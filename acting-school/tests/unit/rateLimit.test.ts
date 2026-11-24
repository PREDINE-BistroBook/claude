import { describe, expect, it } from 'vitest';
import { rateLimits } from '../../src/server/db/schema';
import { DAY_MS, HOUR_MS, hitRateLimit, hitRateLimits, MAX_RATE_LIMIT_WINDOW_MS, rateLimitUsed } from '../../src/server/lib/rateLimit';
import { countSiteFormSubmission, countSiteFormTrap, SITE_RATE_LIMITS, siteAddressKey, siteFormRateLimited } from '../../src/server/lib/siteForms';
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

describe('peek and rateLimitUsed (look without counting)', () => {
  it('a peek refuses when the counter is full but never adds to it', () => {
    const db = testDb();
    const peek = { key: 'stored', limit: 2, windowMs: HOUR_MS, peek: true };
    const attempt = { key: 'attempts', limit: 10, windowMs: HOUR_MS };
    for (let i = 0; i < 4; i++) expect(hitRateLimits(db, [attempt, peek], T0)).toBe(false);
    expect(rows(db)).toEqual([{ key: 'attempts', count: 4, windowStart: T0 }]);
    expect(rateLimitUsed(db, 'stored', HOUR_MS, T0)).toBe(0);
    hitRateLimit(db, 'stored', 2, HOUR_MS, T0);
    hitRateLimit(db, 'stored', 2, HOUR_MS, T0);
    expect(rateLimitUsed(db, 'stored', HOUR_MS, T0)).toBe(2);
    // Full: refused, and the attempt isn't counted either.
    expect(hitRateLimits(db, [attempt, peek], T0)).toBe(true);
    expect(rateLimitUsed(db, 'attempts', HOUR_MS, T0)).toBe(4);
    // Its window over: open again, still nothing written by the peek.
    expect(rateLimitUsed(db, 'stored', HOUR_MS, T0 + HOUR_MS)).toBe(0);
    expect(hitRateLimits(db, [attempt, peek], T0 + HOUR_MS)).toBe(false);
    expect(rows(db).find((r) => r.key === 'stored')).toEqual({ key: 'stored', count: 2, windowStart: T0 });
  });
});

describe('siteAddressKey (what the per-address limits are keyed by)', () => {
  it('IPv4 whole, IPv4-mapped as IPv4, IPv6 by its /64, nothing → unknown', () => {
    expect(siteAddressKey('198.51.100.7')).toBe('198.51.100.7');
    expect(siteAddressKey(' 198.51.100.7 ')).toBe('198.51.100.7');
    expect(siteAddressKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(siteAddressKey('::FFFF:c000:0201')).toBe('192.0.2.1');
    expect(siteAddressKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(siteAddressKey('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(siteAddressKey('[2001:db8:1:2:abcd::9]')).toBe('2001:db8:1:2::/64');
    expect(siteAddressKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(siteAddressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(siteAddressKey('::1')).toBe('0:0:0:0::/64');
    for (const none of [null, undefined, '', '   ']) expect(siteAddressKey(none)).toBe('unknown');
    // Not an address we can read: used as it is, never longer than a key should be.
    expect(siteAddressKey('gg::1::2')).toBe('gg::1::2');
    expect(siteAddressKey('x'.repeat(500))).toHaveLength(64);
  });
});

describe('the public forms’ limits (siteFormRateLimited before reading, countSiteFormSubmission at the write)', () => {
  it('the limits themselves', () => {
    expect(SITE_RATE_LIMITS.apply).toEqual({ attempts: { limit: 20, windowMs: HOUR_MS }, perAddress: { limit: 5, windowMs: HOUR_MS }, school: { limit: 300, windowMs: DAY_MS } });
    expect(SITE_RATE_LIMITS.casting).toEqual({
      attempts: { limit: 12, windowMs: HOUR_MS },
      perAddress: { limit: 3, windowMs: HOUR_MS },
      school: { limit: 100, windowMs: DAY_MS },
      photoBytes: { limit: 300 * 1024 * 1024, windowMs: DAY_MS },
    });
  });

  it('every POST counts as an attempt of its address only: junk never touches the school-wide or stored counters', () => {
    const db = testDb();
    for (let i = 0; i < 20; i++) expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0)).toBe(false);
    expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0)).toBe(true);
    expect(rows(db)).toEqual([{ key: 'site:apply:attempts:198.51.100.7', count: 20, windowStart: T0 }]);
    // Another address, the other form and the next hour are open.
    expect(siteFormRateLimited(db, 'apply', '198.51.100.8', T0)).toBe(false);
    expect(siteFormRateLimited(db, 'casting', '198.51.100.7', T0)).toBe(false);
    expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0 + HOUR_MS)).toBe(false);
  });

  it('apply: 5 stored per hour per address, 300 per day school-wide — counted at the write, refused before reading once full', () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) {
      expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0)).toBe(false);
      expect(countSiteFormSubmission(db, 'apply', '198.51.100.7', T0)).toBe(false);
    }
    // The address has stored its five: refused before reading, and the write would refuse too.
    expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0)).toBe(true);
    expect(countSiteFormSubmission(db, 'apply', '198.51.100.7', T0)).toBe(true);
    expect(rateLimitUsed(db, 'site:apply:school', DAY_MS, T0)).toBe(5);
    expect(siteFormRateLimited(db, 'apply', '198.51.100.8', T0)).toBe(false);
    expect(siteFormRateLimited(db, 'apply', '198.51.100.7', T0 + HOUR_MS)).toBe(false);

    // School-wide: 300 stored a day, whatever the address.
    const busy = testDb();
    for (let i = 0; i < 300; i++) expect(countSiteFormSubmission(busy, 'apply', `10.0.${Math.floor(i / 5)}.${i % 5}`, T0)).toBe(false);
    expect(siteFormRateLimited(busy, 'apply', '10.9.9.9', T0)).toBe(true);
    expect(countSiteFormSubmission(busy, 'apply', '10.9.9.9', T0)).toBe(true);
    expect(siteFormRateLimited(busy, 'apply', '10.9.9.9', T0 + DAY_MS)).toBe(false);
  });

  it('casting: 3 stored per hour per address, 100 per day, 300 MB of photos kept per day', () => {
    const db = testDb();
    for (let i = 0; i < 3; i++) expect(countSiteFormSubmission(db, 'casting', '203.0.113.1', T0, 1024)).toBe(false);
    expect(siteFormRateLimited(db, 'casting', '203.0.113.1', T0)).toBe(true);
    expect(rateLimitUsed(db, 'site:casting:photo-bytes', DAY_MS, T0)).toBe(3 * 1024);

    const busy = testDb();
    for (let i = 0; i < 100; i++) expect(countSiteFormSubmission(busy, 'casting', `10.1.${Math.floor(i / 3)}.${i % 3}`, T0, 1)).toBe(false);
    expect(siteFormRateLimited(busy, 'casting', '10.9.9.9', T0)).toBe(true);

    const bytes = testDb();
    const mb = 1024 * 1024;
    // 15 applications keeping 20 MB each fill the day's 300 MB.
    for (let i = 0; i < 15; i++) expect(countSiteFormSubmission(bytes, 'casting', `10.2.0.${i}`, T0, 20 * mb)).toBe(false);
    // Full: the next visitor is told before any photo is read…
    expect(siteFormRateLimited(bytes, 'casting', '10.2.1.1', T0)).toBe(true);
    // …and nothing was counted by the refusals.
    expect(rateLimitUsed(bytes, 'site:casting:photo-bytes', DAY_MS, T0)).toBe(300 * mb);
    expect(rows(bytes).some((r) => r.key.includes('10.2.1.1'))).toBe(false);
    // Nearly full: looking is fine, but photos that don't fit are refused at the write and count nothing.
    const nearly = testDb();
    hitRateLimit(nearly, 'site:casting:photo-bytes', 300 * mb, DAY_MS, T0, 300 * mb - 10);
    expect(siteFormRateLimited(nearly, 'casting', '10.3.0.1', T0)).toBe(false);
    expect(countSiteFormSubmission(nearly, 'casting', '10.3.0.1', T0, 11)).toBe(true);
    expect(rateLimitUsed(nearly, 'site:casting:school', DAY_MS, T0)).toBe(0);
    expect(countSiteFormSubmission(nearly, 'casting', '10.3.0.1', T0, 10)).toBe(false);
  });

  it('the addresses of one IPv6 /64 share their counters; another /64 and IPv4 do not', () => {
    const db = testDb();
    for (let i = 1; i <= 5; i++) expect(countSiteFormSubmission(db, 'apply', `2001:db8:1:2::${i}`, T0)).toBe(false);
    expect(siteFormRateLimited(db, 'apply', '2001:db8:1:2:ffff::9', T0)).toBe(true);
    expect(siteFormRateLimited(db, 'apply', '2001:db8:1:3::1', T0)).toBe(false);
    expect(siteFormRateLimited(db, 'apply', '192.0.2.1', T0)).toBe(false);
    // An IPv4-mapped address is that IPv4 address.
    for (let i = 0; i < 5; i++) countSiteFormSubmission(db, 'apply', '::ffff:192.0.2.1', T0);
    expect(siteFormRateLimited(db, 'apply', '192.0.2.1', T0)).toBe(true);
  });

  it('a filled honeypot counts against its own address only', () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) countSiteFormTrap(db, 'apply', '203.0.113.77', T0);
    expect(siteFormRateLimited(db, 'apply', '203.0.113.77', T0)).toBe(true);
    expect(rateLimitUsed(db, 'site:apply:school', DAY_MS, T0)).toBe(0);
  });

  it('an unknown client address shares one counter', () => {
    const db = testDb();
    for (let i = 0; i < 5; i++) countSiteFormSubmission(db, 'apply', i % 2 ? null : '  ', T0);
    expect(siteFormRateLimited(db, 'apply', null, T0)).toBe(true);
    expect(rows(db).map((r) => r.key).sort()).toEqual(['site:apply:address:unknown', 'site:apply:school']);
  });
});
