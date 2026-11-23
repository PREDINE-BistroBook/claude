/**
 * Usernames on the server: who a typed sign-in name is, whether a username is
 * free, what a new account is called, and filling in usernames for accounts
 * older than the column. The rules themselves are in shared/usernames.ts.
 *
 * Two names lead to one account — its username and its email address — and
 * both are unique, so every check here looks at both where it matters. A
 * "taken" answer never says whose it is: it may be an owner's, whom the person
 * asking can't see.
 */
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { AUTH_ERROR_CODES } from '../../shared/schemas/auth';
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings';
import type { UsernameCheck } from '../../shared/schemas/staff';
import {
  EMAIL_DOMAIN_RE,
  automaticEmail,
  firstFreeUsername,
  isValidUsername,
  normalizeUsername,
  usernameCandidates,
  usernameFromEmail,
} from '../../shared/usernames';
import type { DB } from '../db/database';
import { settings, users } from '../db/schema';
import { ApiError, fieldError } from './errors';

type Reader = Pick<DB, 'select'>;
type UserRow = typeof users.$inferSelect;

/** An account's username as the API gives it. '' only for a row written without one, which the next start fills in (backfillUsernames). */
export function usernameOf(user: { username: string | null }): string {
  return user.username ?? '';
}

/** The emailDomain setting, read on its own (sign-in needs nothing else from the settings). */
export function emailDomainOf(db: Reader): string {
  const value = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'emailDomain')).get()?.value;
  return typeof value === 'string' && EMAIL_DOMAIN_RE.test(value) ? value : DEFAULT_SETTINGS.emailDomain;
}

/**
 * The account a typed sign-in name belongs to: by email address when it has an
 * "@", else by username (a username never has one). `name` is already trimmed
 * and lower-case (loginInput). One indexed read, no hashing.
 */
export function findSignInAccount(db: Reader, name: string): UserRow | undefined {
  return db
    .select()
    .from(users)
    .where(name.includes('@') ? eq(users.email, name) : eq(users.username, name))
    .get();
}

/**
 * The name the sign-in brakes count a failed sign-in under (lib/signInBrake.ts),
 * so the brakes stay per account: an account's email address, whichever of its
 * two names was typed — guessing at "salma" and at "salma@…" is one count, not
 * two. A name that is nobody's counts in its email form (a bare username gets
 * the automatic address it would have), so trying "ghost" and then
 * "ghost@<emailDomain>" behaves the same whether or not the account exists.
 */
export function signInBrakeName(account: { email: string } | undefined, typed: string, emailDomain: string): string {
  if (account) return account.email;
  return typed.includes('@') ? typed : automaticEmail(typed, emailDomain);
}

export function usernameInUse(db: Reader, username: string, exceptId?: number): boolean {
  const where = exceptId === undefined ? eq(users.username, username) : and(eq(users.username, username), ne(users.id, exceptId));
  return !!db.select({ id: users.id }).from(users).where(where).get();
}

export function emailInUse(db: Reader, email: string, exceptId?: number): boolean {
  const where = exceptId === undefined ? eq(users.email, email) : and(eq(users.email, email), ne(users.id, exceptId));
  return !!db.select({ id: users.id }).from(users).where(where).get();
}

/** 409 on `username`. Says only that it is taken — never by whom. */
export function usernameTakenError(): ApiError {
  return new ApiError(409, AUTH_ERROR_CODES.usernameTaken, 'Another account already uses this username', [
    { path: ['username'], code: 'custom', message: 'errors.usernameTaken' },
  ]);
}

export function emailTakenError(): ApiError {
  return new ApiError(409, 'email_taken', 'Another team account already uses this email', [
    { path: ['email'], code: 'custom', message: 'staff:errors.emailTaken' },
  ]);
}

/**
 * The username and email address of an account about to be created, or the
 * 409/400 that stops it. Reads only; call it again inside the transaction that
 * inserts (with the username it returned) so two requests can't both win.
 *
 * - A username was given: it must be free.
 * - None was given (an older copy of the app sent an email instead): one is
 *   made from the address's first part, else from the name, numbered if taken.
 * - An email was typed: it must be free. None: <username>@<emailDomain> — and
 *   if that address is someone's already, it is the username that reads "taken"
 *   (the person typing never saw the address).
 */
export function newAccountNames(
  db: Reader,
  input: { name: string; username?: string | null; email?: string | null },
  emailDomain: string,
): { username: string; email: string } {
  const typedEmail = input.email || null;
  let username = input.username || null;
  if (username) {
    if (usernameInUse(db, username)) throw usernameTakenError();
  } else {
    if (!typedEmail) throw fieldError(['username'], 'errors.required');
    const candidates = [usernameFromEmail(typedEmail), ...usernameCandidates(input.name)].filter((c): c is string => !!c);
    // Nothing usable in the address or the name (both in Arabic): "user", "user2", …
    username = firstFreeUsername(candidates.length ? [...new Set(candidates)] : ['user'], (c) => usernameInUse(db, c));
    if (!username) throw usernameTakenError();
  }
  if (typedEmail) {
    if (emailInUse(db, typedEmail)) throw emailTakenError();
    return { username, email: typedEmail };
  }
  const email = automaticEmail(username, emailDomain);
  if (emailInUse(db, email)) throw usernameTakenError();
  return { username, email };
}

