import { and, asc, count, eq, gt, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  PUSH_ERROR_CODES,
  pushSubscribeInput,
  type PushConfig,
  type PushSubscribeResponse,
  type PushTestResponse,
} from '../../shared/schemas/notifications';
import type { DB } from '../db/database';
import { authSessions, pushSubscriptions } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/errors';
import { localeOf, notificationText } from '../lib/notifications';
import { isPushServiceEndpoint, queuePush } from '../lib/push';
import { b64urlDecode, isUncompressedP256 } from '../lib/push/keys';
import { hitRateLimit, HOUR_MS } from '../lib/rateLimit';
import { body } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';

/**
 * Web Push subscriptions (G5): Profile's "Turn on notifications on this phone"
 * sends the browser's subscription here. Only https addresses of the
 * browsers' real push services are accepted (the server POSTs to them), with
 * a valid P-256 key and 16-byte auth secret. One person keeps at most
 * MAX_DEVICES subscriptions (the oldest go). A subscription belongs to the
 * sign-in session that sent it: signing out (or being signed out everywhere)
 * deletes it (middleware/auth.ts endSession / signOutUser), and push only goes
 * to subscriptions whose session is still valid. Without VAPID keys on the server,
 * push is off: GET /config says so (publicKey null) and subscribing is a 409.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

export const MAX_DEVICES = 10;

/** My subscriptions that push still goes to (their sign-in session is valid). */
const deviceCount = (db: Pick<DB, 'select'>, userId: number) =>
  db
    .select({ n: count() })
    .from(pushSubscriptions)
    .innerJoin(authSessions, eq(authSessions.id, pushSubscriptions.sessionId))
    .where(and(eq(pushSubscriptions.userId, userId), eq(authSessions.userId, userId), gt(authSessions.expiresAt, Date.now())))
    .get()?.n ?? 0;

const pushOff = () => new ApiError(409, PUSH_ERROR_CODES.pushOff, 'Notifications to phones are not set up on this server');

/**
 * GET /api/push/config?endpoint=<this browser's subscription endpoint>: the
 * key to subscribe with, my device count, and whether this browser's
 * subscription is mine and turned on in this sign-in (thisDevice). The
 * browser alone can't tell: on a shared computer its subscription may have
 * been someone else's, and signing out stops a subscription on the server.
 */
router.get('/config', (c) => {
  const db = c.get('db');
  const me = currentUser(c).id;
  const endpoint = c.req.query('endpoint');
  const sessionId = c.get('sessionId');
  const mine =
    endpoint && sessionId
      ? db
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, me), eq(pushSubscriptions.sessionId, sessionId)))
          .get()
      : undefined;
  const res: PushConfig = { publicKey: c.get('config').vapid?.publicKey ?? null, devices: deviceCount(db, me), thisDevice: !!mine };
  return c.json(res);
});

router.post('/subscribe', async (c) => {
  const input = await body(c, pushSubscribeInput);
  if (!c.get('config').vapid) throw pushOff();
  const p256dh = b64urlDecode(input.keys.p256dh);
  const auth = b64urlDecode(input.keys.auth);
  if (!isPushServiceEndpoint(input.endpoint) || !isUncompressedP256(p256dh) || auth?.length !== 16) {
    throw new ApiError(400, PUSH_ERROR_CODES.invalidSubscription, 'That isn’t a push subscription this server can use');
  }
  const me = currentUser(c).id;
  const sessionId = c.get('sessionId');
  const db = c.get('db');
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 120) || null;
  db.transaction((tx) => {
    // The same browser signed in as someone else (or in an earlier sign-in) before: it's now this person's, in this sign-in.
    tx.insert(pushSubscriptions)
      .values({ userId: me, sessionId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent, createdAt: Date.now() })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: me, sessionId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent, failures: 0, lastSuccessAt: null, createdAt: Date.now() },
      })
      .run();
    const mine = tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, me))
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id))
      .all();
    const extra = mine.slice(0, Math.max(0, mine.length - MAX_DEVICES)).map((r) => r.id);
    if (extra.length) tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra)).run();
  });
  const res: PushSubscribeResponse = { devices: deviceCount(db, me) };
  return c.json(res, 201);
});

/** DELETE /api/push/subscribe?endpoint=<the subscription's endpoint>: this browser stops receiving push. Always 204. */
router.delete('/subscribe', (c) => {
  const endpoint = c.req.query('endpoint');
  if (endpoint) {
    c.get('db')
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, currentUser(c).id)))
      .run();
  }
  return c.body(null, 204);
});

/** A test notification to all my devices, so people can see it works. At most 5 an hour. 202 { devices }. */
router.post('/test', (c) => {
  if (!c.get('config').vapid) throw pushOff();
  const me = currentUser(c).id;
  const db = c.get('db');
  if (hitRateLimit(db, `push-test:user:${me}`, 5, HOUR_MS, Date.now())) {
    throw new ApiError(429, PUSH_ERROR_CODES.tooManyTests, 'Too many test notifications. Try again later.');
  }
  const locale = localeOf(db, me);
  queuePush(c, [me], { title: notificationText(locale, 'testTitle'), body: notificationText(locale, 'testBody'), link: '/profile', kind: 'test', tag: 'test' }, { ttl: 60 * 60, urgency: 'normal' });
  const res: PushTestResponse = { devices: deviceCount(db, me) };
  return c.json(res, 202);
});

export default router;
