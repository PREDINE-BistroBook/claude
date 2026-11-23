/**
 * The cafeteria (Part J): the menu, orders as every endpoint answers them
 * (CafeOrder), who serves, and the counts the 20-second poll carries
 * (GET /api/chat/unread → `cafe`). The routes are in routes/cafe.ts.
 */
import type { Context } from 'hono';
import { and, asc, count, desc, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm';
import { CAFE_CATEGORIES, LOCALES, OPEN_CAFE_ORDER_STATUSES, type CafeOrderStatus, type Locale, type NotificationKind } from '../../shared/enums';
import {
  cafeLinesSummary,
  cafePlaceLabel,
  cafeReason,
  cafeReasonLabel,
  type CafeItem,
  type CafeOrder,
  type CafeOrderLine,
  type CafePlace,
  type CafeReasonKey,
  type CafeReport,
  type CafeReportLine,
  type CafeUnread,
} from '../../shared/schemas/cafe';
import type { PushPayload } from '../../shared/schemas/notifications';
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings';
import type { SessionUser } from '../../shared/schemas/auth';
import { servesFromBoard } from '../../shared/permissions';
import type { DB } from '../db/database';
import { cafeItems, cafeOrderItems, cafeOrders, settings, users } from '../db/schema';
import type { AppEnv } from '../env';
import { hasPermission, loadAccess, type Conn } from './access';
import { localeOf, markNotificationsReadForEveryone, notificationText, notify } from './notifications';
import { queuePush } from './push';
import { inChunks } from './sqlLimits';
import { loadPersons, missingPerson } from './team';

type Reader = Pick<DB, 'select'>;
type OrderRow = typeof cafeOrders.$inferSelect;

// ── Settings ────────────────────────────────────────────────────────────────

/** The two cafeteria settings (`cafeteriaEnabled`, `cafePlaces`), with their defaults. Works inside a transaction. */
export function cafeSettings(db: Reader): { enabled: boolean; places: CafePlace[] } {
  const rows = db
    .select()
    .from(settings)
    .where(inArray(settings.key, ['cafeteriaEnabled', 'cafePlaces']))
    .all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const enabled = stored.get('cafeteriaEnabled');
  const places = stored.get('cafePlaces');
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_SETTINGS.cafeteriaEnabled,
    places: Array.isArray(places) ? (places as CafePlace[]) : DEFAULT_SETTINGS.cafePlaces,
  };
}

// ── The menu ────────────────────────────────────────────────────────────────

export function toCafeItem(r: typeof cafeItems.$inferSelect): CafeItem {
  return { id: r.id, nameEn: r.nameEn, nameAr: r.nameAr, category: r.category, available: r.available, sortOrder: r.sortOrder };
}

/** Menu order everywhere: by category (hot, cold, food, other), then sort_order, then id. */
export function byMenuOrder(a: Pick<CafeItem, 'id' | 'category' | 'sortOrder'>, b: Pick<CafeItem, 'id' | 'category' | 'sortOrder'>): number {
  return CAFE_CATEGORIES.indexOf(a.category) - CAFE_CATEGORIES.indexOf(b.category) || a.sortOrder - b.sortOrder || a.id - b.id;
}

/** The whole menu, unavailable items included (at most MAX_CAFE_ITEMS rows: sorted here, not in SQL). */
export function loadCafeMenu(db: Reader): CafeItem[] {
  return db.select().from(cafeItems).all().map(toCafeItem).sort(byMenuOrder);
}

// ── Orders ──────────────────────────────────────────────────────────────────

/** The lines of these orders, by order id (in the order they were sent). */
function linesOf(db: Reader, orderIds: readonly number[]): Map<number, CafeOrderLine[]> {
  const rows = inChunks(orderIds, (part) => db.select().from(cafeOrderItems).where(inArray(cafeOrderItems.orderId, part)).orderBy(asc(cafeOrderItems.id)).all());
  const out = new Map<number, CafeOrderLine[]>();
  for (const { orderId, ...line } of rows) {
    const list = out.get(orderId) ?? [];
    list.push(line);
    out.set(orderId, list);
  }
  return out;
}

