import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppConfig } from './config';
import type { DB } from './db/database';
import type { AppEnv } from './env';
import { ApiError, sqliteConstraint } from './lib/errors';
import type { FileStore } from './lib/fileStore';
import { loadSession, requireAjaxHeader } from './middleware/auth';
import { limitBody, MAX_JSON_BODY_BYTES } from './middleware/bodyLimit';
import { adminRoutes } from './routes/admin';
import authRoutes from './routes/auth';
import castingRoutes from './routes/castings';
import courseRoutes from './routes/courses';
import dashboardRoutes from './routes/dashboard';
import fileRoutes from './routes/files';
import leadRoutes from './routes/leads';
import positionRoutes from './routes/positions';
import scheduleRoutes from './routes/schedule';
import sessionRoutes from './routes/sessions';
import settingsRoutes from './routes/settings';
import staffRoutes from './routes/staff';
import studentRoutes from './routes/students';
import submissionRoutes from './routes/submissions';
import talentRoutes from './routes/talent';

export interface AppDeps {
  db: DB;
  config: AppConfig;
  /** Where uploaded file bytes live (lib/fileStore.ts). */
  files: FileStore;
  /**
   * The client's IP address, from what the runtime trusts: CF-Connecting-IP on
   * Cloudflare (set by Cloudflare's edge), the socket on Node. Used by the
   * sign-in brakes (lib/signInBrake.ts). Omitted (tests): unknown.
   */
  clientIp?: (c: Context<AppEnv>) => string | null | undefined;
}

/**
 * The API as a plain Hono app — no runtime specifics, so the same app runs on
 * the Node server (src/server/index.ts adds the HTTP server and static files),
 * inside the Cloudflare Durable Object (src/worker/), and in tests through
 * app.request() against an in-memory database.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('db', deps.db);
    c.set('config', deps.config);
    c.set('files', deps.files);
    c.set('clientIp', deps.clientIp?.(c) || null);
    await next();
  });

  app.use('/api/*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));
  app.use('/api/*', async (c, next) => {
    await next();
    // Staff data: never cache API JSON anywhere (files set their own header).
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });
  // Bodies are refused over 1 MB (uploads: their own 8 MB limit in routes/files.ts).
  const jsonBodyLimit = limitBody(MAX_JSON_BODY_BYTES);
  app.use('/api/*', (c, next) => (c.req.path === '/api/files' ? next() : jsonBodyLimit(c, next)));
  // Operator endpoints (bearer token, no cookie): before the browser-session guards. Without
  // ADMIN_TOKEN they pass the request on, so it ends like any unknown route.
  app.use('/api/admin/*', adminRoutes({ request: (path, init) => app.request(path, init) }));
  app.use('/api/*', requireAjaxHeader);
  app.use('/api/*', loadSession);

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes);
  app.route('/api/files', fileRoutes);
  app.route('/api/staff', staffRoutes);
  app.route('/api/positions', positionRoutes);
  app.route('/api/settings', settingsRoutes);
  app.route('/api/students', studentRoutes);
  app.route('/api/courses', courseRoutes);
  app.route('/api/sessions', sessionRoutes);
  app.route('/api/talent', talentRoutes);
  app.route('/api/castings', castingRoutes);
  app.route('/api/submissions', submissionRoutes);
  app.route('/api/leads', leadRoutes);
  app.route('/api/schedule', scheduleRoutes);
  app.route('/api/dashboard', dashboardRoutes);

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'No such API route' } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.issues ? { issues: err.issues } : {}),
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        err.status,
      );
    }
    // SQLite constraint errors that slipped past validation (either driver: lib/errors.ts).
    const constraint = sqliteConstraint(err);
    if (constraint === 'unique') return c.json({ error: { code: 'conflict', message: 'That already exists' } }, 409);
    if (constraint === 'foreign_key') return c.json({ error: { code: 'bad_request', message: 'A linked record does not exist' } }, 400);
    console.error(err);
    return c.json({ error: { code: 'server_error', message: 'Something went wrong' } }, 500);
  });

  return app;
}
