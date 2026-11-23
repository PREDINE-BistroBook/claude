/**
 * The database as the app sees it, on either runtime: drizzle over
 * better-sqlite3 (Node server, tests — db/client.ts) or over a Durable
 * Object's SQLite storage (Cloudflare — src/worker/). Both are synchronous
 * SQLite drivers with the same dialect, so every query and transaction is
 * written once. Nothing in here may import a Node-only module.
 */
import { inArray, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { BuiltInPositionKey } from '../../shared/permissions';
import { upgradeBuiltInPositions } from '../lib/access';
import { backfillPhoneDigits } from '../lib/phone';
import { insertBatches } from '../lib/sqlLimits';
import { applyMigrations } from './migrate';
import * as schema from './schema';

/**
 * A synchronous drizzle SQLite database with the app's schema. The run()
 * result is `unknown` on purpose: the Durable Object driver returns nothing
 * from run(), so code never reads `.changes` — use `.returning()` instead.
 */
export type DB = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** Phase 1 had four fixed roles (users.role); upgrading gives each account the matching built-in position. */
export const PHASE_ONE_ROLE_POSITIONS = {
  owner: 'ceo',
  admin: 'executive_director',
  teacher: 'acting_coach',
  agent: 'head_of_casting',
} as const satisfies Record<string, BuiltInPositionKey>;

/** Each account's phase-1 role, or null when the database has no users.role column (new, or already upgraded). */
function readPhaseOneRoles(db: DB): { id: number; role: string }[] | null {
  const columns = db.all<{ name: string }>(sql`select name from pragma_table_info('users')`);
  if (!columns.some((c) => c.name === 'role')) return null;
  return db.all<{ id: number; role: string }>(sql`select id, role from users`);
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
  db.transaction((tx) => {
    for (const batch of insertBatches(schema.userPositions, rows)) tx.insert(schema.userPositions).values(batch).onConflictDoNothing().run();
  });
}

/**
 * Bring a freshly opened database up to date — the same steps on both
 * runtimes, at startup (the Node server's createDb, the Durable Object's
 * constructor): migrations (db/migrations/bundle.ts), then the built-in
 * positions (CEO, Acting coach, …) if any are missing plus any permissions
 * granted to built-in positions since this database last started
 * (BUILT_IN_GRANTS in shared/permissions.ts), then rows written before a
 * column existed get it filled in (phone_digits). A phase-1 database (fixed
 * roles) also gets each account's role carried over to the matching position.
 */
export function initDb(db: DB): DB {
  // Read before migrating: the positions migration drops the column.
  const phaseOneRoles = readPhaseOneRoles(db);
  applyMigrations(db);
  upgradeBuiltInPositions(db);
  if (phaseOneRoles?.length) carryOverPhaseOneRoles(db, phaseOneRoles);
  backfillPhoneDigits(db);
  return db;
}
