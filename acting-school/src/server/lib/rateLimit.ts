/**
 * Fixed-window counters in the database (rate_limits), for the public
 * website's forms: a restart, or the Durable Object being evicted, doesn't
 * reset them. Each key's window starts at its first counted hit and lasts
 * `windowMs` (at most a day); expired rows are deleted as new hits come in,
 * one statement, no parameters that grow — within the Durable Object limits.
 */
import { eq, lt } from 'drizzle-orm';
import type { DB } from '../db/database';
import { rateLimits } from '../db/schema';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
/** The longest window supported: a row older than this is expired for every key, so it can be deleted. */
export const MAX_RATE_LIMIT_WINDOW_MS = DAY_MS;

/** One counter to check: `cost` (default 1) more against `limit` per `windowMs`. */
export interface RateLimitHit {
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
}

/**
 * Check several counters together, in one transaction: if any would go over
 * its limit, nothing is counted and the answer is true (refuse the request);
 * otherwise every counter is incremented and the answer is false (go ahead).
 * `now` is epoch ms (Date.now()).
 */
export function hitRateLimits(db: DB, hits: readonly RateLimitHit[], now: number): boolean {
  for (const h of hits) {
    if (!(h.windowMs > 0 && h.windowMs <= MAX_RATE_LIMIT_WINDOW_MS)) throw new Error(`Rate limit window must be 1 ms … 24 h (${h.key})`);
  }
  return db.transaction((tx) => {
    // Opportunistic clean-up: nothing older than the longest window is still counting.
    tx.delete(rateLimits).where(lt(rateLimits.windowStart, now - MAX_RATE_LIMIT_WINDOW_MS)).run();
    const plans = hits.map((h) => {
      const row = tx.select().from(rateLimits).where(eq(rateLimits.key, h.key)).get();
      const fresh = !row || row.windowStart <= now - h.windowMs;
      const cost = h.cost ?? 1;
      const used = fresh ? 0 : row.count;
      return { key: h.key, fresh, count: used + cost, over: used + cost > h.limit };
    });
    if (plans.some((p) => p.over)) return true;
    for (const p of plans) {
      if (p.fresh) {
        tx.insert(rateLimits)
          .values({ key: p.key, count: p.count, windowStart: now })
          .onConflictDoUpdate({ target: rateLimits.key, set: { count: p.count, windowStart: now } })
          .run();
      } else {
        tx.update(rateLimits).set({ count: p.count }).where(eq(rateLimits.key, p.key)).run();
      }
    }
    return false;
  });
}

/**
 * Count one hit (or `cost`) against `key`: at most `limit` per `windowMs`
 * (≤ 24 h). Returns **true when the limit is hit** — refuse the request
 * (nothing was counted); false when it was counted and may go ahead.
 *
 *   if (hitRateLimit(db, `apply:address:${ip}`, 5, HOUR_MS, Date.now())) return tooManyPage();
 */
export function hitRateLimit(db: DB, key: string, limit: number, windowMs: number, now: number, cost = 1): boolean {
  return hitRateLimits(db, [{ key, limit, windowMs, cost }], now);
}
