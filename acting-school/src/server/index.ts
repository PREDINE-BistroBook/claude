import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { users } from './db/schema';
import { activeOwnerCount } from './lib/access';

const config = loadConfig();
const db = createDb(path.join(config.dataDir, 'app.db'));
const app = createApp({ db, config });

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
  app.use('*', async (c, next) => {
    await next();
    if (!c.req.path.startsWith('/api/')) {
      c.header('Content-Security-Policy', csp);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'same-origin');
      // Hashed asset files can be cached forever; the shell and service worker must not be.
      if (c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable');
      else c.header('Cache-Control', 'no-cache');
    }
  });
  app.use('*', serveStatic({ root: path.relative(process.cwd(), webRoot) || '.' }));
  // A missing hashed asset (an old tab after a deploy) is a 404, not the HTML shell
  // served as JavaScript.
  app.get('/assets/*', (c) => c.text('Not found', 404));
  // Client-side routes (/students/12 …) all load the app shell.
  const shell = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  app.get('*', (c) => c.html(shell));
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Acting School API on http://localhost:${info.port} (data: ${config.dataDir})`);
});
