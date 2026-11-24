import fs from 'node:fs';
import path from 'node:path';
import type { NodeDB } from './db/client';
import type { RestoreDeps } from './lib/restorePoint';

/**
 * The Node server's restore point (lib/restorePoint.ts): before a destructive
 * operator run — a real POST /api/admin/clear-demo — the database is copied
 * aside into the data folder, as `app.before-clear-demo.<UTC time>.db`.
 *
 * The copy is made by SQLite itself (better-sqlite3's backup), not by copying
 * the file: the database runs in WAL mode, where app.db alone can be missing
 * what is still in the write-ahead log.
 *
 * Only the database: the uploaded files in uploads/ that the run then deletes
 * are not copied. To go back, stop the server and put the copy in place of
 * app.db (README "Clearing the demo"). There is no restore over HTTP here —
 * point-in-time recovery is the Cloudflare Durable Object's.
 */
export function nodeRestorePoints(db: NodeDB, dataDir: string): RestoreDeps {
  return {
    async record() {
      const at = Date.now();
      // 2026-11-23T17:12:05.123Z → 20261123T171205Z
      const stamp = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
      fs.mkdirSync(dataDir, { recursive: true });
      // Never over an earlier copy (two runs in the same second).
      let file = path.join(dataDir, `app.before-clear-demo.${stamp}.db`);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dataDir, `app.before-clear-demo.${stamp}-${n}.db`);
      await db.$client.backup(file);
      return { kind: 'file', file, at };
    },
  };
}
