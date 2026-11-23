import { count } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import { grantOwnerInput, seedDemoInput, type GrantOwnerResponse, type ResetResult, type SeedDemoWebsiteResult } from '../../shared/schemas/admin';
import { seedDemo, seedDemoWebsite } from '../db/demoSeed';
import { siteCoaches, users } from '../db/schema';
import { wipeAllData } from '../db/wipe';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { grantOwner } from '../lib/ownerRecovery';
import { sameSecret } from '../lib/password';
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
 *   POST /api/admin/grant-owner  { email }     same as `npm run owner -- email`
 *
 * Every call needs `Authorization: Bearer <ADMIN_TOKEN>` (compared in constant
 * time; the token is never logged). Without ADMIN_TOKEN configured the routes
 * don't exist: the request carries on through the app exactly like any unknown
 * /api route. No session cookie or X-Requested-With needed (a bearer token
 * isn't sent by browsers on their own, so there's nothing to forge).
 */
export function adminRoutes(deps: { request: (path: string, init: RequestInit) => Response | Promise<Response> }): MiddlewareHandler<AppEnv> {
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
    const action = c.req.method === 'POST' ? c.req.path.replace(/^\/api\/admin\//, '') : null;
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
      const result = grantOwner(db, input.email);
      if (!result.found) throw notFound('No staff account uses that email');
      if (!result.isOwner) throw new ApiError(409, 'not_owner', 'Could not make this account an owner; check the positions');
      console.log(`Admin: owner position given to account ${result.user.id}.`);
      return c.json<GrantOwnerResponse>({
        ok: true,
        email: result.user.email,
        name: result.user.name,
        position: result.position.name,
        reactivated: !result.wasActive,
        restoredOwnerPosition: result.restored,
        ceoNotOwner: result.position.key !== FIRST_OWNER_POSITION,
      });
    }

    return c.json({ error: { code: 'not_found', message: 'No such API route' } }, 404);
  };
}

/** `Authorization: Bearer <token>`, compared in constant time. */
function bearerMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '');
  return sameSecret(m?.[1]?.trim() ?? '', token) && !!m;
}
