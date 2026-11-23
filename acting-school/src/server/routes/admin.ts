import { count } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import {
  CLEAR_DEMO_ERROR_CODES,
  clearDemoInput,
  grantOwnerInput,
  restoreInput,
  seedDemoInput,
  type ClearDemoResult,
  type GrantOwnerResponse,
  type ResetResult,
  type RestorePointResponse,
  type RestoreResponse,
  type SeedDemoWebsiteResult,
} from '../../shared/schemas/admin';
import { clearDemo } from '../db/clearDemo';
import { seedDemo, seedDemoWebsite } from '../db/demoSeed';
import { siteCoaches, users } from '../db/schema';
import { wipeAllData } from '../db/wipe';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { grantOwner } from '../lib/ownerRecovery';
import { sameSecret } from '../lib/password';
import type { RestoreDeps } from '../lib/restorePoint';
import { hasSiteContent } from '../lib/siteContent';
import { body } from '../lib/validate';

/**
 * Operator endpoints for a deployment with no shell next to its database
 * (Cloudflare): demo seeding (the school, or just its website on a database
 * seeded before the website existed), demo reset, lockout recovery.
 *
 *   POST /api/admin/seed-demo    { password }  only while there are no staff accounts (else 409)
 *   POST /api/admin/seed-demo-website           the website demo, only while the website is empty
 *                                               (no 'site' settings key and no coaches; else 409)
 *   POST /api/admin/reset                      wipes everything; only with ALLOW_DEMO_RESET=true
 *   POST /api/admin/grant-owner  { email } or { username }   same as `npm run owner -- <username or email>`
 *   POST /api/admin/clear-demo   { create, keep?, owner, keepSiteContent, dryRun?, confirm? }
 *                                               delete every record and every account not kept, create the
 *                                               real team with temporary passwords (db/clearDemo.ts). A dry
 *                                               run unless `dryRun: false` comes with the dry run's `confirm`.
 *   GET  /api/admin/restore-point               a bookmark for the database as it is now (Cloudflare)
 *   POST /api/admin/restore      { bookmark } or { minutesAgo }   take the whole database back (Cloudflare):
 *                                               202, then the object restarts on the restored state
 *
 * Every call needs `Authorization: Bearer <ADMIN_TOKEN>` (compared in constant
 * time; the token is never logged). Without ADMIN_TOKEN configured the routes
 * don't exist: the request carries on through the app exactly like any unknown
 * /api route. No session cookie or X-Requested-With needed (a bearer token
 * isn't sent by browsers on their own, so there's nothing to forge).
 */
