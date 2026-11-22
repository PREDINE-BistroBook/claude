import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `npm run owner -- email` is the way back in after a lockout, and the upgrade
 * path for a phase-1 database (fixed roles, no positions). Run it for real.
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

/** A database as phase 1 left it: only the first migration, users with a role column. */
function phaseOneDatabase(dataDir: string) {
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
    `insert into users (email, name, role, password_hash, locale, active, created_at, updated_at) values (?, ?, ?, 'x', 'en', ?, 0, 0)`,
  );
  insert.run('boss@example.com', 'Boss', 'owner', 0);
  insert.run('coach@example.com', 'Coach', 'teacher', 1);
  sqlite.close();
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
    phaseOneDatabase(dataDir);
    const res = grantOwner(dataDir, ' Boss@Example.com ');
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('now holds the CEO position and was reactivated');

    const columns = query<{ name: string }>(dataDir, `select name from pragma_table_info('users')`).map((c) => c.name);
    expect(columns).not.toContain('role');
    expect(query<{ key: string }>(dataDir, 'select key from positions order by sort_order').map((p) => p.key)).toEqual([
      'ceo', 'cfo', 'executive_director', 'head_of_casting', 'casting_team', 'video_editor', 'acting_coach', 'finance',
    ]);
    expect(
      query(dataDir, `select u.email, u.active, p.key from user_positions up join users u on u.id = up.user_id join positions p on p.id = up.position_id`),
    ).toEqual([{ email: 'boss@example.com', active: 1, key: 'ceo' }]);

    // Running it again changes nothing.
    expect(grantOwner(dataDir, 'boss@example.com').status).toBe(0);
    expect(query(dataDir, 'select * from user_positions')).toHaveLength(1);
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
