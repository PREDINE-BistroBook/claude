/**
 * Brakes on failed sign-ins, counted in the database (login_failures) so a
 * restart — or the Durable Object being evicted — doesn't wipe the slate.
 *
 * They are checked *before* the password is hashed. On Cloudflare the whole
 * school is one Durable Object and scrypt (~90 ms) runs on its only thread, so
 * every hash an anonymous visitor can trigger delays every staff request; a
 * brake that has tripped answers 429 at the cost of one small query. Layers:
 *
 * - account from one address: 10 failures per account per address in 15 minutes
 *   (someone mistyping; an attacker on one address can't lock the real person
 *   out from everywhere else). Without a known address: per account.
 * - account from anywhere: 100 per account in 15 minutes (one password guessed
 *   at from many addresses).
 * - address: 30 per address in 15 minutes, whatever the accounts (one machine
 *   trying many accounts, or random ones to keep the server hashing).
 * - school: 30 per minute in total (many machines at once). Bounds the time
 *   failed sign-ins can take from the server to ~3 s a minute; while it holds,
 *   nobody can sign in, but everyone already signed in carries on.
 *
 * "Account" is a name, not what was typed: sign-in takes a username or an
 * email address, and both of an account's names count on the same brakes —
 * the caller resolves the typed name first (one indexed read, still no
 * hashing) and passes signInBrakeNames(...) from lib/usernames.ts: the
 * account's email address (plus its username's automatic address when the
 * email is another one), or the typed name in its email form when it is
 * nobody's. The functions below call those names `accounts`: a sign-in is
 * stopped when the brakes of any of them have tripped, and a failure counts
 * on all of them.
 *
 * The address is the request's client IP when the runtime knows it
 * (CF-Connecting-IP on Cloudflare, the socket on Node: AppEnv clientIp).
 */
import { inArray, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/database';
import { loginFailures } from '../db/schema';

const MINUTE = 60 * 1000;

export const SIGN_IN_BRAKES = {
  accountFromAddress: { max: 10, windowMs: 15 * MINUTE },
  account: { max: 100, windowMs: 15 * MINUTE },
  address: { max: 30, windowMs: 15 * MINUTE },
  school: { max: 30, windowMs: MINUTE },
} as const;

const LONGEST_WINDOW = Math.max(...Object.values(SIGN_IN_BRAKES).map((b) => b.windowMs));

interface Brake {
  key: string;
  email: string | null;
  max: number;
  windowMs: number;
}

/** One name or several (signInBrakeNames), never none. */
type AccountNames = string | readonly string[];
const namesOf = (accounts: AccountNames): readonly string[] => (typeof accounts === 'string' ? [accounts] : accounts);

/** The brakes a sign-in for `accounts` (signInBrakeNames) from `address` counts towards. */
function brakesFor(accounts: AccountNames, address: string | null): Brake[] {
  const brakes: Brake[] = namesOf(accounts).flatMap((account) => [
    { key: `account:${account}|${address ?? ''}`, email: account, ...SIGN_IN_BRAKES.accountFromAddress },
    { key: `account:${account}`, email: account, ...SIGN_IN_BRAKES.account },
  ]);
  brakes.push({ key: 'school', email: null, ...SIGN_IN_BRAKES.school });
  if (address) brakes.push({ key: `address:${address}`, email: null, ...SIGN_IN_BRAKES.address });
  return brakes;
}

/** True when any brake for this sign-in has tripped (answer 429 without hashing anything). */
export function signInBlocked(db: DB, accounts: AccountNames, address: string | null, now = Date.now()): boolean {
  const brakes = brakesFor(accounts, address);
  const rows = db
    .select()
    .from(loginFailures)
    .where(inArray(loginFailures.key, brakes.map((b) => b.key)))
    .all();
  return brakes.some((b) => {
    const row = rows.find((r) => r.key === b.key);
    return !!row && now - row.firstAt <= b.windowMs && row.count >= b.max;
  });
}

/** One more failure on every brake this sign-in counts towards (a brake whose window is over starts again at 1). */
export function recordSignInFailure(db: DB, accounts: AccountNames, address: string | null, now = Date.now()) {
  db.transaction((tx) => {
    // Windows that are over, of anyone: keeps the table small.
    tx.delete(loginFailures).where(lt(loginFailures.firstAt, now - LONGEST_WINDOW)).run();
    for (const b of brakesFor(accounts, address)) {
      const over = sql`${loginFailures.firstAt} < ${now - b.windowMs}`;
      tx.insert(loginFailures)
        .values({ key: b.key, email: b.email, count: 1, firstAt: now })
        .onConflictDoUpdate({
          target: loginFailures.key,
          set: {
            count: sql`case when ${over} then 1 else ${loginFailures.count} + 1 end`,
            firstAt: sql`case when ${over} then ${now} else ${loginFailures.firstAt} end`,
          },
        })
        .run();
    }
  });
}

/** A successful sign-in clears that person's counts from this address (not the wider brakes). */
export function clearSignInFailures(db: DB, accounts: AccountNames, address: string | null) {
  const keys = namesOf(accounts).map((account) => `account:${account}|${address ?? ''}`);
  db.delete(loginFailures).where(inArray(loginFailures.key, keys)).run();
}

/** Lift every brake on the account with these names (signInBrakeNames — lockout recovery: POST /api/admin/grant-owner, npm run owner). */
export function clearAccountBrakes(db: DB, accounts: AccountNames) {
  db.delete(loginFailures).where(inArray(loginFailures.email, [...namesOf(accounts)])).run();
}
