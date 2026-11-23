/**
 * Point-in-time recovery of the school's Durable Object, as the app's
 * `restore` dependency (server/lib/restorePoint.ts) — behind the operator
 * endpoints GET /api/admin/restore-point, POST /api/admin/restore, and the
 * restore point a real POST /api/admin/clear-demo records first.
 *
 * Cloudflare keeps 30 days of history for a SQLite-backed Durable Object and
 * names a moment with a "bookmark"
 * (developers.cloudflare.com/durable-objects/api/sqlite-storage-api → PITR):
 * - getCurrentBookmark(): now;
 * - getBookmarkForTime(ms): a moment in the last 30 days, approximately;
 * - onNextSessionRestoreBookmark(bookmark): the object comes back on that
 *   state the next time it starts — and the call returns a bookmark for "just
 *   before the restore", to undo it with. ctx.abort() then restarts the object.
 *
 * It covers the whole database — every table, and the uploaded files while
 * they are stored in it (file_chunks) — and nothing else: not files in R2.
 *
 * Not in local development (`wrangler dev`): workerd keeps no history there
 * ("The PITR API is not supported in local development", the same page).
 * getCurrentBookmark() answers a stand-in and the other two throw; both read
 * as null here ("not supported"), so the endpoints answer 501 and a local
 * clear-demo run simply has no restore point.
 *
 * No Cloudflare imports here (school.ts passes ctx.storage and ctx in), so the
 * Node tests can drive it with a fake — tests/unit/pointInTimeRecovery.test.ts.
 */
import type { RestoreDeps } from '../server/lib/restorePoint';

/** The three recovery calls of DurableObjectStorage. */
export interface RecoveryStorage {
  getCurrentBookmark(): Promise<string>;
  getBookmarkForTime(timestamp: number): Promise<string>;
  onNextSessionRestoreBookmark(bookmark: string): Promise<string>;
}

/** What restarting needs of DurableObjectState. */
export interface Restartable {
  waitUntil(task: Promise<unknown>): void;
  abort(reason?: string): void;
}

/** What local workerd answers for every recovery call but getCurrentBookmark. */
const NO_RECOVERY_HERE = /does not implement point-in-time recovery/i;

/**
 * Local workerd's getCurrentBookmark() is a stand-in (a counter that goes up
 * with each call, made to look like a bookmark): it ends in 32 zeros where a
 * real one — "0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b" —
 * has a hash. Nothing can be restored to it.
 */
const STAND_IN_BOOKMARK = /-0{32}$/;

/** How long after the answer the object restarts for a restore: long enough for the 202 to be on its way. */
export const RESTART_AFTER_MS = 500;

export function pointInTimeRecovery(storage: RecoveryStorage, object: Restartable, restartAfterMs = RESTART_AFTER_MS): RestoreDeps {
  /** null where there is no recovery (local workerd); any other failure is thrown on. */
  async function supported<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof Error && NO_RECOVERY_HERE.test(err.message)) return null;
      throw err;
    }
  }
  /** A bookmark that names a moment the database can go back to. */
  const real = (bookmark: string | null) => (bookmark && !STAND_IN_BOOKMARK.test(bookmark) ? bookmark : null);
  const current = async () => {
    const bookmark = real(await supported(() => storage.getCurrentBookmark()));
    return bookmark ? { bookmark, at: Date.now() } : null;
  };

  return {
    current,
    async record() {
      const point = await current();
      return point ? { kind: 'bookmark', ...point } : null;
    },
    async restoreTo(target) {
      const bookmark = 'bookmark' in target ? target.bookmark : real(await supported(() => storage.getBookmarkForTime(target.time)));
      if (!bookmark) return null;
      const undoBookmark = await supported(() => storage.onNextSessionRestoreBookmark(bookmark));
      if (!undoBookmark) return null;
      // The restore happens when the object next starts. abort() resets it at once — and would take
      // this request down with it — so the answer goes out first, and the restart follows it.
      object.waitUntil(
        new Promise((resolve) => setTimeout(resolve, restartAfterMs)).then(() => object.abort('Restarting to restore the database to an earlier point (POST /api/admin/restore)')),
      );
      return { restoringTo: bookmark, undoBookmark };
    },
  };
}
