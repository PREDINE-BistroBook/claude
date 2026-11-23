import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppConfig } from './config';
import type { DB } from './db/database';
import type { AppEnv } from './env';
import { ApiError, sqliteConstraint } from './lib/errors';
import type { FileStore } from './lib/fileStore';
import type { RestoreDeps } from './lib/restorePoint';
import { loadSession, requireAjaxHeader, requireOwnPassword } from './middleware/auth';
import { limitBody, MAX_JSON_BODY_BYTES } from './middleware/bodyLimit';
import { adminRoutes } from './routes/admin';
import authRoutes from './routes/auth';
import cafeRoutes from './routes/cafe';
import castingApplicationRoutes from './routes/castingApplications';
import chatRoutes from './routes/chat';
import castingRoutes from './routes/castings';
import courseRoutes from './routes/courses';
import dashboardRoutes from './routes/dashboard';
import fileRoutes from './routes/files';
import leadRoutes from './routes/leads';
import notificationRoutes from './routes/notifications';
import opportunityRoutes from './routes/opportunities';
import positionRoutes from './routes/positions';
import pushRoutes from './routes/push';
import { castingFileRoutes, courseFileRoutes } from './routes/recordFiles';
import scheduleRoutes from './routes/schedule';
import sessionRoutes from './routes/sessions';
import siteRoutes from './routes/site';
import publicSite from './site';
import settingsRoutes from './routes/settings';
import staffRoutes from './routes/staff';
import studentRoutes from './routes/students';
import submissionRoutes from './routes/submissions';
import summonsRoutes from './routes/summons';
import talentRoutes from './routes/talent';
import teamRoutes from './routes/team';
import videoRoutes from './routes/videos';

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
  /**
   * Keeps background work going after the response (push notifications,
   * lib/push): the Durable Object's ctx.waitUntil on Cloudflare. Omitted (Node,
   * scripts): the task just runs on — fire and forget, errors logged.
   */
  waitUntil?: (task: Promise<unknown>) => void;
  /** fetch for calls to other servers (the browsers' push services). Default: the runtime's fetch. Tests pass a fake. */
  outboundFetch?: typeof fetch;
  /**
   * Taking the database back in time, for the operator endpoints (lib/restorePoint.ts): the Durable
   * Object's point-in-time recovery on Cloudflare, a copy of the database file on Node. Omitted
   * (tests): a real clear-demo run records nothing, and the restore endpoints answer 501.
   */
  restore?: RestoreDeps;
}

/** Fire and forget: the promise runs on; a failure is logged, never unhandled. */
const runInBackground = (task: Promise<unknown>) => {
  task.catch((err) => console.error('Background task failed', err));
};

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
    c.set('waitUntil', deps.waitUntil ?? runInBackground);
    c.set('outboundFetch', deps.outboundFetch ?? ((input, init) => fetch(input, init)));
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
  app.use('/api/admin/*', adminRoutes({ request: (path, init) => app.request(path, init), restore: deps.restore }));
  app.use('/api/*', requireAjaxHeader);
  app.use('/api/*', loadSession);

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes);
  // The first-password gate: someone still on a password that somebody else set gets 403
  // `password_change_required` from every route below this line until they choose their own.
  // Only /api/auth (above) is in front of it — a new router goes below, never above.
  app.use('/api/*', requireOwnPassword);
  app.route('/api/files', fileRoutes);
  app.route('/api/staff', staffRoutes);
  app.route('/api/positions', positionRoutes);
  app.route('/api/settings', settingsRoutes);
  app.route('/api/students', studentRoutes);
  // A workshop's and a casting's photos & files (before the parent routers; routes/recordFiles.ts).
  app.route('/api/courses/:courseId/files', courseFileRoutes);
  app.route('/api/castings/:castingId/files', castingFileRoutes);
  app.route('/api/courses', courseRoutes);
  app.route('/api/sessions', sessionRoutes);
  app.route('/api/talent', talentRoutes);
  app.route('/api/castings', castingRoutes);
  app.route('/api/submissions', submissionRoutes);
  // Casting opportunities the team saw elsewhere and added by hand (Part K1).
  app.route('/api/opportunities', opportunityRoutes);
  app.route('/api/leads', leadRoutes);
  app.route('/api/schedule', scheduleRoutes);
  app.route('/api/dashboard', dashboardRoutes);
  app.route('/api/site', siteRoutes);
  app.route('/api/casting-applications', castingApplicationRoutes);
  // The team pack: directory, chat, call to the office, notifications, push.
  app.route('/api/team', teamRoutes);
  app.route('/api/chat', chatRoutes);
  app.route('/api/summons', summonsRoutes);
  app.route('/api/notifications', notificationRoutes);
  app.route('/api/push', pushRoutes);
  // The cafeteria: the menu, ordering, the orders board (Part J).
  app.route('/api/cafe', cafeRoutes);
  // The video pipeline: coach → editor → reviewer (Part L).
  app.route('/api/videos', videoRoutes);

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'No such API route' } }, 404));

  // The public website (server-rendered HTML, no session): src/server/site/. Its own headers,
  // body caps, rate limits and friendly error pages; on a public host the Worker / Node server
  // map the root to /site first (site/publicHost.ts).
  app.route('/site', publicSite);

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