export function adminRoutes(deps: {
  request: (path: string, init: RequestInit) => Response | Promise<Response>;
  /** Restore points, where the runtime has them (lib/restorePoint.ts). */
  restore?: RestoreDeps;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = c.get('config').adminToken;
    if (!token) {
      await next();
      return;
    }
    if (!bearerMatches(c.req.header('authorization'), token)) {
      c.header('WWW-Authenticate', 'Bearer');
      throw new ApiError(401, 'unauthorized', 'Admin token required');
    }
    const name = c.req.path.replace(/^\/api\/admin\//, '');
    const action = c.req.method === 'POST' ? name : null;
    const db = c.get('db');

    if (action === 'seed-demo') {
      const input = await body(c, seedDemoInput);
      const staff = db.select({ n: count() }).from(users).get()?.n ?? 0;
      if (staff > 0) throw new ApiError(409, 'not_empty', 'This database already has staff accounts; demo data only goes into an empty one');
      // Setup on Cloudflare asks for the setup code, which is this same token.
      const result = await seedDemo({
        db,
        files: c.get('files'),
        request: deps.request,
        password: input.password,
        timeZone: c.get('config').timeZone,
        setupCode: token,
      });
      console.log(`Admin: demo data seeded in ${result.seconds}s.`);
      return c.json(result, 201);
    }

    if (action === 'seed-demo-website') {
      // Idempotent: the website is filled in once, only while nobody has edited it (no content saved, no coaches).
      const coaches = db.select({ n: count() }).from(siteCoaches).get()?.n ?? 0;
      if (hasSiteContent(db) || coaches > 0) throw new ApiError(409, 'not_empty', 'The website already has content; the demo only goes into an empty one');
      const result = await seedDemoWebsite({ db, files: c.get('files'), timeZone: c.get('config').timeZone });
      console.log(`Admin: website demo seeded (${result.coaches} coaches, ${result.workshops} workshops, ${result.applications} applications).`);
      return c.json<SeedDemoWebsiteResult>(result, 201);
    }

    if (action === 'reset') {
      if (!c.get('config').allowDemoReset) throw new ApiError(403, 'reset_disabled', 'Reset is off here (ALLOW_DEMO_RESET is not "true")');
      const { deletedFiles } = await wipeAllData(db, c.get('files'));
      console.log(`Admin: all data wiped (${deletedFiles} files).`);
      return c.json<ResetResult>({ ok: true, deletedFiles });
    }

    if (action === 'grant-owner') {
      const input = await body(c, grantOwnerInput);
      const name = input.username ?? input.email;
      if (!name) throw new ApiError(400, 'validation', 'Send the account’s username or email', [{ path: ['username'], code: 'custom', message: 'errors.required' }]);
      const result = grantOwner(db, name);
      if (!result.found) throw notFound('No team account has that username or email');
      if (!result.isOwner) throw new ApiError(409, 'not_owner', 'Could not make this account an owner; check the positions');
      console.log(`Admin: owner position given to account ${result.user.id}.`);
      return c.json<GrantOwnerResponse>({
        ok: true,
        username: result.user.username,
        email: result.user.email,
        name: result.user.name,
        position: result.position.name,
        reactivated: !result.wasActive,
        restoredOwnerPosition: result.restored,
        ceoNotOwner: result.position.key !== FIRST_OWNER_POSITION,
      });
    }

    if (action === 'clear-demo') {
      const input = await body(c, clearDemoInput);
      const result = await clearDemo({ db, files: c.get('files'), token, restore: deps.restore }, input);
      if (!result.dryRun) {
        const created = result.accounts.filter((a) => a.status === 'created').length;
        const point = result.restorePoint ? (result.restorePoint.kind === 'bookmark' ? `bookmark ${result.restorePoint.bookmark}` : `file ${result.restorePoint.file}`) : 'none';
        // Never the passwords, never the token.
        console.log(
          `Admin: demo cleared — ${result.deleted.users} accounts deleted, ${created} created, ${result.accounts.length - created} kept, ${result.deleted.files} files deleted. Restore point: ${point}.`,
        );
      }
      return c.json<ClearDemoResult>(result);
    }

    if (c.req.method === 'GET' && name === 'restore-point') {
      const point = await deps.restore?.current?.();
      if (!point) throw notSupported();
      return c.json<RestorePointResponse>(point);
    }

    if (action === 'restore') {
      const restore = deps.restore;
      // Where there is nothing to restore from, say so whatever the body: no restoreTo at all (Node,
      // tests), or a runtime whose recovery turns out not to be there (local workerd: `current` answers
      // null). A probe that throws for another reason doesn't stop a restore on Cloudflare.
      if (!restore?.restoreTo) throw notSupported();
      if (restore.current && (await restore.current().catch(() => undefined)) === null) throw notSupported();
      const input = await body(c, restoreInput);
      let result: RestoreResponse | null;
      try {
        result = await restore.restoreTo(input.bookmark !== undefined ? { bookmark: input.bookmark } : { time: Date.now() - input.minutesAgo! * 60_000 });
      } catch (err) {
        // The runtime's own words (an unknown bookmark, a time out of reach): they name no secret.
        throw new ApiError(409, CLEAR_DEMO_ERROR_CODES.restoreRefused, 'The database could not be set to restore to that point', undefined, {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      if (!result) throw notSupported();
      console.log(`Admin: restoring the database to ${result.restoringTo}. To undo: restore to ${result.undoBookmark}.`);
      return c.json<RestoreResponse>(result, 202);
    }

    return c.json({ error: { code: 'not_found', message: 'No such API route' } }, 404);
  };
}

/** 501: the Node server and local wrangler dev keep no history to go back to. */
const notSupported = () =>
  new ApiError(501, CLEAR_DEMO_ERROR_CODES.notSupported, 'Point-in-time recovery is only there on Cloudflare (the deployed Durable Object), not on this server');

/** `Authorization: Bearer <token>`, compared in constant time. */
function bearerMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return sameSecret(m?.[1]?.trim() ?? '', token) && !!m;
}
