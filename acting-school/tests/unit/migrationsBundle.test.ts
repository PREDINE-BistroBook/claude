import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as folderMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate as durableMigrate } from 'drizzle-orm/durable-sqlite/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLE_FILE, MIGRATIONS_DIR, renderMigrationsBundle } from '../../scripts/bundle-migrations';
import type { DB } from '../../src/server/db/database';
import { applyMigrations } from '../../src/server/db/migrate';
import bundle from '../../src/server/db/migrations/bundle';
import * as schema from '../../src/server/db/schema';
import { durableObjectLimits } from '../../src/server/lib/sqlLimits';

/**
 * Both runtimes migrate from src/server/db/migrations/bundle.ts (the Durable
 * Object has no file system). It's generated from the journal and the .sql
 * files: `npm run db:generate` (or `npm run db:bundle`) rewrites it.
 */
const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[];
};

function memoryDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite, { schema, logger: durableObjectLimits }) };
}

/** Every table and its columns, to compare two databases' schemas. */
function shape(sqlite: Database.Database) {
  const tables = (sqlite.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`).all() as { name: string }[]).map(
    (t) => t.name,
  );
  return Object.fromEntries(
    tables.map((name) => [name, (sqlite.prepare(`select name, type, "notnull", pk from pragma_table_info(?)`).all(name) as object[]).map((c) => JSON.stringify(c))]),
  );
}

describe('migrations bundle', () => {
  it('is in step with the journal and the .sql files (run `npm run db:bundle` if this fails)', () => {
    expect(fs.readFileSync(BUNDLE_FILE, 'utf8')).toBe(renderMigrationsBundle());
    expect(bundle.journal.entries.map((e) => e.tag)).toEqual(journal.entries.map((e) => e.tag));
    expect(Object.keys(bundle.migrations).sort()).toEqual(journal.entries.map((e) => `m${String(e.idx).padStart(4, '0')}`).sort());
    for (const e of journal.entries) {
      expect(bundle.migrations[`m${String(e.idx).padStart(4, '0')}`], e.tag).toBe(fs.readFileSync(path.join(MIGRATIONS_DIR, `${e.tag}.sql`), 'utf8'));
    }
  });

  it('builds the same schema as the folder migrator, and records the same hashes (existing Node databases carry on)', () => {
    const folder = memoryDb();
    folderMigrate(folder.db, { migrationsFolder: MIGRATIONS_DIR });
    const bundled = memoryDb();
    expect(applyMigrations(bundled.db as unknown as DB)).toBe(journal.entries.length);
    expect(shape(bundled.sqlite)).toEqual(shape(folder.sqlite));
    const rows = (s: Database.Database) => s.prepare('select hash, created_at from __drizzle_migrations order by created_at').all();
    expect(rows(bundled.sqlite)).toEqual(rows(folder.sqlite));
    // A database the folder migrator brought up to date needs nothing more.
    expect(applyMigrations(folder.db as unknown as DB)).toBe(0);
    expect(applyMigrations(bundled.db as unknown as DB)).toBe(0);
  });

  it("is in the shape drizzle's own durable-sqlite migrator reads", async () => {
    const viaDrizzle = memoryDb();
    await durableMigrate(viaDrizzle.db as never, bundle);
    const ours = memoryDb();
    applyMigrations(ours.db as unknown as DB);
    expect(shape(viaDrizzle.sqlite)).toEqual(shape(ours.sqlite));
    // Its rows (hash '') are understood by ours too: nothing re-applied.
    expect(applyMigrations(viaDrizzle.db as unknown as DB)).toBe(0);
  });

  it('applies only the newer migrations to a database that has the older ones, in one transaction', () => {
    const { sqlite, db } = memoryDb();
    const firstTwo = { ...bundle, journal: { ...bundle.journal, entries: bundle.journal.entries.slice(0, 2) } };
    expect(applyMigrations(db as unknown as DB, firstTwo)).toBe(2);
    expect(applyMigrations(db as unknown as DB)).toBe(journal.entries.length - 2);
    expect(sqlite.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({ n: journal.entries.length });

    // A broken migration leaves nothing half-applied.
    const broken = memoryDb();
    const bad = {
      journal: { ...bundle.journal, entries: [...bundle.journal.entries, { idx: 99, version: '6', when: Date.now() + 1e9, tag: '0099_bad', breakpoints: true }] },
      migrations: { ...bundle.migrations, m0099: 'CREATE TABLE ok_table (id integer);\n--> statement-breakpoint\nTHIS IS NOT SQL;' },
    };
    expect(() => applyMigrations(broken.db as unknown as DB, bad)).toThrow();
    expect(broken.db.all(sql`select name from sqlite_master where name in ('ok_table', 'users')`)).toEqual([]);
  });
});
