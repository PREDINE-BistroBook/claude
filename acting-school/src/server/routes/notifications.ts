import { and, desc, eq, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { NOTIFICATIONS_PAGE, notificationsReadInput, type NotificationsReadResponse, type NotificationsResponse } from '../../shared/schemas/notifications';
import { notifications } from '../db/schema';
import type { AppEnv } from '../env';
import { hiddenNotificationKinds } from '../lib/cafe';
import { markRead, toNotificationItem, unreadNotificationCount } from '../lib/notifications';
import { body } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';

/**
 * The in-app notification bar (G5), for every signed-in worker: my newest
 * notifications and marking them read. Written by chat and summons
 * (lib/notifications.ts); each person only ever sees their own.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

/** Mine, newest first — without the kinds I can't open now (new cafeteria orders once I no longer serve, or while the cafeteria is off). */
router.get('/', (c) => {
  const db = c.get('db');
  const user = currentUser(c);
  const me = user.id;
  const hidden = hiddenNotificationKinds(db, user);
  const rows = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, me), hidden.length ? notInArray(notifications.kind, hidden) : undefined))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATIONS_PAGE)
    .all();
  const now = Date.now();
  const res: NotificationsResponse = { items: rows.map((r) => toNotificationItem(r, now)), unread: unreadNotificationCount(db, me, now, hidden) };
  return c.json(res);
});

/** { ids } (mine only; others' are ignored) or { all: true }. Answers { unread }. */
router.post('/read', async (c) => {
  const input = await body(c, notificationsReadInput);
  const db = c.get('db');
  const user = currentUser(c);
  const me = user.id;
  const now = Date.now();
  db.transaction((tx) => markRead(tx, me, 'all' in input ? 'all' : input.ids, now));
  const res: NotificationsReadResponse = { unread: unreadNotificationCount(db, me, now, hiddenNotificationKinds(db, user)) };
  return c.json(res);
});

export default router;