/**
 * What changes when an account takes a new username: the username, and its
 * email address with it when that was the automatic one (<old username>@<emailDomain>)
 * — unless `keepEmail` (the same request sets the email itself). {} when the
 * username is the one it has. Throws the 409 when the username, or the address
 * that would go with it, is someone else's.
 */
export function usernameChange(
  db: Reader,
  account: Pick<UserRow, 'id' | 'username' | 'email'>,
  next: string,
  emailDomain: string,
  opts: { keepEmail?: boolean } = {},
): { username?: string; email?: string } {
  if (next === account.username) return {};
  if (usernameInUse(db, next, account.id)) throw usernameTakenError();
  const patch: { username: string; email?: string } = { username: next };
  if (!opts.keepEmail && account.username && account.email === automaticEmail(account.username, emailDomain)) {
    const email = automaticEmail(next, emailDomain);
    if (emailInUse(db, email, account.id)) throw usernameTakenError();
    patch.email = email;
  }
  return patch;
}

/**
 * A free username to offer for a person's name: the first name, then
 * first.last, then the first name with a number. "Free" also means the
 * automatic address that goes with it is nobody's. null for a name with no
 * Latin letters.
 */
export function suggestUsername(db: Reader, name: string, emailDomain: string): string | null {
  const candidates = usernameCandidates(name);
  if (!candidates.length) return null;
  // The whole team in one read (a school has tens of accounts): no query per candidate.
  const rows = db.select({ username: users.username, email: users.email }).from(users).all();
  const usernames = new Set(rows.map((r) => r.username));
  const emails = new Set(rows.map((r) => r.email));
  return firstFreeUsername(candidates, (c) => usernames.has(c) || emails.has(automaticEmail(c, emailDomain)));
}

/** GET /api/staff/username-check: is this username valid and free, and what to offer for this name. */
export function checkUsername(db: Reader, q: { username?: string; name?: string; exceptId?: number }, emailDomain: string): UsernameCheck {
  const typed = q.username ? normalizeUsername(q.username) : '';
  let status: UsernameCheck['status'] = null;
  if (typed) {
    if (!isValidUsername(typed)) status = 'invalid';
    else if (usernameInUse(db, typed, q.exceptId)) status = 'taken';
    else {
      // The address that would go with it. For an account being edited that only matters when its address follows the username.
      const current = q.exceptId === undefined ? undefined : db.select().from(users).where(eq(users.id, q.exceptId)).get();
      const follows = !current || (!!current.username && current.email === automaticEmail(current.username, emailDomain));
      status = follows && emailInUse(db, automaticEmail(typed, emailDomain), q.exceptId) ? 'taken' : 'ok';
    }
  }
  return {
    username: typed || null,
    status,
    suggestion: q.name ? suggestUsername(db, q.name, emailDomain) : null,
    automaticEmail: typed && status !== 'invalid' ? automaticEmail(typed, emailDomain) : null,
  };
}

/**
 * Accounts older than the username column get one, at startup (initDb): the
 * first part of their email address, cleaned to the rules ("Tom.Wilkins@…" →
 * "tom.wilkins"); a clash gets a number (ahmed, ahmed2); an address with
 * nothing usable before the "@" (Arabic, one letter) gets "user<id>". In id
 * order, so the same database always ends up with the same usernames. Returns
 * how many it filled in — 0 on every later start.
 */
export function backfillUsernames(db: DB): number {
  const missing = db
    .select({ id: users.id, email: users.email, updatedAt: users.updatedAt })
    .from(users)
    .where(isNull(users.username))
    .orderBy(asc(users.id))
    .all();
  if (!missing.length) return 0;
  db.transaction((tx) => {
    const taken = new Set(
      tx
        .select({ username: users.username })
        .from(users)
        .all()
        .flatMap((r) => (r.username ? [r.username] : [])),
    );
    for (const u of missing) {
      // One starting point per account — its address, else "user<id>" — numbered until it is free.
      const username = firstFreeUsername([usernameFromEmail(u.email) ?? `user${u.id}`], (c) => taken.has(c))!;
      taken.add(username);
      // updated_at stays as it was: nothing about the account changed for the people who read it.
      tx.update(users).set({ username, updatedAt: u.updatedAt }).where(eq(users.id, u.id)).run();
    }
  });
  return missing.length;
}
