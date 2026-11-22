import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Migrations ship as SQL in the repo; resolved from the app root (cwd unless APP_ROOT is set). */
export function migrationsDir(): string {
  return path.resolve(process.env.APP_ROOT ?? process.cwd(), 'src/server/db/migrations');
}

/**
 * Open (or create) the database and bring it up to date.
 * Pass ':memory:' for a throwaway database (tests).
 */
export function createDb(filename: string): DB {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  if (filename !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as DB;
  migrate(db, { migrationsFolder: migrationsDir() });
  return db;
}
