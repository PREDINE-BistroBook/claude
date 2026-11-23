/**
 * The Node side of the database: a better-sqlite3 file (or ':memory:' for
 * tests). Everything else — migrations, built-in positions, backfills — is
 * initDb() in db/database.ts, shared with the Cloudflare Durable Object.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Logger } from 'drizzle-orm/logger';
import fs from 'node:fs';
import path from 'node:path';
import { durableObjectLimits } from '../lib/sqlLimits';
import { initDb, type DB } from './database';
import * as schema from './schema';

export { PHASE_ONE_ROLE_POSITIONS, type DB } from './database';

/** The Node database also exposes the better-sqlite3 connection (to close it). */
export type NodeDB = DB & { $client: Database.Database };

/**
 * Open (or create) the database file and bring it up to date (initDb). Pass
 * ':memory:' for a throwaway database (tests); `logger` sees every query.
 * With ACTING_SCHOOL_DO_LIMITS=1 (every Vitest run: vitest.config.ts) the
 * default logger fails any query over the Durable Object limits
 * (lib/sqlLimits.ts durableObjectLimits) — startup steps included.
 */
export function createDb(filename: string, opts: { logger?: Logger } = {}): NodeDB {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  // Connection settings for a file shared by the server and the CLI scripts. (The
  // Durable Object has neither, and enforces foreign keys by default.)
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const logger = opts.logger ?? (process.env.ACTING_SCHOOL_DO_LIMITS === '1' ? durableObjectLimits : undefined);
  const db = drizzle(sqlite, { schema, logger }) as unknown as NodeDB;
  initDb(db);
  return db;
}
