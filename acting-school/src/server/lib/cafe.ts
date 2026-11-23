/**
 * The cafeteria (Part J): the menu, orders as every endpoint answers them
 * (CafeOrder), who serves, and the counts the 20-second poll carries
 * (GET /api/chat/unread → `cafe`). The routes are in routes/cafe.ts.
 */
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { CAFE_CATEGORIES, OPEN_CAFE_ORDER_STATUSES, type Locale } from '../../shared/enums';
import type { CafeItem, CafeOrder, CafeOrderLine, CafePlace, CafeUnread } from '../../shared/schemas/cafe';
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings';
import type { SessionUser } from '../../shared/schemas/auth';
import type { DB } from '../db/database';
import { cafeItems, cafeOrderItems, cafeOrders, settings, users } from '../db/schema';
import { hasPermission, loadAccess } from './access';
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
 * Every active account whose positions allow cafeteria.serve (the Office
 * helper; owners hold every permission), with the language their alerts are
 * written in. `exceptUserId` leaves one person out (whoever just ordered).
 */
export function cafeServers(db: Reader, exceptUserId?: number): { id: number; locale: Locale }[] {
  const active = db.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.active, true)).orderBy(asc(users.id)).all();
  const access = loadAccess(
    db,
    active.map((u) => u.id),
  );
  return active.filter((u) => u.id !== exceptUserId && hasPermission(access.get(u.id), 'cafeteria.serve'));
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
