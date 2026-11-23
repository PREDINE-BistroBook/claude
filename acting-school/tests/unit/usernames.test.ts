import Database from 'better-sqlite3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MIGRATIONS_DIR } from '../../scripts/bundle-migrations';
import { createApp } from '../../src/server/app';
import { testConfig } from '../../src/server/config';
import { initDb, type DB } from '../../src/server/db/database';
import { applyMigrations } from '../../src/server/db/migrate';
import bundle from '../../src/server/db/migrations/bundle';
import * as schema from '../../src/server/db/schema';
import { memoryFileStore } from '../../src/server/lib/fileStore';
import { hashPassword } from '../../src/server/lib/password';
import { durableObjectLimits } from '../../src/server/lib/sqlLimits';
import { backfillUsernames, signInBrakeNames } from '../../src/server/lib/usernames';
import { choosePasswordForm, loginInput, signInNameOf } from '../../src/shared/schemas/auth';
import { username as usernameSchema } from '../../src/shared/schemas/common';
import { settingsInput } from '../../src/shared/schemas/settings';
import { staffCreateInput } from '../../src/shared/schemas/staff';
import {
  EMAIL_DOMAIN_RE,
  RESERVED_USERNAMES,
  ROLE_USERNAMES,
  USERNAME_MAX,
  USERNAME_RE,
  automaticEmail,
  firstFreeUsername,
  isReservedUsername,
  isRoleUsername,
  isValidUsername,
  normalizeUsername,
  numberedUsername,
  usernameCandidates,
  usernameFromEmail,
} from '../../src/shared/usernames';

const { users } = schema;

