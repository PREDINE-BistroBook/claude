/**
 * Old addresses of the staff app that now forward to its current one
 * (HOST_REDIRECTS, "old.host=new.host,…": staff.turquoisestudio.app became
 * team.turquoisestudio.app when the school renamed Staff to Team).
 *
 * On an old host:
 * - /api/* keeps answering, so a page that was already open doesn't break
 *   mid-task (its next full load moves it);
 * - /sw.js is a service worker that unregisters itself and reloads its pages:
 *   an installed app there is served from its old cache and would otherwise
 *   never reach the network, so never see the redirect;
 * - every other GET/HEAD → 301 to the same path on the new host.
 *
 * No Cloudflare imports, so the Node tests can exercise it.
 */

export function parseHostRedirects(value: string | undefined): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const pair of (value ?? '').split(',')) {
    const [from, to] = pair.split('=').map((s) => s.trim().toLowerCase());
    if (from && to && /^[a-z0-9.-]+$/.test(from) && /^[a-z0-9.-]+$/.test(to) && from !== to) map.set(from, to);
  }
  return map;
}

const RETIRE_SERVICE_WORKER = `// This address has moved: remove this service worker and reload, so the page follows the redirect.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
`;

/** The answer for a request on a retired host, or null when the request should be handled normally. */
export function hostRedirect(request: Request, redirects: ReadonlyMap<string, string>): Response | null {
  const url = new URL(request.url);
  const to = redirects.get(url.hostname);
  if (!to) return null;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (url.pathname === '/sw.js') {
    return new Response(request.method === 'HEAD' ? null : RETIRE_SERVICE_WORKER, {
      status: 200,
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return new Response(null, {
    status: 301,
    headers: { Location: `https://${to}${url.pathname}${url.search}`, 'Cache-Control': 'public, max-age=3600' },
  });
}
