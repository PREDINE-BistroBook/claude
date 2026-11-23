/**
 * The studio's own domain (PUBLIC_SITE_HOSTS, e.g. "turquoisestudio.app,
 * www.turquoisestudio.app"): on those hosts the public website is served at
 * the root and nothing of the staff app answers. Used before the app sees the
 * request — by the Cloudflare Worker (src/worker/routing.ts) and the Node
 * server (src/server/index.ts) — so the app itself always routes the site
 * under /site and only writes its links differently (paths.ts).
 *
 * - "www.<apex>" (when both are listed) → 301 to the apex, same path and query;
 * - any other path /x on a public host → the app's /site/x (/ → /site): the
 *   site's pages, /media/:id, and its friendly 404 for everything else —
 *   /api/*, /login, the staff app's files and service worker included;
 * - any other host: not ours to touch ('staff').
 */
import { SITE_BASE, isPublicSiteHost, normalizeHost } from './paths';

export type PublicHostRoute =
  /** Not a public host: route as the staff app always did. */
  | { kind: 'staff' }
  /** www → apex (301). */
  | { kind: 'redirect'; location: string }
  /** Serve the app's /site/… for this (rewritten) URL, same host. */
  | { kind: 'site'; url: string };

export function routePublicHost(url: URL, publicHosts: readonly string[]): PublicHostRoute {
  const host = normalizeHost(url.hostname);
  if (!isPublicSiteHost(host, publicHosts)) return { kind: 'staff' };
  if (host.startsWith('www.') && isPublicSiteHost(host.slice(4), publicHosts)) {
    const apex = new URL(url.href);
    apex.hostname = host.slice(4);
    return { kind: 'redirect', location: apex.href };
  }
  const site = new URL(url.href);
  // The URL parser has already resolved "." and ".." segments, so the result always stays under /site.
  site.pathname = url.pathname === '/' ? SITE_BASE : `${SITE_BASE}${url.pathname}`;
  return { kind: 'site', url: site.href };
}

/** The request again with another URL (method, headers and body unchanged). */
export function withUrl(request: Request, url: string): Request {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    // Needed by Node's fetch for a streamed body; ignored by workerd.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

/** The www → apex answer. */
export function apexRedirect(location: string): Response {
  return new Response(null, { status: 301, headers: { Location: location, 'Cache-Control': 'public, max-age=3600' } });
}
