import { and, asc, count, desc, eq, gt, gte, inArray, max, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { LOCALES, OPEN_CAFE_ORDER_STATUSES, isOpenCafeOrder, nextCafeStep, type CafeOrderStatus } from '../../shared/enums';
import {
  CAFE_BOARD_DONE_LIMIT,
  CAFE_ERROR_CODES,
  CAFE_MY_ORDERS_PAGE,
  CAFE_ORDERS_PER_HOUR,
  MAX_CAFE_ITEMS,
  USUAL_CAFE_ITEMS,
  cafeItemInput,
  cafeItemUpdateInput,
  cafeMenuOrderInput,
  cafeOrderInput,
  cafeOrdersQuery,
  cafePlacesInput,
  cafeStatusInput,
  storedCafePlace,
  storedCafeReason,
  type CafeItem,
  type CafeMenu,
  type CafeOrder,
  type CafePlace,
} from '../../shared/schemas/cafe';
import type { ListResponse } from '../../shared/schemas/common';
import type { PushPayload } from '../../shared/schemas/notifications';
import type { DB } from '../db/database';
import { cafeItems, cafeOrderItems, cafeOrders } from '../db/schema';
import type { AppEnv } from '../env';
import {
  cafeBoardLink,
  cafeCancelledAlert,
  cafeOrderBody,
  cafeOrderLines,
  cafeOrderLink,
  cafeServers,
  cafeSettings,
  lastCafePlace,
  loadCafeMenu,
  queueCafeOrderGone,
  toCafeItem,
  toCafeOrder,
  toCafeOrders,
} from '../lib/cafe';
import { epochAt, schoolToday } from '../lib/clock';
import { ApiError, fieldError, notFound } from '../lib/errors';
import { localeOf, markNotificationsReadForEveryone, notificationText, notify } from '../lib/notifications';
import { queuePush } from '../lib/push';
import { HOUR_MS } from '../lib/rateLimit';
import { saveSettings } from '../lib/settings';
import { insertBatches } from '../lib/sqlLimits';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';

/**
 * The cafeteria (Part J). Ordering needs no permission: every signed-in team
 * member reads the menu, sends orders, sees their own and cancels one while it
 * is still new. Whoever holds cafeteria.serve (the Office helper; owners) has
 * the orders board and moves each order along — new → on_the_way → delivered,
 * one step at a time — or turns it down with a reason; nothing changes after
 * delivered or cancelled. The menu and the places are edited by
 * cafeteria.serve or settings.manage (the Executive Director).
 *
 * Privacy: an order is seen by the person who ordered and by whoever serves —
 * nobody else (someone else's order id answers 404).
 *
 * A new order alerts everyone active who serves; each step alerts the person
 * who ordered (in-app, and by push after the transaction). At most 10 orders
 * an hour per person, 10 lines an order. With the `cafeteriaEnabled` setting
 * off every route here answers 409 cafeteria_off.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);
router.use(async (c, next) => {
  if (!cafeSettings(c.get('db')).enabled) throw new ApiError(409, CAFE_ERROR_CODES.cafeteriaOff, 'The cafeteria is switched off');
  await next();
});

const canServe = requirePermission('cafeteria.serve');
const canEditMenu = requireAnyPermission('cafeteria.serve', 'settings.manage');

type OrderRow = typeof cafeOrders.$inferSelect;
type Reader = Pick<DB, 'select'>;

const findOrder = (db: Reader, id: number) => db.select().from(cafeOrders).where(eq(cafeOrders.id, id)).get();

/** 409 for a change the order's state doesn't allow, with the order as it is now. */
function stateError(db: Reader, row: OrderRow, me: number, tried: CafeOrderStatus | 'own_cancel'): ApiError {
  const details = { order: toCafeOrder(db, row, me) };
  if (!isOpenCafeOrder(row.status)) return new ApiError(409, CAFE_ERROR_CODES.orderClosed, 'This order is already delivered or cancelled', undefined, details);
  if (tried === 'own_cancel') return new ApiError(409, CAFE_ERROR_CODES.alreadyOnTheWay, 'This order is already on the way', undefined, details);
  return new ApiError(409, CAFE_ERROR_CODES.notNextStep, 'That is not this order’s next step', undefined, details);
}

// ── The menu ────────────────────────────────────────────────────────────────

/** The menu (unavailable items included), the places, and where my last order went. */
router.get('/menu', (c) => {
  const db = c.get('db');
  const res: CafeMenu = { items: loadCafeMenu(db), places: cafeSettings(db).places, lastPlace: lastCafePlace(db, currentUser(c).id) };
  return c.json(res);
});

router.post('/menu', canEditMenu, async (c) => {
  const input = await body(c, cafeItemInput);
  const db = c.get('db');
  const created = db.transaction((tx) => {
    const n = tx.select({ n: count() }).from(cafeItems).get()?.n ?? 0;
    if (n >= MAX_CAFE_ITEMS) return null;
    const last = tx.select({ n: max(cafeItems.sortOrder) }).from(cafeItems).get()?.n;
    return tx
      .insert(cafeItems)
      .values({
        // One name is enough: the other language shows the same text until someone adds it.
        nameEn: (input.nameEn ?? input.nameAr)!,
        nameAr: (input.nameAr ?? input.nameEn)!,
        category: input.category,
        available: input.available ?? true,
        sortOrder: last == null ? 0 : last + 1,
      })
      .returning()
      .get();
  });
  if (!created) throw new ApiError(409, CAFE_ERROR_CODES.menuFull, 'The menu is full');
  return c.json<CafeItem>(toCafeItem(created), 201);
});

/** "Add the usual items": tea, coffee, water… on a menu that has nothing yet. */
router.post('/menu/defaults', canEditMenu, (c) => {
  const db = c.get('db');
  const added = db.transaction((tx) => {
    if ((tx.select({ n: count() }).from(cafeItems).get()?.n ?? 0) > 0) return false;
    const rows = USUAL_CAFE_ITEMS.map((item, i) => ({ ...item, available: true, sortOrder: i }));
    for (const batch of insertBatches(cafeItems, rows)) tx.insert(cafeItems).values(batch).run();
    return true;
  });
  if (!added) throw new ApiError(409, CAFE_ERROR_CODES.menuNotEmpty, 'The menu already has items');
  return c.json<ListResponse<CafeItem>>({ items: loadCafeMenu(db) }, 201);
});

/** Up / down: item ids in the new order; items not named keep their order after them. */
router.post('/menu/order', canEditMenu, async (c) => {
  const { ids } = await body(c, cafeMenuOrderInput);
  const db = c.get('db');
  db.transaction((tx) => {
    const all = tx.select({ id: cafeItems.id }).from(cafeItems).orderBy(asc(cafeItems.sortOrder), asc(cafeItems.id)).all().map((r) => r.id);
    const known = new Set(all);
    if (ids.some((x) => !known.has(x))) throw fieldError(['ids'], 'errors.notFound');
    const order = [...ids, ...all.filter((x) => !ids.includes(x))];
    order.forEach((itemId, i) => tx.update(cafeItems).set({ sortOrder: i }).where(eq(cafeItems.id, itemId)).run());
  });
  return c.json<ListResponse<CafeItem>>({ items: loadCafeMenu(db) });
});

router.patch('/menu/:id', canEditMenu, async (c) => {
  const id = paramId(c);
  const input = await body(c, cafeItemUpdateInput);
  const db = c.get('db');
  const updated = db.transaction((tx) => {
    const current = tx.select().from(cafeItems).where(eq(cafeItems.id, id)).get();
    if (!current) return null;
    const patch: Partial<typeof cafeItems.$inferInsert> = {};
    if (input.nameEn !== undefined || input.nameAr !== undefined) {
      // A name sent blank takes the other language's text; one not sent stays as stored.
      const en = input.nameEn === undefined ? current.nameEn : input.nameEn;
      const ar = input.nameAr === undefined ? current.nameAr : input.nameAr;
      if (!en && !ar) throw fieldError(['nameEn'], 'errors.required');
      patch.nameEn = (en ?? ar)!;
      patch.nameAr = (ar ?? en)!;
    }
    if (input.available !== undefined) patch.available = input.available;
    if (input.category !== undefined && input.category !== current.category) {
      // Moved to another group: it goes last there.
      const last = tx.select({ n: max(cafeItems.sortOrder) }).from(cafeItems).get()?.n;
      patch.category = input.category;
      patch.sortOrder = last == null ? 0 : last + 1;
    }
    if (!Object.keys(patch).length) return current;
    return tx.update(cafeItems).set(patch).where(eq(cafeItems.id, id)).returning().get() ?? null;
  });
  if (!updated) throw notFound('Menu item not found');
  return c.json<CafeItem>(toCafeItem(updated));
});

/** Off the menu for good. Orders that had it keep its name (cafe_order_items.name_en / name_ar). */
router.delete('/menu/:id', canEditMenu, (c) => {
  const id = paramId(c);
  const gone = c.get('db').delete(cafeItems).where(eq(cafeItems.id, id)).returning({ id: cafeItems.id }).get();
  if (!gone) throw notFound('Menu item not found');
  return c.body(null, 204);
});

/** The places an order can come to: the whole list, in order (stored as the `cafePlaces` setting). */
router.put('/places', canEditMenu, async (c) => {
  const { places } = await body(c, cafePlacesInput);
  const saved = saveSettings(c.get('db'), { cafePlaces: places });
  return c.json<{ places: CafePlace[] }>({ places: saved.cafePlaces });
});

// ── Ordering (everyone) ─────────────────────────────────────────────────────

router.post('/orders', async (c) => {
  const input = await body(c, cafeOrderInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const { places } = cafeSettings(db);

  const { order, lines, servers } = db.transaction((tx) => {
    const lastHour =
      tx
        .select({ n: count() })
        .from(cafeOrders)
        .where(and(eq(cafeOrders.userId, me.id), gt(cafeOrders.createdAt, now - HOUR_MS)))
        .get()?.n ?? 0;
    if (lastHour >= CAFE_ORDERS_PER_HOUR) throw new ApiError(429, CAFE_ERROR_CODES.tooManyOrders, 'Too many orders this hour');

    // At most 10 lines, so at most 10 ids: a fixed-size IN list.
    const ids = [...new Set(input.items.map((l) => l.itemId))];
    const menu = new Map(
      tx
        .select()
        .from(cafeItems)
        .where(inArray(cafeItems.id, ids))
        .all()
        .map((item) => [item.id, item]),
    );
    const unavailable = ids.filter((itemId) => !menu.get(itemId)?.available);
    if (unavailable.length) {
      throw new ApiError(409, CAFE_ERROR_CODES.itemUnavailable, 'Something on this order is not available now', undefined, { itemIds: unavailable });
    }

    const row = tx
      .insert(cafeOrders)
      .values({ userId: me.id, place: storedCafePlace(input.place, places), note: input.note ?? null, status: 'new', createdAt: now })
      .returning()
      .get();
    // The names are copied: renaming or deleting the menu item later doesn't change this order.
    const rows = input.items.map((l) => {
      const item = menu.get(l.itemId)!;
      return { orderId: row.id, itemId: item.id, nameEn: item.nameEn, nameAr: item.nameAr, qty: l.qty, options: l.options ?? null };
    });
    for (const batch of insertBatches(cafeOrderItems, rows)) tx.insert(cafeOrderItems).values(batch).run();

    // Everyone active who serves — not the person ordering, if they serve too: it is already on their board.
    const toAlert = cafeServers(tx, me.id);
    for (const s of toAlert) {
      notify(
        tx,
        {
          userId: s.id,
          kind: 'cafe_order',
          title: notificationText(s.locale, 'cafeNewOrderTitle', { name: me.name }),
          body: cafeOrderBody(s.locale, rows, row.place, places),
          link: cafeBoardLink(row.id),
        },
        now,
      );
    }
    return { order: row, lines: rows, servers: toAlert };
  });

  // Push after the transaction, one message per language (the text is written for its reader).
  for (const locale of LOCALES) {
    const ids = servers.filter((s) => s.locale === locale).map((s) => s.id);
    queuePush(
      c,
      ids,
      {
        title: notificationText(locale, 'cafeNewOrderTitle', { name: me.name }),
        body: cafeOrderBody(locale, lines, order.place, places),
        link: cafeBoardLink(order.id),
        kind: 'cafe_order',
        tag: `cafe-order-${order.id}`,
      },
      { ttl: 60 * 60, urgency: 'high', topic: `cafe-order-${order.id}` },
    );
  }
  return c.json<CafeOrder>(toCafeOrder(db, order, me.id), 201);
});

/** My own orders, newest first (the newest 20). */
router.get('/orders/mine', (c) => {
  const db = c.get('db');
  const me = currentUser(c).id;
  const rows = db.select().from(cafeOrders).where(eq(cafeOrders.userId, me)).orderBy(desc(cafeOrders.id)).limit(CAFE_MY_ORDERS_PAGE).all();
  return c.json<ListResponse<CafeOrder>>({ items: toCafeOrders(db, rows, me) });
});

/** The person who ordered takes it back, while nobody has taken it yet. 404 for anyone else's order; 409 once it's on the way or finished. */
router.post('/orders/:id/cancel', (c) => {
  const id = paramId(c);
  const me = currentUser(c).id;
  const db = c.get('db');
  const now = Date.now();
  const row = findOrder(db, id);
  if (!row || row.userId !== me) throw notFound('Order not found');
  if (row.status !== 'new') throw stateError(db, row, me, 'own_cancel');
  const updated = db.transaction((tx) => {
    const done = tx
      .update(cafeOrders)
      .set({ status: 'cancelled', cancelledAt: now })
      .where(and(eq(cafeOrders.id, id), eq(cafeOrders.status, 'new')))
      .returning()
      .get();
    // Whoever serves no longer needs it in their bell.
    if (done) markNotificationsReadForEveryone(tx, 'cafe_order', cafeBoardLink(id), now);
    return done ?? null;
  });
  if (!updated) throw stateError(db, findOrder(db, id)!, me, 'own_cancel');
  // The servers' phones still show "New order from …": replace it, quietly.
  queueCafeOrderGone(c, [{ order: updated, by: currentUser(c).name, outcome: 'cancelled' }]);
  return c.json<CafeOrder>(toCafeOrder(db, updated, me));
});

// ── The orders board (cafeteria.serve) ──────────────────────────────────────

/**
 * The board: every order still open (new first, then on the way; oldest
 * first — first come, first served), then today's delivered and cancelled
 * ones, newest first ("today" is the school's day). `?status=` keeps one status.
 */
router.get('/orders', canServe, (c) => {
  const { status } = query(c, cafeOrdersQuery);
  const db = c.get('db');
  const me = currentUser(c).id;
  const dayStart = epochAt(c.get('config').timeZone, schoolToday(c));
  const wantOpen = !status || isOpenCafeOrder(status);
  const wantDone = !status || !isOpenCafeOrder(status);
  const open = wantOpen
    ? db
        .select()
        .from(cafeOrders)
        .where(inArray(cafeOrders.status, status ? [status] : [...OPEN_CAFE_ORDER_STATUSES]))
        .orderBy(asc(cafeOrders.status), asc(cafeOrders.createdAt), asc(cafeOrders.id))
        .limit(200)
        .all()
    : [];
  const delivered = and(eq(cafeOrders.status, 'delivered'), gte(cafeOrders.deliveredAt, dayStart));
  const cancelled = and(eq(cafeOrders.status, 'cancelled'), gte(cafeOrders.cancelledAt, dayStart));
  const done = wantDone
    ? db
        .select()
        .from(cafeOrders)
        .where(status === 'delivered' ? delivered : status === 'cancelled' ? cancelled : or(delivered, cancelled))
        .orderBy(sql`coalesce(${cafeOrders.deliveredAt}, ${cafeOrders.cancelledAt}) desc`, desc(cafeOrders.id))
        .limit(CAFE_BOARD_DONE_LIMIT)
        .all()
    : [];
  return c.json<ListResponse<CafeOrder>>({ items: toCafeOrders(db, [...open, ...done], me) });
});

/**
 * Move an order along — on_the_way, then delivered — or turn it down
 * (cancelled, with a reason the person who ordered reads). 409 for anything
 * else: a step skipped or repeated, an order already delivered or cancelled.
 */
router.post('/orders/:id/status', canServe, async (c) => {
  const id = paramId(c);
  const input = await body(c, cafeStatusInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const row = findOrder(db, id);
  if (!row) throw notFound('Order not found');
  if (!isOpenCafeOrder(row.status) || (input.status !== 'cancelled' && nextCafeStep(row.status) !== input.status)) throw stateError(db, row, me.id, input.status);

  // A ready-made reason is kept by its English words, so each reader sees it in their own language.
  const reason = input.status === 'cancelled' ? storedCafeReason(input.reason ?? '') : null;
  // What the person who ordered is told, in their language (nothing when they moved their own order).
  const { places } = cafeSettings(db);
  const locale = localeOf(db, row.userId);
  const alert: PushPayload | null =
    row.userId === me.id
      ? null
      : reason !== null
        ? cafeCancelledAlert(locale, id, reason)
        : {
            title: notificationText(locale, input.status === 'on_the_way' ? 'cafeOnTheWayTitle' : 'cafeDeliveredTitle'),
            body: cafeOrderBody(locale, cafeOrderLines(db, id), row.place, places),
            link: cafeOrderLink(id),
            kind: 'cafe_status',
            tag: `cafe-${id}`,
          };

  const updated = db.transaction((tx) => {
    const done = tx
      .update(cafeOrders)
      .set(
        input.status === 'on_the_way'
          ? { status: 'on_the_way', onTheWayAt: now, handledById: me.id }
          : input.status === 'delivered'
            ? { status: 'delivered', deliveredAt: now, handledById: me.id }
            : { status: 'cancelled', cancelledAt: now, cancelReason: reason, handledById: me.id },
      )
      // Only from the status it was read in: two people tapping the same card can't both move it.
      .where(and(eq(cafeOrders.id, id), eq(cafeOrders.status, row.status)))
      .returning()
      .get();
    if (!done) return null;
    // It has been taken (or turned down): the "new order" alert is done with, for everyone who serves.
    if (row.status === 'new') markNotificationsReadForEveryone(tx, 'cafe_order', cafeBoardLink(id), now);
    // One alert per order for the person who ordered, updated at each step and moved to the top.
    if (alert) notify(tx, { userId: row.userId, kind: 'cafe_status', title: alert.title, body: alert.body, link: alert.link }, now, { replace: true });
    return done;
  });
  if (!updated) throw stateError(db, findOrder(db, id)!, me.id, input.status);

  if (alert) {
    // "On the way" and "can't be made" are worth waking the phone for; "delivered" is in the person's hands already.
    const opts = input.status === 'delivered' ? ({ ttl: 10 * 60, urgency: 'normal' } as const) : ({ ttl: 60 * 60, urgency: 'high' } as const);
    queuePush(c, [row.userId], alert, { ...opts, topic: `cafe-${id}` });
  }
  // It no longer waits: "New order from …" on the servers' phones is replaced, quietly.
  if (row.status === 'new') {
    const by = toCafeOrder(db, updated, me.id).by.name;
    queueCafeOrderGone(c, [{ order: updated, by, outcome: input.status === 'cancelled' ? 'cancelled' : 'on_the_way' }]);
  }
  return c.json<CafeOrder>(toCafeOrder(db, updated, me.id));
});

export default router;
