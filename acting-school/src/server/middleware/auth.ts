import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Permission } from '../../shared/permissions';
import type { SessionUser } from '../../shared/schemas/auth';
import type { DB } from '../db/database';
import { authSessions, positions, pushSubscriptions, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { accessFrom, hasPermission, positionOrder } from '../lib/access';
import { ApiError } from '../lib/errors';
import { newToken, sha256 } from '../lib/password';

export const SESSION_COOKIE = 'as_session';
const DAY = 24 * 60 * 60 * 1000;

/**
 * The session cookie's name. Over HTTPS (cookieSecure — always on Cloudflare)
 * it carries the __Host- prefix: the browser then only accepts it from this
 * exact host, Secure, Path=/ and without a Domain, so a page on a sibling
 * subdomain (another Worker on the same workers.dev account subdomain) can't
 * plant or overwrite it. Plain http (local development) can't use the prefix.
 */
export function sessionCookieName(config: { cookieSecure: boolean }): string {
  return config.cookieSecure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/**
 * Loads the signed-in user (if any) from the session cookie. Never rejects.
 * Positions and permissions are read fresh on every request (one joined query),
 * so a change to someone's positions applies on their next request.
 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null);
  c.set('sessionId', null);
  const token = getCookie(c, sessionCookieName(c.get('config')));
  if (token) {
    const db = c.get('db');
    const id = sha256(token);
    const now = Date.now();
    // One row per position held (or a single row with null position columns).
    const rows = db
      .select({
        expiresAt: authSessions.expiresAt,
        id: users.id,
        email: users.email,
        name: users.name,
        phone: users.phone,
        locale: users.locale,
        photoFileId: users.photoFileId,
        active: users.active,
        positionId: positions.id,
        positionKey: positions.key,
        positionName: positions.name,
        positionNameAr: positions.nameAr,
        positionIsOwner: positions.isOwner,
        positionPermissions: positions.permissions,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .leftJoin(userPositions, eq(userPositions.userId, users.id))
      .leftJoin(positions, eq(positions.id, userPositions.positionId))
      .where(and(eq(authSessions.id, id), gt(authSessions.expiresAt, now)))
      .orderBy(...positionOrder)
      .all();
    const row = rows[0];
    if (row && row.active) {
      const held = rows.flatMap((r) =>
        r.positionId === null
          ? []
          : [{ id: r.positionId, key: r.positionKey, name: r.positionName!, nameAr: r.positionNameAr, isOwner: !!r.positionIsOwner, permissions: r.positionPermissions ?? [] }],
      );
      const user: SessionUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        phone: row.phone,
        locale: row.locale,
        photoFileId: row.photoFileId,
        ...accessFrom(held),
      };
      c.set('user', user);
      c.set('sessionId', id);
      // Sliding expiry: renew when less than half the lifetime is left.
      const lifetime = c.get('config').sessionDays * DAY;
      if (row.expiresAt - now < lifetime / 2) {
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

/** 401 if signed out, 403 unless the person's positions allow the permission. */
export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return requireAnyPermission(permission);
}

/** 401 if signed out, 403 unless the person's positions allow at least one of these permissions. */
export function requireAnyPermission(...permissions: Permission[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) throw new ApiError(401, 'unauthorized', 'Please sign in');
    if (!permissions.some((p) => hasPermission(user, p))) throw new ApiError(403, 'forbidden', 'You do not have access to this');
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
  return hasPermission(c.get('user'), permission);
}

function writeCookie(c: Context<AppEnv>, token: string, expiresAt: number) {
  setCookie(c, sessionCookieName(c.get('config')), token, {
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

/**
 * Sign out this request's session: its row, the push subscriptions it turned
 * on (so this phone/browser stops getting the person's notifications), and
 * the cookie.
 */
export function endSession(c: Context<AppEnv>) {
  const id = c.get('sessionId');
  if (id) c.get('db').transaction((tx) => deleteSession(tx, id));
  deleteCookie(c, sessionCookieName(c.get('config')), { path: '/', secure: c.get('config').cookieSecure });
}

type Deleter = Pick<DB, 'delete'>;

/** Delete one session and the push subscriptions it turned on. Call inside a transaction. */
export function deleteSession(tx: Deleter, sessionId: string) {
  tx.delete(pushSubscriptions).where(eq(pushSubscriptions.sessionId, sessionId)).run();
  tx.delete(authSessions).where(eq(authSessions.id, sessionId)).run();
}

/**
 * Sign a person out everywhere — every session but `keepSessionId` (resetting
 * your own password keeps this device signed in) — together with every push
 * subscription not turned on by the kept session: a lost phone stops getting
 * message previews and calls to the office. Call inside a transaction.
 */
export function signOutUser(tx: Deleter, userId: number, keepSessionId?: string | null) {
  const keepPush = keepSessionId ? or(isNull(pushSubscriptions.sessionId), ne(pushSubscriptions.sessionId, keepSessionId)) : undefined;
  tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), keepPush)).run();
  const keepSession = keepSessionId ? ne(authSessions.id, keepSessionId) : undefined;
  tx.delete(authSessions).where(and(eq(authSessions.userId, userId), keepSession)).run();
}
