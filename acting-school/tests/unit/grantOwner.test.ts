import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import { testConfig } from '../../src/server/config';
import { memoryFileStore } from '../../src/server/lib/fileStore';
import { createDb } from '../../src/server/db/client';
import { positions, users } from '../../src/server/db/schema';
import { activeOwnerCount, loadUserAccess } from '../../src/server/lib/access';
import { hashPassword } from '../../src/server/lib/password';

/**
 * `npm run owner -- email` is the way back in after a lockout. Run it for real.
 * Also: opening a phase-1 database (fixed roles, no positions) carries each
 * role over to the matching position (db/database.ts initDb).
 */
const root = path.resolve(__dirname, '../..');
const tsx = path.join(root, 'node_modules/.bin/tsx');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-owner-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function grantOwner(dataDir: string, ...args: string[]) {
  return spawnSync(tsx, ['src/server/db/grantOwner.ts', ...args], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

type PhaseOneUser = { email: string; name: string; role: 'owner' | 'admin' | 'teacher' | 'agent'; active?: boolean; passwordHash?: string };

/** A database as phase 1 left it: only the first migration, users with a role column. */
function phaseOneDatabase(dataDir: string, people: PhaseOneUser[]) {
  const migrations = path.join(tmp, 'phase1-migrations');
  fs.mkdirSync(path.join(migrations, 'meta'), { recursive: true });
  const src = path.join(root, 'src/server/db/migrations');
  fs.copyFileSync(path.join(src, '0000_init.sql'), path.join(migrations, '0000_init.sql'));
  const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { tag: string }) => e.tag === '0000_init');
  fs.writeFileSync(path.join(migrations, 'meta/_journal.json'), JSON.stringify(journal));
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, 'app.db'));
  migrate(drizzle(sqlite), { migrationsFolder: migrations });
  const insert = sqlite.prepare(
    `insert into users (email, name, role, password_hash, locale, active, created_at, updated_at) values (?, ?, ?, ?, 'en', ?, 0, 0)`,
  );
  for (const u of people) insert.run(u.email, u.name, u.role, u.passwordHash ?? 'x', u.active === false ? 0 : 1);
  sqlite.close();
}

/** Who holds which position, by email. */
function held(dataDir: string) {
  return query<{ email: string; key: string }>(
    dataDir,
    `select u.email, p.key from user_positions up join users u on u.id = up.user_id join positions p on p.id = up.position_id order by u.email, p.key`,
  );
}

