/**
 * Where uploaded file bytes live. The files table (db/schema.ts) has the
 * metadata and the `storage_key`; a FileStore keeps the bytes under that key.
 * Passed to createApp, so routes never touch a disk or a bucket directly:
 *
 * - Node server: a folder, $DATA_DIR/uploads/ (folderFileStore in nodeFileStore.ts);
 * - Cloudflare: the Durable Object's own SQLite (sqliteFileStore, below), or
 *   R2 once an R2 bucket is bound (src/worker/r2FileStore.ts; files stored in
 *   SQLite before stay readable through fallbackFileStore);
 * - tests: sqliteFileStore on the in-memory database.
 *
 * Files stay private either way: they're only served by GET /api/files/:id to
 * signed-in staff.
 */
import { asc, eq } from 'drizzle-orm';
import { Buffer } from 'node:buffer';
import type { DB } from '../db/database';
import { fileChunks } from '../db/schema';

export interface FileStore {
  /** Store `data` under `key`, replacing anything already there. */
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** The bytes under `key`, or null when there are none. */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Remove `key` (no error when it doesn't exist). */
  delete(key: string): Promise<void>;
}

/** Bytes per row in file_chunks: well under the Durable Object's 2 MB value / 8 MB row limits. */
export const FILE_CHUNK_BYTES = 512 * 1024;

/**
 * Files in the database itself, split into FILE_CHUNK_BYTES rows of
 * file_chunks. Each put / delete is one transaction, so a file is never half
 * written. Runs on either driver (the Cloudflare default while R2 isn't
 * enabled, and the store the tests use).
 */
export function sqliteFileStore(db: DB, chunkBytes = FILE_CHUNK_BYTES): FileStore {
  return {
    async put(key, data) {
      db.transaction((tx) => {
        tx.delete(fileChunks).where(eq(fileChunks.storageKey, key)).run();
        for (let seq = 0, at = 0; at < data.byteLength || seq === 0; seq++, at += chunkBytes) {
          const part = data.subarray(at, Math.min(at + chunkBytes, data.byteLength));
          tx.insert(fileChunks).values({ storageKey: key, seq, data: Buffer.from(part.buffer, part.byteOffset, part.byteLength) }).run();
        }
      });
    },
    async get(key) {
      const rows = db
        .select({ data: fileChunks.data })
        .from(fileChunks)
        .where(eq(fileChunks.storageKey, key))
        .orderBy(asc(fileChunks.seq))
        .all();
      if (!rows.length) return null;
      if (rows.length === 1) return new Uint8Array(rows[0]!.data);
      const out = new Uint8Array(rows.reduce((n, r) => n + r.data.byteLength, 0));
      let at = 0;
      for (const r of rows) {
        out.set(r.data, at);
        at += r.data.byteLength;
      }
      return out;
    },
    async delete(key) {
      db.transaction((tx) => {
        tx.delete(fileChunks).where(eq(fileChunks.storageKey, key)).run();
      });
    },
  };
}

/**
 * Writes to `primary`; reads from `primary`, then from `fallback` for keys
 * stored before (e.g. files kept in the Durable Object's SQLite before R2 was
 * bound); deletes from both.
 */
export function fallbackFileStore(primary: FileStore, fallback: FileStore): FileStore {
  return {
    put: (key, data, contentType) => primary.put(key, data, contentType),
    async get(key) {
      return (await primary.get(key)) ?? (await fallback.get(key));
    },
    async delete(key) {
      await primary.delete(key);
      await fallback.delete(key);
    },
  };
}

/** Bytes kept in memory (scripts and tests that don't need them to last). */
export function memoryFileStore(): FileStore & { keys(): string[] } {
  const map = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    async put(key, data) {
      map.set(key, new Uint8Array(data));
    },
    async get(key) {
      return map.get(key) ?? null;
    },
    async delete(key) {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}