/** Rows → CafeOrder, with the lines and both people's name and photo (one query each for all of them). */
export function toCafeOrders(db: Reader, rows: readonly OrderRow[], me: number): CafeOrder[] {
  const lines = linesOf(
    db,
    rows.map((r) => r.id),
  );
  const people = loadPersons(
    db,
    rows.flatMap((r) => [r.userId, r.handledById]),
  );
  return rows.map((r) => ({
    id: r.id,
    by: people.get(r.userId) ?? missingPerson(r.userId),
    place: r.place,
    note: r.note,
    status: r.status,
    items: lines.get(r.id) ?? [],
    handledBy: r.handledById === null ? null : (people.get(r.handledById) ?? missingPerson(r.handledById)),
    cancelReason: r.cancelReason,
    createdAt: r.createdAt,
    onTheWayAt: r.onTheWayAt,
    deliveredAt: r.deliveredAt,
    cancelledAt: r.cancelledAt,
    mine: r.userId === me,
  }));
}

export function toCafeOrder(db: Reader, row: OrderRow, me: number): CafeOrder {
  return toCafeOrders(db, [row], me)[0]!;
}

/** Where this person's newest order went, to offer it again. */
export function lastCafePlace(db: Reader, userId: number): string | null {
  return db.select({ place: cafeOrders.place }).from(cafeOrders).where(eq(cafeOrders.userId, userId)).orderBy(desc(cafeOrders.id)).limit(1).get()?.place ?? null;
}

// ── Who serves ──────────────────────────────────────────────────────────────

/**
 * Who is alerted about new orders (the school's decision, 2026-11-23): every
 * active account that serves from the board — holds cafeteria.serve and opens
 * no School, Casting or Website section (servesFromBoard: the Office helper).
 * Owners and the Executive Director hold cafeteria.serve too, but work in the
 * sections: no order alerts or pushes for them. With the language their
 * alerts are written in. `exceptUserId` leaves one person out (whoever just ordered).
 */
export function cafeServers(db: Reader, exceptUserId?: number): { id: number; locale: Locale }[] {
  const active = db.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.active, true)).orderBy(asc(users.id)).all();
  const access = loadAccess(
    db,
    active.map((u) => u.id),
  );
  return active.filter((u) => u.id !== exceptUserId && servesFromBoard(access.get(u.id)?.permissions ?? []));
}

// ── The monthly consumption page ────────────────────────────────────────────

/**
 * Who had what in one month (GET /api/cafe/report, cafeteria.report):
 * delivered orders only, by the day they were delivered — [from, to) in epoch
 * ms, the month's bounds in the school's time zone. Counted in SQL (a handful
 * of bound parameters however many orders there are), one row per person and
 * item; an item still on the menu is counted under its id and current names
 * (renamed mid-month: one row), one deleted since under the names it had.
 */
export function cafeReport(db: Reader, month: string, currentMonth: string, from: number, to: number): CafeReport {
  const delivered = and(eq(cafeOrders.status, 'delivered'), gte(cafeOrders.deliveredAt, from), lt(cafeOrders.deliveredAt, to));
  const deletedNameEn = sql`case when ${cafeOrderItems.itemId} is null then ${cafeOrderItems.nameEn} end`;
  const deletedNameAr = sql`case when ${cafeOrderItems.itemId} is null then ${cafeOrderItems.nameAr} end`;
  const rows = db
    .select({
      userId: cafeOrders.userId,
      itemId: cafeOrderItems.itemId,
      nameEn: sql<string>`coalesce(${cafeItems.nameEn}, ${cafeOrderItems.nameEn})`,
      nameAr: sql<string>`coalesce(${cafeItems.nameAr}, ${cafeOrderItems.nameAr})`,
      category: cafeItems.category,
      sortOrder: cafeItems.sortOrder,
      qty: sum(cafeOrderItems.qty).mapWith(Number),
    })
    .from(cafeOrderItems)
    .innerJoin(cafeOrders, eq(cafeOrders.id, cafeOrderItems.orderId))
    .leftJoin(cafeItems, eq(cafeItems.id, cafeOrderItems.itemId))
    .where(delivered)
    .groupBy(cafeOrders.userId, cafeOrderItems.itemId, deletedNameEn, deletedNameAr)
    .all();
  const orderCounts = db.select({ userId: cafeOrders.userId, n: count() }).from(cafeOrders).where(delivered).groupBy(cafeOrders.userId).all();

  type Row = (typeof rows)[number];
  // Menu order (category, then its place in the group); items deleted from the menu after them, by name.
  const byMenu = (a: Row, b: Row) => {
    if (a.itemId === null || b.itemId === null) return (a.itemId === null ? 1 : 0) - (b.itemId === null ? 1 : 0) || a.nameEn.localeCompare(b.nameEn);
    return byMenuOrder({ id: a.itemId, category: a.category!, sortOrder: a.sortOrder! }, { id: b.itemId, category: b.category!, sortOrder: b.sortOrder! });
  };
  const line = (r: Row): CafeReportLine => ({ itemId: r.itemId, nameEn: r.nameEn, nameAr: r.nameAr, qty: r.qty });
  const sorted = [...rows].sort(byMenu);

  const totals = new Map<string, CafeReportLine>();
  for (const r of sorted) {
    const key = r.itemId === null ? `deleted:${r.nameEn}\u0000${r.nameAr}` : `item:${r.itemId}`;
    const total = totals.get(key);
    if (total) total.qty += r.qty;
    else totals.set(key, line(r));
  }
  const people = loadPersons(
    db,
    orderCounts.map((o) => o.userId),
  );
  return {
    month,
    currentMonth,
    people: orderCounts
      .map((o) => ({
        person: people.get(o.userId) ?? missingPerson(o.userId),
        orders: o.n,
        items: sorted.filter((r) => r.userId === o.userId).map(line),
      }))
      .sort((a, b) => a.person.name.localeCompare(b.person.name) || a.person.id - b.person.id),
    totals: [...totals.values()],
    orders: orderCounts.reduce((n, o) => n + o.n, 0),
  };
}

