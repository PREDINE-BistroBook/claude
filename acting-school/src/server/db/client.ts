import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { inArray } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import type { BuiltInPositionKey } from '../../shared/permissions';
import { upgradeBuiltInPositions } from '../lib/access';
import { registerPhoneFunctions } from '../lib/phone';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Phase 1 had four fixed roles (users.role); upgrading gives each account the matching built-in position. */
export const PHASE_ONE_ROLE_POSITIONS = {
  owner: 'ceo',
  admin: 'executive_director',
  teacher: 'acting_coach',
  agent: 'head_of_casting',
} as const satisfies Record<string, BuiltInPositionKey>;

/** Each account's phase-1 role, or null when the database has no users.role column (new, or already upgraded). */
function readPhaseOneRoles(sqlite: Database.Database): { id: number; role: string }[] | null {
  const columns = sqlite.prepare(`select name from pragma_table_info('users')`).all() as { name: string }[];
  if (!columns.some((c) => c.name === 'role')) return null;
  return sqlite.prepare('select id, role from users').all() as { id: number; role: string }[];
}

/**
 * After the positions migration dropped users.role: give everyone the position
 * matching their old role, so nobody loses access (and former owners stay
 * owners, out of everyone else's reach). Unknown roles get nothing.
 */
function carryOverPhaseOneRoles(db: DB, roles: { id: number; role: string }[]) {
  const keys = Object.values(PHASE_ONE_ROLE_POSITIONS);
  const byKey = new Map(
    db
      .select({ id: schema.positions.id, key: schema.positions.key })
      .from(schema.positions)
      .where(inArray(schema.positions.key, keys))
      .all()
      .map((p) => [p.key, p.id]),
  );
  const rows = roles.flatMap(({ id, role }) => {
    const key = PHASE_ONE_ROLE_POSITIONS[role as keyof typeof PHASE_ONE_ROLE_POSITIONS];
    const positionId = key ? byKey.get(key) : undefined;
    return positionId ? [{ userId: id, positionId }] : [];
  });
  if (rows.length) db.insert(schema.userPositions).values(rows).onConflictDoNothing().run();
}

/** Migrations ship as SQL in the repo; resolved from the app root (cwd unless APP_ROOT is set). */
export function migrationsDir(): string {
  return path.resolve(process.env.APP_ROOT ?? process.cwd(), 'src/server/db/migrations');
}

/**
 * Open (or create) the database and bring it up to date: migrations, then the
 * built-in positions (CEO, Acting coach, …) if any are missing, plus any
 * permissions granted to built-in positions since this database last started
 * (BUILT_IN_GRANTS in shared/permissions.ts). A phase-1
 * database (fixed roles) also gets each account's role carried over to the
 * matching position. Every connection gets the app's SQL functions
 * (phone_digits, lib/phone.ts). Pass ':memory:' for a throwaway database (tests).
 */
export function createDb(filename: string): DB {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  // phone_digits(): phone matching and search in SQL (lib/phone.ts).
  registerPhoneFunctions(sqlite);
  const db = drizzle(sqlite, { schema }) as DB;
  // Read before migrating: the positions migration drops the column. (The migrator
  // commits its own transaction, so the carry-over runs right after it.)
  const phaseOneRoles = readPhaseOneRoles(sqlite);
  migrate(db, { migrationsFolder: migrationsDir() });
  upgradeBuiltInPositions(db);
  if (phaseOneRoles?.length) carryOverPhaseOneRoles(db, phaseOneRoles);
  return db;
}