function query<T>(dataDir: string, sql: string): T[] {
  const db = new Database(path.join(dataDir, 'app.db'), { readonly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

describe('npm run owner', () => {
  it('upgrades a phase-1 database and gives the account the CEO position, reactivating it', () => {
    const dataDir = path.join(tmp, 'upgrade');
    phaseOneDatabase(dataDir, [
      { email: 'boss@example.com', name: 'Boss', role: 'owner', active: false },
      { email: 'coach@example.com', name: 'Coach', role: 'teacher' },
    ]);
    const res = grantOwner(dataDir, ' Boss@Example.com ');
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('now holds the CEO position and was reactivated');

    const columns = query<{ name: string }>(dataDir, `select name from pragma_table_info('users')`).map((c) => c.name);
    expect(columns).not.toContain('role');
    expect(query<{ key: string }>(dataDir, 'select key from positions order by sort_order').map((p) => p.key)).toEqual([
      'ceo', 'cfo', 'executive_director', 'head_of_casting', 'casting_team', 'video_editor', 'acting_coach', 'finance',
    ]);
    // The upgrade carried the phase-1 roles over; the script reactivated the owner.
    expect(held(dataDir)).toEqual([
      { email: 'boss@example.com', key: 'ceo' },
      { email: 'coach@example.com', key: 'acting_coach' },
    ]);
    expect(query(dataDir, `select active from users where email = 'boss@example.com'`)).toEqual([{ active: 1 }]);

    // Running it again changes nothing.
    expect(grantOwner(dataDir, 'boss@example.com').status).toBe(0);
    expect(query(dataDir, 'select * from user_positions')).toHaveLength(2);
  }, 60_000);

  it('gives an owner position even if CEO was turned into an ordinary position', () => {
    // State the API allows: an owner PATCHes CEO { isOwner: false } while another owner (CFO) exists.
    const dataDir = fs.mkdtempSync(path.join(tmp, 'demoted-ceo-'));
    const db = createDb(path.join(dataDir, 'app.db'));
    db.update(positions).set({ isOwner: false, permissions: [] }).where(eq(positions.key, 'ceo')).run();
    db.$client.prepare(`insert into users (email, name, password_hash, locale, active, created_at, updated_at) values ('karim@example.com','Karim','x','en',1,0,0)`).run();
    db.$client.close();
    const res = grantOwner(dataDir, 'karim@example.com');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('now holds the CFO position');
    const after = createDb(path.join(dataDir, 'app.db'));
    const karim = after.select().from(users).where(eq(users.email, 'karim@example.com')).get()!;
    expect(loadUserAccess(after, karim.id).isOwner).toBe(true);
    expect(activeOwnerCount(after)).toBe(1);
    // CEO itself is left as the owners made it.
    expect(after.select().from(positions).where(eq(positions.key, 'ceo')).get()!.isOwner).toBe(false);
    after.$client.close();
  }, 60_000);

  it('makes CEO an owner position again when no owner position is left', () => {
    const dataDir = fs.mkdtempSync(path.join(tmp, 'no-owner-'));
    const db = createDb(path.join(dataDir, 'app.db'));
    db.update(positions).set({ isOwner: false, permissions: [] }).where(eq(positions.isOwner, true)).run();
    db.$client.prepare(`insert into users (email, name, password_hash, locale, active, created_at, updated_at) values ('karim@example.com','Karim','x','en',1,0,0)`).run();
    db.$client.close();
    const res = grantOwner(dataDir, 'karim@example.com');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('now holds the CEO position');
    expect(res.stdout).toContain('owner position again');
    const after = createDb(path.join(dataDir, 'app.db'));
    expect(after.select().from(positions).where(eq(positions.key, 'ceo')).get()!.isOwner).toBe(true);
    expect(activeOwnerCount(after)).toBe(1);
    after.$client.close();
  }, 60_000);

  it('refuses an unknown email or a missing argument', () => {
    const dataDir = path.join(tmp, 'empty');
    const unknown = grantOwner(dataDir, 'nobody@example.com');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('No staff account uses nobody@example.com');
    const none = grantOwner(dataDir);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('Usage');
  }, 60_000);
});

describe('upgrading a phase-1 database', () => {
  it('keeps each account\'s access: phase-1 roles become the matching positions', async () => {
    const dataDir = path.join(tmp, 'roles');
    const passwordHash = await hashPassword('password123');
    phaseOneDatabase(dataDir, [
      { email: 'boss@example.com', name: 'Boss', role: 'owner', passwordHash },
      { email: 'cfo@example.com', name: 'Abdelrahman', role: 'owner', passwordHash },
      { email: 'salma@example.com', name: 'Salma', role: 'admin', passwordHash },
      { email: 'coach@example.com', name: 'Coach', role: 'teacher', passwordHash },
      { email: 'agent@example.com', name: 'Agent', role: 'agent', passwordHash, active: false },
    ]);
    const db = createDb(path.join(dataDir, 'app.db'));
    try {
      expect(held(dataDir)).toEqual([
        { email: 'agent@example.com', key: 'head_of_casting' },
        { email: 'boss@example.com', key: 'ceo' },
        { email: 'cfo@example.com', key: 'ceo' },
        { email: 'coach@example.com', key: 'acting_coach' },
        { email: 'salma@example.com', key: 'executive_director' },
      ]);
      expect(activeOwnerCount(db)).toBe(2);
      // Former owners are owners again, so they stay out of the director's reach.
      const app = createApp({ db, config: testConfig(), files: memoryFileStore() });
      const login = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ email: 'salma@example.com', password: 'password123' }),
      });
      expect(login.status).toBe(200);
      const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
      const formerCfo = db.select().from(users).where(eq(users.email, 'cfo@example.com')).get()!;
      const reset = await app.request(`/api/staff/${formerCfo.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie },
        body: JSON.stringify({ password: 'salmaknows1' }),
      });
      expect(reset.status).toBe(404);
      // Opening it again changes nothing.
      db.$client.close();
      createDb(path.join(dataDir, 'app.db')).$client.close();
      expect(held(dataDir)).toHaveLength(5);
    } finally {
      if (db.$client.open) db.$client.close();
    }
  }, 60_000);
});
