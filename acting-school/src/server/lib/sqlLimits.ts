/**
 * Limits of SQLite on Cloudflare Durable Objects that better-sqlite3 doesn't
 * have, kept in shared code so the Node server and the tests run the same SQL:
 *
 * - at most 100 bound parameters per statement (better-sqlite3: 32,766) —
 *   multi-row inserts and IN (…) lists that can grow go through the helpers
 *   below; tests/helpers.ts fails any query that binds more;
 * - LIKE / GLOB patterns of at most 50 bytes — searches use `contains()`
 *   (instr) instead of `like '%term%'`;
 * - no custom SQL functions (phone digits are a stored column, lib/phone.ts).
 */
import { getTableColumns, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Logger } from 'drizzle-orm/logger';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

export const MAX_BOUND_PARAMS = 100;

/** Values per IN (…) list, leaving room for the rest of the query's parameters. */
export const IN_LIST_CHUNK = 90;

/** Longest LIKE / GLOB pattern a Durable Object accepts, in bytes. */
export const MAX_LIKE_PATTERN_BYTES = 50;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rows per multi-row INSERT into `table` that stay under the parameter limit.
 * Drizzle binds one parameter per column that has a value or a default, so the
 * table's column count is an upper bound per row.
 */
export function rowsPerInsert(table: SQLiteTable): number {
  return Math.max(1, Math.floor(MAX_BOUND_PARAMS / Object.keys(getTableColumns(table)).length));
}

/** Rows split into INSERT-sized batches for `table` (call .insert().values(batch) for each). */
export function insertBatches<T>(table: SQLiteTable, rows: readonly T[]): T[][] {
  return chunk(rows, rowsPerInsert(table));
}

/** Run `query` once per slice of `values` (an IN list that may outgrow the limit) and concatenate the results. */
export function inChunks<T, R>(values: readonly T[], query: (part: T[]) => R[], size = IN_LIST_CHUNK): R[] {
  if (!values.length) return [];
  if (values.length <= size) return query([...values]);
  return chunk(values, size).flatMap(query);
}

/**
 * `expr` contains `term`, case-insensitively for ASCII letters (like LIKE).
 * instr() has no pattern-length limit and needs no wildcard escaping; NULL
 * never matches.
 */
export function contains(expr: SQLWrapper, term: string): SQL {
  return sql`instr(lower(${expr}), lower(${term})) > 0`;
}

const utf8 = new TextEncoder();

/**
 * A drizzle logger that throws on any query a Durable Object would refuse but
 * better-sqlite3 accepts: more than 100 bound parameters, or a LIKE/GLOB
 * pattern over 50 bytes. Every database opened while testing uses it
 * (db/client.ts createDb with ACTING_SCHOOL_DO_LIMITS=1, set in
 * vitest.config.ts and inherited by the `npm run seed` subprocess), so the
 * suite fails where Cloudflare would.
 */
export const durableObjectLimits: Logger = {
  logQuery(query, params) {
    if (params.length > MAX_BOUND_PARAMS) {
      throw new Error(`Query binds ${params.length} parameters (Durable Object limit ${MAX_BOUND_PARAMS}): ${query.slice(0, 200)}`);
    }
    if (/\b(like|glob)\b/i.test(query)) {
      for (const p of params) {
        const bytes = typeof p === 'string' ? utf8.encode(p).byteLength : 0;
        if (typeof p === 'string' && /[%_*?]/.test(p) && bytes > MAX_LIKE_PATTERN_BYTES) {
          throw new Error(`LIKE/GLOB pattern of ${bytes} bytes (Durable Object limit ${MAX_LIKE_PATTERN_BYTES}): ${query.slice(0, 200)}`);
        }
      }
    }
  },
};
