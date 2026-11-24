/**
 * The Cloudflare Worker ("claude", wrangler.jsonc). It runs first for every
 * request (run_worker_first: true) so it can tell the hosts apart:
 * - an old address of the staff app (HOST_REDIRECTS: staff.turquoisestudio.app)
 *   forwards to the current one, team.turquoisestudio.app (hostRedirect.ts:
 *   pages 301, the API keeps answering, /sw.js retires the old service worker);
 * then, in routing.ts:
 * - the studio's public hosts (PUBLIC_SITE_HOSTS: turquoisestudio.app, www.…)
 *   get the public website at their root (www → 301 to the apex), served by
 *   the Durable Object; nothing of the staff app answers there;
 * - on any other host, /api/* and /site, /site/* go to the school's Durable
 *   Object (school.ts: the API, the public site's previews and their SQLite
 *   database), unless the body is too large for the route (413); everything
 *   else is the built web app (dist/web, static assets with the SPA fallback),
 *   passed to the ASSETS binding as before, and a missing hashed /assets/*
 *   file is a 404 rather than the HTML shell.
 */
import { parsePublicSiteHosts } from '../server/config';
import type { Env } from './env';
import { hostRedirect, parseHostRedirects } from './hostRedirect';
import { routeRequest } from './routing';
import { SchoolDO } from './school';

export { SchoolDO };

/** One Durable Object for the whole school. */
const INSTANCE = 'main';

export default {
  fetch(request, env): Promise<Response> {
    // An old address of the staff app (HOST_REDIRECTS) forwards to the current one.
    const moved = hostRedirect(request, parseHostRedirects(env.HOST_REDIRECTS));
    if (moved) return Promise.resolve(moved);
    return routeRequest(request, {
      assets: env.ASSETS,
      school: () => env.SCHOOL.get(env.SCHOOL.idFromName(INSTANCE)),
      publicSiteHosts: parsePublicSiteHosts(env.PUBLIC_SITE_HOSTS),
    });
  },
} satisfies ExportedHandler<Env>;
