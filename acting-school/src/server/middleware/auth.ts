import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { can, type Permission } from '../../shared/roles';
import type { SessionUser } from '../../shared/schemas/auth';
import { authSessions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/errors';
import { newToken, sha256 } from '../lib/password';

export const SESSION_COOKIE = 'as_session';
const DAY = 24 * 60 * 60 * 1000;

/** Loads the signed-in user (if any) from the session cookie. Never rejects. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null);
  c.set('sessionId', null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const db = c.get('db');
    const id = sha256(token);
    const now = Date.now();
    const row = db
      .select({
        expiresAt: authSessions.expiresAt,
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        phone: users.phone,
        locale: users.locale,
        active: users.active,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now)))
      .get();
    if (row && row.active) {
      const { expiresAt, active: _active, ...user } = row;
      c.set('user', user);
      c.set('sessionId', id);
      // Sliding expiry: renew when less than half the lifetime is left.
      const lifetime = c.get('config').sessionDays * DAY;
      if (expiresAt - now < lifetime / 2) {
        const newExpiry = now + lifetime;
        db.update(authSessions).set({ expiresAt: newExpiry }).where(eq(authSessions.id, id)).run();
        writeCookie(c, token, newExpiry);
      }
    }
  }
  await next();
};

/**
 * Cross-site request guard. Every state-changing request must carry the
 * X-Requested-With header, which a browser won't add cross-origin without a
 * CORS preflight this API never grants. The web client always sends it.
 */
export const requireAjaxHeader: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !c.req.header('x-requested-with')) {
    throw new ApiError(403, 'forbidden', 'Missing X-Requested-With header');
  }
  await next();
};

/** 401 unless signed in. Use on every non-public router: `router.use(requireAuth)`. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) throw new ApiError(401, 'unauthorized', 'Please sign in');
  await next();
};

/** 401 if signed out, 403 if the role lacks the permission. */
export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) throw new ApiError(401, 'unauthorized', 'Please sign in');
    if (!can(user.role, permission)) throw new ApiError(403, 'forbidden', 'You do not have access to this');
    await next();
  };
}

/** The signed-in user; only call behind requireAuth / requirePermission. */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user');
  if (!user) throw new ApiError(401, 'unauthorized', 'Please sign in');
  return user;
}

/** Inline permission check inside a handler (e.g. to include optional data). */
export function userCan(c: Context<AppEnv>, permission: Permission): boolean {
  return can(c.get('user')?.role, permission);
}

function writeCookie(c: Context<AppEnv>, token: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.get('config').cookieSecure,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(expiresAt),
  });
}

/** Create a session row + cookie for this user. */
export function startSession(c: Context<AppEnv>, userId: number) {
  const token = newToken();
  const expiresAt = Date.now() + c.get('config').sessionDays * DAY;
  c.get('db').insert(authSessions).values({ id: sha256(token), userId, expiresAt }).run();
  writeCookie(c, token, expiresAt);
}

export function endSession(c: Context<AppEnv>) {
  const id = c.get('sessionId');
  if (id) c.get('db').delete(authSessions).where(eq(authSessions.id, id)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: c.get('config').cookieSecure });
}
