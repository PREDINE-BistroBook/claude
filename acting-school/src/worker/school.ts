import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { createApp } from '../server/app';
import { CLOUDFLARE_DEFAULTS, configFromVars } from '../server/config';
import { initDb, type DB } from '../server/db/database';
import * as schema from '../server/db/schema';
import { users } from '../server/db/schema';
import { activeOwnerCount } from '../server/lib/access';
import { fallbackFileStore, sqliteFileStore } from '../server/lib/fileStore';
import type { Env } from './env';
import { r2FileStore } from './r2FileStore';

/**
 * The whole school in one Durable Object: the Hono API (server/app.ts, the
 * same app the Node server runs) over this object's own SQLite storage, through
 * drizzle's durable-sqlite driver — synchronous, like better-sqlite3, so every
 * query and transaction is shared code. One instance ("main") serves every
 * request, one at a time, which keeps the Node server's concurrency model.
 *
 * Start-up (migrations, built-in positions, backfills — initDb) runs inside
 * blockConcurrencyWhile, so no request sees a half-migrated database.
 *
 * It extends DurableObject (cloudflare:workers) so the object also speaks
 * Workers RPC — what wrangler's local explorer and Cloudflare's tools use to
 * run SQL against its storage. The API itself is served by fetch() only, and
 * the class has no other public methods.
 */
export class SchoolDO extends DurableObject<Env> {
  private app: ReturnType<typeof createApp> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const db = drizzle(ctx.storage, { schema }) as unknown as DB;
      initDb(db);
      // Cloudflare always serves HTTPS (Secure, __Host- cookies unless COOKIE_SECURE=false), and the
      // Worker is public from the first deploy: first-run setup needs the setup code (ADMIN_TOKEN).
      const config = configFromVars(env as unknown as Record<string, string | undefined>, CLOUDFLARE_DEFAULTS);
      // R2 when bound (files from before it was bound are still read from SQLite), else SQLite.
      const files = env.FILES ? fallbackFileStore(r2FileStore(env.FILES), sqliteFileStore(db)) : sqliteFileStore(db);
      // The client's address for the sign-in brakes: set by Cloudflare's edge (clients can't forge
      // it), passed on unchanged by the Worker (index.ts), the only thing that reaches this object.
      this.app = createApp({ db, config, files, clientIp: (c) => c.req.header('cf-connecting-ip') });
      if (db.select({ id: users.id }).from(users).limit(1).get() && activeOwnerCount(db) === 0) {
        console.warn('No active account holds an owner position. Give one back with POST /api/admin/grant-owner (README).');
      }
    });
  }

  override fetch(request: Request): Response | Promise<Response> {
    if (!this.app) return new Response('Starting up', { status: 503 });
    return this.app.fetch(request);
  }
}