// ── The poll ────────────────────────────────────────────────────────────────

/** The cafeteria's part of GET /api/chat/unread: switched on or not, orders waiting on the board (for whoever serves), my own open orders. */
export function cafeUnread(db: Reader, user: Pick<SessionUser, 'id' | 'permissions'>): CafeUnread {
  if (!cafeSettings(db).enabled) return { enabled: false, newOrders: null, myOpenOrders: 0 };
  const newOrders = hasPermission(user, 'cafeteria.serve')
    ? (db.select({ n: count() }).from(cafeOrders).where(eq(cafeOrders.status, 'new')).get()?.n ?? 0)
    : null;
  const myOpenOrders =
    db
      .select({ n: count() })
      .from(cafeOrders)
      .where(and(eq(cafeOrders.userId, user.id), inArray(cafeOrders.status, [...OPEN_CAFE_ORDER_STATUSES])))
      .get()?.n ?? 0;
  return { enabled: true, newOrders, myOpenOrders };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

/** The board, pointing at one order (a new-order alert to whoever serves). */
export const cafeBoardLink = (orderId: number) => `/cafeteria/board?order=${orderId}`;
/** The order screen, pointing at one of my orders (what became of it). */
export const cafeOrderLink = (orderId: number) => `/cafeteria?order=${orderId}`;

/**
 * Alerts left out of this person's bell and its count: new-order alerts
 * (`cafe_order`, which open the board) for anyone who is not — or no longer —
 * someone who serves from the board (cafeServers: the permission taken away,
 * or a section given since), and for everyone while the cafeteria is switched off.
 */
export function hiddenNotificationKinds(db: Reader, user: Pick<SessionUser, 'permissions'>): NotificationKind[] {
  return cafeSettings(db).enabled && servesFromBoard(user.permissions) ? [] : ['cafe_order'];
}

/** "2 × Tea (no sugar) — to Studio 1", in the reader's language. */
export function cafeOrderBody(locale: Locale, lines: readonly Pick<CafeOrderLine, 'nameEn' | 'nameAr' | 'qty' | 'options'>[], place: string, places: readonly CafePlace[]): string {
  return notificationText(locale, 'cafeOrderBody', { items: cafeLinesSummary(lines, locale), place: cafePlaceLabel(place, places, locale) });
}

/** The lines of one order, in the order they were sent. */
export function cafeOrderLines(db: Reader, orderId: number): CafeOrderLine[] {
  return linesOf(db, [orderId]).get(orderId) ?? [];
}

/** A new order that no longer waits (taken or cancelled): what whoever serves is told, quietly. */
export interface CafeOrderGone {
  order: Pick<OrderRow, 'id' | 'userId' | 'place'>;
  /** The name of the person who ordered. */
  by: string;
  outcome: 'on_the_way' | 'cancelled';
}

/**
 * After the transaction: a new order no longer waits, so the "New order from
 * …" push on the phones of whoever serves is replaced — same tag and topic,
 * quietly, not kept on screen — by "Order from …: on the way / cancelled".
 * (In the app, the alert itself was marked read for everyone in the transaction.)
 */
export function queueCafeOrderGone(c: Context<AppEnv>, gone: readonly CafeOrderGone[]): void {
  if (!gone.length || !c.get('config').vapid) return;
  const db = c.get('db');
  const { places } = cafeSettings(db);
  for (const g of gone) {
    const servers = cafeServers(db, g.order.userId);
    const lines = cafeOrderLines(db, g.order.id);
    for (const locale of LOCALES) {
      const ids = servers.filter((s) => s.locale === locale).map((s) => s.id);
      queuePush(
        c,
        ids,
        {
          title: notificationText(locale, g.outcome === 'on_the_way' ? 'cafeOrderTakenTitle' : 'cafeOrderCancelledTitle', { name: g.by }),
          body: cafeOrderBody(locale, lines, g.order.place, places),
          link: cafeBoardLink(g.order.id),
          kind: 'cafe_status',
          tag: `cafe-order-${g.order.id}`,
          quiet: true,
        },
        { ttl: 60 * 60, urgency: 'normal', topic: `cafe-order-${g.order.id}` },
      );
    }
  }
}

/** What the person who ordered is told when an order of theirs can't be made: the alert in the bell and the push. */
export function cafeCancelledAlert(locale: Locale, orderId: number, reason: string): PushPayload {
  return {
    title: notificationText(locale, 'cafeCancelledTitle'),
    body: notificationText(locale, 'cafeCancelledBody', { reason: cafeReasonLabel(reason, locale) }),
    link: cafeOrderLink(orderId),
    kind: 'cafe_status',
    tag: `cafe-${orderId}`,
  };
}

/** Orders cancelled by the server itself, and what to send once the transaction is over. */
export interface CafeAutoCancel {
  /** New orders that no longer wait: replace the servers' pushes (queueCafeOrderGone). */
  gone: CafeOrderGone[];
  /** Pushes to the people who ordered (when they are told). */
  told: { userId: number; payload: PushPayload }[];
}

/**
 * Inside a transaction: cancel open orders (new or on the way) — everyone's,
 * or one person's — with a ready-made reason, as if whoever serves had turned
 * them down. Each new order's alert leaves every server's bell. With `tell`,
 * the person who ordered gets the "can't be made" alert (one per order,
 * replacing the last), in their language; the pushes are returned, to queue
 * after the transaction (sendCafeAutoCancel).
 *
 * Used when the cafeteria is switched off (everyone's, reason `closed`, told)
 * and when an account is switched off (that person's, reason `left`, not told:
 * they can no longer sign in).
 */
export function cancelOpenCafeOrders(tx: Conn, opts: { userId?: number; reason: CafeReasonKey; tell: boolean }, now: number): CafeAutoCancel {
  const open = tx
    .select({ id: cafeOrders.id, userId: cafeOrders.userId, place: cafeOrders.place, status: cafeOrders.status })
    .from(cafeOrders)
    .where(and(inArray(cafeOrders.status, [...OPEN_CAFE_ORDER_STATUSES]), opts.userId === undefined ? undefined : eq(cafeOrders.userId, opts.userId)))
    .orderBy(asc(cafeOrders.id))
    .all();
  if (!open.length) return { gone: [], told: [] };
  const reason = cafeReason(opts.reason).en;
  const names = loadPersons(
    tx,
    open.map((o) => o.userId),
  );
  const out: CafeAutoCancel = { gone: [], told: [] };
  for (const o of open) {
    const done = tx
      .update(cafeOrders)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: reason })
      .where(and(eq(cafeOrders.id, o.id), eq(cafeOrders.status, o.status as CafeOrderStatus)))
      .returning({ id: cafeOrders.id })
      .get();
    if (!done) continue;
    if (o.status === 'new') {
      markNotificationsReadForEveryone(tx, 'cafe_order', cafeBoardLink(o.id), now);
      out.gone.push({ order: o, by: names.get(o.userId)?.name ?? '', outcome: 'cancelled' });
    }
    if (opts.tell) {
      const payload = cafeCancelledAlert(localeOf(tx, o.userId), o.id, reason);
      notify(tx, { userId: o.userId, kind: 'cafe_status', title: payload.title, body: payload.body, link: payload.link }, now, { replace: true });
      out.told.push({ userId: o.userId, payload });
    }
  }
  return out;
}

/** After the transaction of cancelOpenCafeOrders: the pushes to the people told, and the servers' replaced pushes. */
export function sendCafeAutoCancel(c: Context<AppEnv>, result: CafeAutoCancel): void {
  for (const t of result.told) queuePush(c, [t.userId], t.payload, { ttl: 60 * 60, urgency: 'high', topic: t.payload.tag });
  queueCafeOrderGone(c, result.gone);
}