describe('username rules (shared/usernames.ts)', () => {
  it('3–20 characters from a–z 0–9 . _ -, starting with a letter', () => {
    for (const ok of ['ceo', 'cfo', 'ali', 'salma', 'hamzawy', 'coach2', 'ahmed.abdellah', 'a_b', 'a-b', 'x'.repeat(20), 'a1.2_3-4']) {
      expect(isValidUsername(ok), ok).toBe(true);
    }
    for (const bad of ['', 'ab', 'x'.repeat(21), '2pac', '.abc', '_abc', '-abc', 'Salma', 'sal ma', 'salma@x', 'sal/ma', 'سلمى', 'salmá', 'a\nbc']) {
      expect(isValidUsername(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(USERNAME_RE.test('abc')).toBe(true);
    expect(USERNAME_MAX).toBe(20);
  });

  it('ends with a letter or digit and never has two of . _ - in a row — so <username>@<domain> passes the app’s own email check', () => {
    for (const bad of ['abc.', 'abc_', 'abc-', 'a..b', 'a._b', 'a-_b', 'ab.-', `${'x'.repeat(19)}.`]) {
      expect(isValidUsername(bad), bad).toBe(false);
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
    for (const ok of ['a.b', 'a_b', 'a-b', 'a.b.c', 'a1.2', 'ab.c2', `${'x'.repeat(18)}.y`]) expect(isValidUsername(ok), ok).toBe(true);
    // Every valid username makes an address zod accepts — the edit form sends the stored address back.
    for (const u of ['a.b', 'a_b', 'a-b', 'abc', 'x1.y-z_9', `${'x'.repeat(18)}.y`]) {
      expect(z.email().safeParse(automaticEmail(u, 'turquoisestudio.app')).success, u).toBe(true);
    }
  });

  it('reserved names (the studio’s mail and web names) are nobody’s username; position names are a manager’s to give', () => {
    for (const name of ['admin', 'administrator', 'postmaster', 'hostmaster', 'webmaster', 'info', 'abuse', 'root', 'support', 'no-reply', 'mailer-daemon', 'null', 'api']) {
      expect(isReservedUsername(name), name).toBe(true);
      expect(isValidUsername(name), name).toBe(false);
      const r = usernameSchema.safeParse(name);
      expect(r.success ? null : r.error.issues[0]!.message, name).toBe('errors.usernameReserved');
    }
    // A number makes it an ordinary name again — that is how the backfill and the suggestions step around them.
    expect(isValidUsername('admin2')).toBe(true);
    expect(firstFreeUsername(['admin'], () => false)).toBe('admin2');
    expect(firstFreeUsername(['info', 'info.desk'], () => false)).toBe('info.desk');
    // Every reserved name would otherwise be a valid username (the list holds nothing the rules refuse anyway).
    for (const name of RESERVED_USERNAMES) expect(USERNAME_RE.test(name), name).toBe(true);
    // Position names stay valid usernames (the real team's ceo and cfo) — only taking one yourself is refused, by the profile route.
    for (const name of ['ceo', 'cfo', 'owner', 'director']) {
      expect(isRoleUsername(name), name).toBe(true);
      expect(isValidUsername(name), name).toBe(true);
    }
    for (const name of ROLE_USERNAMES) expect(isReservedUsername(name), name).toBe(false);
    // None of the demo's usernames is reserved.
    for (const name of ['owner', 'cfo', 'director', 'head', 'casting', 'editor', 'coach', 'coach2', 'tom']) expect(isValidUsername(name), name).toBe(true);
  });

  it('is stored and compared lower-case, without the spaces around it', () => {
    expect(normalizeUsername('  Salma ')).toBe('salma');
    expect(usernameSchema.parse('  Ahmed.Abdellah ')).toBe('ahmed.abdellah');
  });

  it('the zod schema says "Required" for an empty field and gives the rules for anything else that breaks them', () => {
    const message = (v: unknown) => {
      const r = usernameSchema.safeParse(v);
      return r.success ? null : [r.error.issues[0]!.code, r.error.issues[0]!.message];
    };
    expect(message('salma')).toBeNull();
    expect(message('   ')?.[0]).toBe('too_small');
    expect(message('ab')).toEqual(['invalid_format', 'errors.usernameInvalid']);
    expect(message('سلمى')).toEqual(['invalid_format', 'errors.usernameInvalid']);
    expect(message('with space')).toEqual(['invalid_format', 'errors.usernameInvalid']);
    expect(message(42)?.[0]).toBe('invalid_type');
  });

  it('offers the first name, then first.last — Latin letters only', () => {
    expect(usernameCandidates('Ahmed Abdellah')).toEqual(['ahmed', 'ahmed.abdellah']);
    expect(usernameCandidates('Salma')).toEqual(['salma']);
    expect(usernameCandidates('Ali El Gohary')).toEqual(['ali', 'ali.gohary']);
    expect(usernameCandidates('  José   Núñez ')).toEqual(['jose', 'jose.nunez']);
    expect(usernameCandidates("Mary-Jane O'Neil")).toEqual(['maryjane', 'maryjane.oneil']);
    // A first name too short to be a username on its own: only first.last.
    expect(usernameCandidates('Al Pacino')).toEqual(['al.pacino']);
    // Cut to the length rule.
    expect(usernameCandidates('Abdelrahman Tamamelsayedmohamed')).toEqual(['abdelrahman', 'abdelrahman.tamamels']);
    // Only in Arabic: nothing to offer, the person adding types one.
    expect(usernameCandidates('سلمى إبراهيم')).toEqual([]);
    expect(usernameCandidates('')).toEqual([]);
    // Arabic and Latin together: the Latin part.
    expect(usernameCandidates('أحمد Ahmed Tamam')).toEqual(['ahmed', 'ahmed.tamam']);
    for (const name of ['Ahmed Abdellah', 'Al Pacino', '3D Max', 'X Æ A-12', 'Jo']) for (const c of usernameCandidates(name)) expect(isValidUsername(c), c).toBe(true);
  });

  it('makes a username from an email address, or says it can’t', () => {
    expect(usernameFromEmail('owner@demo.school')).toBe('owner');
    expect(usernameFromEmail('tom.wilkins@demo.school')).toBe('tom.wilkins');
    expect(usernameFromEmail('salma+studio@gmail.com')).toBe('salmastudio');
    expect(usernameFromEmail('1st.coach@x.com')).toBe('st.coach');
    expect(usernameFromEmail(`${'a'.repeat(30)}@x.com`)).toBe('a'.repeat(20));
    expect(usernameFromEmail('سلمى@example.com')).toBeNull();
    expect(usernameFromEmail('a@x.com')).toBeNull();
    expect(usernameFromEmail('99@x.com')).toBeNull();
    // Separators tidied to the rules: one where several were in a row, none at the end (also after the cut to 20).
    expect(usernameFromEmail('abc.@x.com')).toBe('abc');
    expect(usernameFromEmail('a..b@x.com')).toBe('a.b');
    expect(usernameFromEmail('mo._.aty@x.com')).toBe('mo.aty');
    expect(usernameFromEmail(`${'a'.repeat(19)}.b@x.com`)).toBe('a'.repeat(19));
    // A reserved first part is a starting point (numbered by firstFreeUsername), not a username of its own.
    expect(usernameFromEmail('admin@x.com')).toBe('admin');
    expect(usernameCandidates('Info Desk')).toEqual(['info.desk']);
    expect(usernameCandidates(`${'a'.repeat(19)} Bee`)).toEqual(['a'.repeat(19)]);
  });

  it('numbers a taken name within the length rule, always the same way', () => {
    expect(numberedUsername('ahmed', 2)).toBe('ahmed2');
    expect(numberedUsername('x'.repeat(20), 12)).toBe(`${'x'.repeat(18)}12`);
    const taken = new Set(['ahmed', 'ahmed.abdellah', 'ahmed2']);
    expect(firstFreeUsername(['ahmed', 'ahmed.abdellah'], (u) => taken.has(u))).toBe('ahmed3');
    expect(firstFreeUsername(['ahmed', 'ahmed.tamam'], (u) => taken.has(u))).toBe('ahmed.tamam');
    expect(firstFreeUsername(['salma'], (u) => taken.has(u))).toBe('salma');
    expect(firstFreeUsername([], () => false)).toBeNull();
  });

  it('the automatic address and the email-domain setting', () => {
    expect(automaticEmail('salma', 'turquoisestudio.app')).toBe('salma@turquoisestudio.app');
    for (const ok of ['turquoisestudio.app', 'demo.school', 'mail.example.co.uk', 'a-b.io']) expect(EMAIL_DOMAIN_RE.test(ok), ok).toBe(true);
    for (const bad of ['', 'app', 'x@y.com', 'two words.com', '-bad.com', 'bad-.com', 'a..b', 'Upper.com', 'http://x.com', 'x.c']) expect(EMAIL_DOMAIN_RE.test(bad), bad).toBe(false);
    expect(settingsInput.parse({ emailDomain: ' @Turquoisestudio.App ' })).toEqual({ emailDomain: 'turquoisestudio.app' });
    const bad = settingsInput.safeParse({ emailDomain: 'not a domain' });
    expect(bad.success ? null : bad.error.issues[0]!.message).toBe('settings:errors.emailDomain');
  });
});

describe('the sign-in request (loginInput)', () => {
  it('takes a username or an email address in `username`; `email` is the field’s old name', () => {
    expect(signInNameOf(loginInput.parse({ username: '  Salma ', password: 'x' }))).toBe('salma');
    expect(signInNameOf(loginInput.parse({ username: 'Salma@TurquoiseStudio.app', password: 'x' }))).toBe('salma@turquoisestudio.app');
    expect(signInNameOf(loginInput.parse({ email: 'Owner@Demo.School', password: 'x' }))).toBe('owner@demo.school');
    // Both sent: the new field wins.
    expect(signInNameOf(loginInput.parse({ username: 'salma', email: 'other@x.com', password: 'x' }))).toBe('salma');
    expect(signInNameOf(loginInput.parse({ password: 'x' }))).toBeNull();
    // No format check: a wrong name is just "incorrect", never "invalid".
    expect(loginInput.safeParse({ username: 'سلمى', password: 'x' }).success).toBe(true);
    expect(loginInput.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(loginInput.safeParse({ username: 'x'.repeat(255), password: 'x' }).success).toBe(false);
    // A temporary first password may be shorter than the policy (the operator's tool): sign-in takes any length.
    expect(loginInput.safeParse({ username: 'ali', password: 'ali123' }).success).toBe(true);
  });

  it('adding a team member: username and email are both optional in the request (the route needs one), the email may be left empty', () => {
    const base = { name: 'Nadia', positionIds: [1], password: 'temporary1' };
    expect(staffCreateInput.parse({ ...base, username: 'Nadia', email: '' })).toMatchObject({ username: 'nadia', email: null });
    expect(staffCreateInput.parse({ ...base, email: 'Nadia@Example.com' })).toMatchObject({ email: 'nadia@example.com' });
    expect(staffCreateInput.safeParse({ ...base, username: 'n' }).success).toBe(false);
    expect(staffCreateInput.safeParse({ ...base, username: 'nadia', email: 'nope' }).success).toBe(false);
  });

  it('the brakes count an account’s username and email together, and a name that is nobody’s in its email form', () => {
    const D = 'turquoisestudio.app';
    // An account with an address of its own: that address, and the automatic one of its username (which leads nowhere, but must be braked like a name nobody has).
    const custom = { email: 'salma@gmail.com', username: 'salma' };
    expect(signInBrakeNames(custom, 'salma', D)).toEqual(['salma@gmail.com', 'salma@turquoisestudio.app']);
    expect(signInBrakeNames(custom, 'salma@gmail.com', D)).toEqual(['salma@gmail.com', 'salma@turquoisestudio.app']);
    // With the automatic address: one name.
    expect(signInBrakeNames({ email: 'ali@turquoisestudio.app', username: 'ali' }, 'ali', D)).toEqual(['ali@turquoisestudio.app']);
    // Nobody: the email form of a bare name; a typed address and the automatic address of its first part.
    expect(signInBrakeNames(undefined, 'ghost', D)).toEqual(['ghost@turquoisestudio.app']);
    expect(signInBrakeNames(undefined, 'ghost@turquoisestudio.app', D)).toEqual(['ghost@turquoisestudio.app']);
    expect(signInBrakeNames(undefined, 'ghost@elsewhere.example', D)).toEqual(['ghost@elsewhere.example', 'ghost@turquoisestudio.app']);
    // A first part that can't be a username adds nothing.
    expect(signInBrakeNames(undefined, 'a@elsewhere.example', D)).toEqual(['a@elsewhere.example']);
  });
});

describe('"Choose your own password" form', () => {
  it('needs the policy length and the same password twice', () => {
    expect(choosePasswordForm.safeParse({ newPassword: 'my-own-pass', repeatPassword: 'my-own-pass' }).success).toBe(true);
    const short = choosePasswordForm.safeParse({ newPassword: 'short', repeatPassword: 'short' });
    expect(short.success ? null : short.error.issues.map((i) => [i.path[0], i.message])).toEqual([['newPassword', 'errors.passwordTooShort']]);
    const different = choosePasswordForm.safeParse({ newPassword: 'my-own-pass', repeatPassword: 'my-own-pas' });
    expect(different.success ? null : different.error.issues.map((i) => [i.path[0], i.message])).toEqual([['repeatPassword', 'errors.passwordsDontMatch']]);
  });
});

/** A database as the live one is today: migrations 0000–0006 applied, no username column yet. */
function databaseBeforeUsernames() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema, logger: durableObjectLimits }) as unknown as DB;
  const before = { ...bundle, journal: { ...bundle.journal, entries: bundle.journal.entries.filter((e) => e.idx <= 6) } };
  expect(applyMigrations(db, before)).toBe(7);
  return { sqlite, db };
}

describe('migration 0007 and the username backfill (initDb), on a database that has accounts already', () => {
  it('the migration only adds: two columns and one index, no table rebuild', () => {
    const text = fs.readFileSync(path.join(MIGRATIONS_DIR, '0007_usernames.sql'), 'utf8');
    const statements = text.split('--> statement-breakpoint').map((s) => s.trim());
    expect(statements).toEqual([
      'ALTER TABLE `users` ADD `username` text;',
      'ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;',
      'CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);',
    ]);
    expect(text).not.toMatch(/PRAGMA|DROP|__new_|RENAME/i);
    // Migrations 0000–0006 are applied on the live database: frozen. This one comes right after them (then the cafeteria's, 0008).
    const entries = bundle.journal.entries;
    expect(entries.slice(0, 8).map((e) => e.tag)).toEqual(['0000_init', '0001_positions', '0002_created_by', '0003_admissions', '0004_cloudflare', '0005_website', '0006_team', '0007_usernames']);
    expect(entries[7]!.when).toBeGreaterThan(entries[6]!.when);
  });

  it('gives every account a valid, unique username — deterministically — and nobody a temporary password', async () => {
    const { sqlite, db } = databaseBeforeUsernames();
    expect((sqlite.prepare(`select name from pragma_table_info('users')`).all() as { name: string }[]).map((c) => c.name)).not.toContain('username');
    const hash = await hashPassword('password123');
    const insert = sqlite.prepare(`insert into users (email, name, password_hash, locale, active, created_at, updated_at) values (?, ?, ?, 'en', 1, 1000, 2000)`);
    const emails = [
      'owner@demo.school', // 1 → owner
      'tom.wilkins@demo.school', // 2 → tom.wilkins
      'owner@elsewhere.example', // 3 → the same first part: owner2
      'سلمى@example.com', // 4 → nothing usable: user4
      'a@example.com', // 5 → one letter: user5
      '99.coach@example.com', // 6 → leading digits and dot dropped: coach
      `${'verylongname'.repeat(3)}@example.com`, // 7 → cut to 20
      'user4@example.com', // 8 → "user4" is taken by now: user42
      'salma+studio@gmail.com', // 9 → salmastudio
      'owner2@demo.school', // 10 → "owner2" is taken by now: owner22
    ];
    for (const e of emails) insert.run(e, e.split('@')[0], hash);

    initDb(db);

    const rows = db.select().from(users).orderBy(asc(users.id)).all();
    expect(rows.map((r) => r.username)).toEqual(['owner', 'tom.wilkins', 'owner2', 'user4', 'user5', 'coach', 'verylongnameverylong', 'user42', 'salmastudio', 'owner22']);
    for (const r of rows) expect(isValidUsername(r.username!), r.username!).toBe(true);
    expect(new Set(rows.map((r) => r.username)).size).toBe(rows.length);
    // Nobody is asked to choose a password because of the upgrade, and nothing else about the accounts moved.
    expect(rows.every((r) => r.mustChangePassword === false)).toBe(true);
    expect(rows.every((r) => r.updatedAt === 2000 && r.createdAt === 1000)).toBe(true);
    expect(rows.map((r) => r.email)).toEqual(emails);

    // Starting again changes nothing (the Durable Object runs initDb at every start).
    expect(backfillUsernames(db)).toBe(0);
    initDb(db);
    expect(db.select({ u: users.username }).from(users).orderBy(asc(users.id)).all().map((r) => r.u)).toEqual(rows.map((r) => r.username));

    // The same accounts in another database end up with the same usernames.
    const again = databaseBeforeUsernames();
    const insertAgain = again.sqlite.prepare(`insert into users (email, name, password_hash, locale, active, created_at, updated_at) values (?, ?, ?, 'en', 1, 1000, 2000)`);
    for (const e of emails) insertAgain.run(e, e.split('@')[0], hash);
    initDb(again.db);
    expect(again.db.select({ u: users.username }).from(users).orderBy(asc(users.id)).all().map((r) => r.u)).toEqual(rows.map((r) => r.username));

    // People sign in as before with their email address — and now with the username too.
    const app = createApp({ db, config: testConfig(), files: memoryFileStore() });
    const signIn = (body: object) =>
      app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify(body) });
    for (const body of [{ email: 'owner@demo.school' }, { username: 'owner' }, { username: 'tom.wilkins' }, { username: 'user4' }, { username: 'سلمى@example.com' }]) {
      const res = await signIn({ ...body, password: 'password123' });
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect((await res.json()).user.mustChangePassword).toBe(false);
    }
    expect((await (await signIn({ username: 'owner2', password: 'password123' })).json()).user.email).toBe('owner@elsewhere.example');
  });

  it('fills in a large team within the Durable Object limits, and leaves usernames that exist alone', async () => {
    const { sqlite, db } = databaseBeforeUsernames();
    const insert = sqlite.prepare(`insert into users (email, name, password_hash, locale, active, created_at, updated_at) values (?, ?, 'x', 'en', 1, 0, 0)`);
    for (let i = 0; i < 250; i++) insert.run(`coach@school${i}.example`, `Coach ${i}`);
    initDb(db);
    const names = db.select({ u: users.username }).from(users).orderBy(asc(users.id)).all().map((r) => r.u!);
    expect(names.slice(0, 3)).toEqual(['coach', 'coach2', 'coach3']);
    expect(names[249]).toBe('coach250');
    expect(new Set(names).size).toBe(250);
    // A later start only looks at accounts without one.
    db.update(users).set({ username: null }).where(eq(users.id, 7)).run();
    db.update(users).set({ username: 'chosen' }).where(eq(users.id, 8)).run();
    expect(backfillUsernames(db)).toBe(1);
    expect(db.select({ u: users.username }).from(users).where(eq(users.id, 7)).get()!.u).toBe('coach7');
    expect(db.select({ u: users.username }).from(users).where(eq(users.id, 8)).get()!.u).toBe('chosen');
  });

  it('keeps to the rules as they are now: a reserved first part is numbered, separators are tidied', () => {
    const { sqlite, db } = databaseBeforeUsernames();
    const insert = sqlite.prepare(`insert into users (email, name, password_hash, locale, active, created_at, updated_at) values (?, ?, 'x', 'en', 1, 0, 0)`);
    for (const e of ['admin@school.example', 'info@school.example', 'abc.@school.example', 'a..b@school.example', 'postmaster@x.example']) insert.run(e, e);
    initDb(db);
    const names = db.select({ u: users.username }).from(users).orderBy(asc(users.id)).all().map((r) => r.u!);
    expect(names).toEqual(['admin2', 'info2', 'abc', 'a.b', 'postmaster2']);
    for (const n of names) expect(isValidUsername(n), n).toBe(true);
  });

  it('a new, empty database has the columns from the start and nothing to fill in', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema, logger: durableObjectLimits }) as unknown as DB;
    initDb(db);
    const cols = sqlite.prepare(`select name, "notnull" as nn, dflt_value as d from pragma_table_info('users')`).all() as { name: string; nn: number; d: string | null }[];
    expect(cols.find((c) => c.name === 'username')).toMatchObject({ nn: 0 });
    expect(cols.find((c) => c.name === 'must_change_password')).toMatchObject({ nn: 1, d: 'false' });
    expect(backfillUsernames(db)).toBe(0);
    // Two accounts can't share a username; accounts without one (never left that way) don't clash with each other.
    db.insert(users).values({ email: 'a@x.com', name: 'A', passwordHash: 'x', username: 'same' }).run();
    expect(() => db.insert(users).values({ email: 'b@x.com', name: 'B', passwordHash: 'x', username: 'same' }).run()).toThrow(/UNIQUE/);
    db.insert(users).values({ email: 'c@x.com', name: 'C', passwordHash: 'x' }).run();
    db.insert(users).values({ email: 'd@x.com', name: 'D', passwordHash: 'x' }).run();
  });
});
