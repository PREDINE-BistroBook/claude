/**
 * Taking the database back in time — what the runtime offers the operator
 * endpoints (routes/admin.ts), handed to createApp as `restore` so the app
 * itself never touches a Durable Object's storage or a disk:
 *
 * - Cloudflare (src/worker/school.ts): the SQLite-backed Durable Object's
 *   point-in-time recovery. A "bookmark" names a moment in the last 30 days;
 *   the whole database (rows, and the files kept in it) can be restored to
 *   one, and that restore can itself be undone.
 * - Node (src/server/nodeRestore.ts): only `record` — a copy of the database
 *   file made just before a destructive run. Going back is done by hand.
 * - Tests and local wrangler dev: nothing (local workerd keeps no change log).
 */
import type { RestorePoint, RestorePointResponse, RestoreResponse } from '../../shared/schemas/admin';

export interface RestoreDeps {
  /**
   * Record a point to come back to, right now — called by a real clear-demo
   * run before it changes anything. null: this runtime has none to offer.
   * A throw stops the run (503 `restore_point_failed`, nothing changed).
   */
  record(): Promise<RestorePoint | null>;
  /** GET /api/admin/restore-point: a bookmark for this moment. Missing, or null: not supported here (501). */
  current?(): Promise<RestorePointResponse | null>;
  /**
   * POST /api/admin/restore: set the database to come back as it was at
   * `bookmark` (or at epoch ms `time`), and restart on it once the response is
   * out. Missing, or null: not supported here (501). A throw is the runtime
   * refusing (409 `restore_refused`): an unknown bookmark, a time too far back.
   */
  restoreTo?(target: { bookmark: string } | { time: number }): Promise<RestoreResponse | null>;
}
