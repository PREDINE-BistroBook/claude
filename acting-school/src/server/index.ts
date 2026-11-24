import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { createDb } from './db/client';
import { users } from './db/schema';
import { activeOwnerCount } from './lib/access';
import { loadConfig } from './nodeConfig';
import { folderFileStore } from './nodeFileStore';
import { nodeRestorePoints } from './nodeRestore';
import { SITE_BASE } from './site/paths';
import { apexRedirect, routePublicHost, withUrl } from './site/publicHost';

/**
 * The Node server: the API (app.ts) on a better-sqlite3 file plus, in
 * production, the built web app. The Cloudflare equivalent is src/worker/
 * (static assets + the same API inside a Durable Object); public/_headers
 * carries the headers set here for the web app.
 */
const config = loadConfig();
const db = createDb(path.join(config.dataDir, 'app.db'));
const app = createApp({
  db,
  config,
  files: folderFileStore(config.uploadsDir),
  // The socket's address, for the sign-in brakes (behind a reverse proxy: the proxy's).
  clientIp: (c) => {
    try {
      return getConnInfo(c).remote.address;
    } catch {
      return null;
    }
  },
  // Before a real POST /api/admin/clear-demo the database is copied aside (there is no point-in-time recovery here).
  restore: nodeRestorePoints(db, config.dataDir),
});

// Staff exist but nobody active holds an owner position (e.g. every former owner deactivated):
// owner-only actions are out of reach until someone runs the recovery script.
if (db.select({ id: users.id }).from(users).limit(1).get() && activeOwnerCount(db) === 0) {
  console.warn('No active account holds an owner position. Give one back with: npm run owner -- someone@example.com');
}

// In production the same server hands out the built web app (dist/web).
// In development Vite serves the web app and proxies /api here.
const webRoot = path.resolve(process.env.APP_ROOT ?? process.cwd(), 'dist/web');
if (fs.existsSync(webRoot)) {
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  // The public website (/site, /site/*) is the app's own router, with its own headers (src/server/site/):
  // never the staff app's shell or headers.
  const isSite = (p: string) => p === SITE_BASE || p.startsWith(`${SITE_BASE}/`);
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/') && !isSite(c.req.path)) {
      c.header('Content-Security-Policy', csp);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'same-origin');
      // Hashed asset files can be cached forever; the shell and service worker must not be.
      if (c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable');
      else c.header('Cache-Control', 'no-cache');
    }
  });
  // Cloudflare's header rules (src/web/public/_headers) are config, not a page.
  app.get('/_headers', (c) => c.text('Not found', 404));
  app.use('*', serveStatic({ root: path.relative(process.cwd(), webRoot) || '.' }));
  // A missing hashed asset (an old tab after a deploy) is a 404, not the HTML shell
  // served as JavaScript.
  app.get('/assets/*', (c) => c.text('Not found', 404));
  // Client-side routes (/students/12 …) all load the app shell — never /site/…, which the site router answers.
  const shell = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  app.get('*', (c) => (isSite(c.req.path) ? c.text('Not found', 404) : c.html(shell)));
}

/**
 * The studio's public hosts (PUBLIC_SITE_HOSTS), as on Cloudflare (src/worker/routing.ts): www → the
 * apex, every path /x → the site's /site/x, nothing of the staff app. Behind a reverse proxy, it must
 * pass the original Host header on.
 */
function fetchWithPublicHosts(request: Request, env: unknown): Response | Promise<Response> {
  const route = routePublicHost(new URL(request.url), config.publicSiteHosts);
  if (route.kind === 'redirect') return apexRedirect(route.location);
  return app.fetch(route.kind === 'site' ? withUrl(request, route.url) : request, env);
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: fetchWithPublicHosts, port }, (info) => {
  console.log(`Acting School API on http://localhost:${info.port} (data: ${config.dataDir})`);
});
