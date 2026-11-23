/**
 * Where each request to the Worker goes (index.ts wires in the real bindings;
 * no Cloudflare imports here, so the Node tests can drive it with a fake
 * ASSETS and Durable Object — tests/unit/workerRouting.test.ts):
 *
 * On a public host (PUBLIC_SITE_HOSTS: turquoisestudio.app, www.…):
 * - www → 301 to the apex, same path and query;
 * - every path /x → the Durable Object as /site/x (the public website at the
 *   root); nothing of the staff app — /api/*, /login, its static files, the
 *   service worker — answers there: those paths get the site's 404 page.
 *
 * On any other host (staff.turquoisestudio.app, workers.dev, localhost):
 * - /api/* and /site, /site/* → the Durable Object (the API and the public
 *   site's /site previews), unless the body is too large (413, per route);
 * - everything else → the static assets (the staff app), exactly as before;
 *   a missing hashed /assets/* file is a 404, not the HTML shell.
 */
import { MAX_JSON_BODY_BYTES } from '../server/middleware/bodyLimit';
import { bareSiteCtx, langForPath } from '../server/site/context';
import { SITE_SECURITY_HEADERS } from '../server/site/headers';
import { errorPage } from '../server/site/pages';
import { SITE_BASE, publicHostSitePaths, sitePaths } from '../server/site/paths';
import { apexRedirect, routePublicHost, withUrl } from '../server/site/publicHost';
import { htmlString } from '../server/site/render';
import { MAX_UPLOAD_BYTES } from '../shared/schemas/files';
import { SITE_APPLY_MAX_BYTES, SITE_CASTING_MAX_BYTES } from '../shared/schemas/site';

/** Anything with a fetch(Request) → Response: the ASSETS binding, a Durable Object stub. */
export interface RequestHandler {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerDeps {
  /** The static assets (the built staff app). */
  assets: RequestHandler;
  /** The school's one Durable Object. */
  school: () => RequestHandler;
  /** config.publicSiteHosts (PUBLIC_SITE_HOSTS, parsed). */
  publicSiteHosts: readonly string[];
}

const isSitePath = (p: string) => p === SITE_BASE || p.startsWith(`${SITE_BASE}/`);
const isApiPath = (p: string) => p === '/api' || p.startsWith('/api/');

/**
 * The largest body each route reads (the app enforces the same on bodies
 * without a Content-Length): uploads 8 MB (+ multipart overhead), the casting
 * form 20 MB, the other public forms 64 KB, the JSON API 1 MB.
 */
export function maxBodyBytes(appPath: string): number {
  if (appPath === '/api/files') return MAX_UPLOAD_BYTES + 64 * 1024;
  if (isSitePath(appPath)) return /^\/site\/[^/]+\/casting-call$/.test(appPath) ? SITE_CASTING_MAX_BYTES : SITE_APPLY_MAX_BYTES;
  return MAX_JSON_BODY_BYTES;
}

/** A body that announces more than the route would read is refused before it reaches the Durable Object (128 MB for the whole school). */
function tooLarge(request: Request, appPath: string): boolean {
  const declared = request.headers.get('content-length');
  if (declared === null) return false;
  return !(Number(declared) <= maxBodyBytes(appPath));
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function apiTooLarge(): Response {
  return Response.json({ error: { code: 'payload_too_large', message: 'The request is too large' } }, { status: 413, headers: NO_STORE });
}

/** The site's friendly 413 page ("the photos are too big"), rendered here without the database. */
function siteTooLarge(url: URL, appPath: string, publicHost: boolean): Response {
  const lang = langForPath(appPath, null);
  const paths = publicHost ? publicHostSitePaths : sitePaths;
  const back = /^\/site\/[^/]+\/casting-call$/.test(appPath) ? `${(publicHost ? appPath.slice(SITE_BASE.length) : appPath)}#apply` : undefined;
  const body = htmlString(errorPage(bareSiteCtx(url, lang, paths), 'tooLarge', back));
  return new Response(body, { status: 413, headers: { 'Content-Type': 'text/html; charset=UTF-8', ...SITE_SECURITY_HEADERS, 'Cache-Control': 'no-store' } });
}

export async function routeRequest(request: Request, deps: WorkerDeps): Promise<Response> {
  const url = new URL(request.url);
  const route = routePublicHost(url, deps.publicSiteHosts);
  if (route.kind === 'redirect') return apexRedirect(route.location);
  if (route.kind === 'site') {
    const appPath = new URL(route.url).pathname;
    if (tooLarge(request, appPath)) return siteTooLarge(url, appPath, true);
    return deps.school().fetch(withUrl(request, route.url));
  }

  const { pathname } = url;
  if (isApiPath(pathname) || isSitePath(pathname)) {
    if (tooLarge(request, pathname)) return isApiPath(pathname) ? apiTooLarge() : siteTooLarge(url, pathname, false);
    return deps.school().fetch(request);
  }
  const res = await deps.assets.fetch(request);
  if (pathname.startsWith('/assets/') && (res.headers.get('content-type') ?? '').startsWith('text/html')) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE } });
  }
  return res;
}
