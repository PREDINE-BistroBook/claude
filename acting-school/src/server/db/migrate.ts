import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DB } from './database';
import bundle, { type MigrationsBundle } from './migrations/bundle';

const TABLE = '__drizzle_migrations';

/**
 * Apply the migrations not yet in this database, from the generated bundle
 * (db/migrations/bundle.ts — no file system needed, so the Durable Object can
 * run it). Synchronous, on either driver, in one db.transaction (BEGIN can't be
 * sent as SQL on a Durable Object; transactions go through transactionSync).
 *
 * Same bookkeeping as drizzle's own migrators (the better-sqlite3 folder
 * migrator and the durable-sqlite one read the same table): a migration runs
 * when the newest recorded created_at is older than its journal `when`, and is
 * recorded with the sha256 of its SQL, exactly as the folder migrator did — so
 * existing Node databases carry on where they were.
 */
export function applyMigrations(db: DB, migrations: MigrationsBundle = bundle): number {
  db.run(sql`CREATE TABLE IF NOT EXISTS ${sql.identifier(TABLE)} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const last = db.values<[number, string, number | string]>(
    sql`SELECT id, hash, created_at FROM ${sql.identifier(TABLE)} ORDER BY created_at DESC LIMIT 1`,
  )[0];
  const pending = migrations.journal.entries.filter((e) => !last || Number(last[2]) < e.when);
  if (!pending.length) return 0;
  db.transaction((tx) => {
    for (const entry of pending) {
      const text = migrations.migrations[`m${String(entry.idx).padStart(4, '0')}`];
      if (text === undefined) throw new Error(`Missing migration in the bundle: ${entry.tag} (run npm run db:bundle)`);
      for (const statement of text.split('--> statement-breakpoint')) {
        if (statement.trim()) tx.run(sql.raw(statement));
      }
      const hash = createHash('sha256').update(text).digest('hex');
      tx.run(sql`INSERT INTO ${sql.identifier(TABLE)} ("hash", "created_at") VALUES (${hash}, ${entry.when})`);
    }
  });
  return pending.length;
}
