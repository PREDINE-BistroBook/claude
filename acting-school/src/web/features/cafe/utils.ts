import { CAFE_CATEGORIES, type CafeCategory } from '@shared/enums';
import type { Permission } from '@shared/permissions';
import {
  MAX_CAFE_ORDER_LINES,
  MAX_CAFE_QTY,
  findCafePlace,
  type CafeItem,
  type CafeOrder,
  type CafeOrderInput,
  type CafePlace,
  type CafeUnread,
} from '@shared/schemas/cafe';

/**
 * The cafeteria's logic on the web side, kept free of React so it is tested
 * as plain functions (tests/unit/cafe-web.test.ts): what a person sees of the
 * cafeteria, the order being put together, and the order of the board.
 */

// ── Who sees what ───────────────────────────────────────────────────────────

export const CAFE_PATH = '/cafeteria';
export const CAFE_BOARD_PATH = '/cafeteria/board';
export const CAFE_MENU_PATH = '/cafeteria/menu';

export type CafePage = 'board' | 'menu' | 'order';

const CAFE_PAGE_PATHS: Record<CafePage, string> = { board: CAFE_BOARD_PATH, menu: CAFE_MENU_PATH, order: CAFE_PATH };
export const cafePagePath = (page: CafePage) => CAFE_PAGE_PATHS[page];

/**
 * The cafeteria pages a person may open, in the order of the tabs on them.
 * Whoever serves (cafeteria.serve): the orders board first, then the menu
 * editor, then their own order. With settings.manage only (the director):
 * their own order, then the menu editor. Everyone else: ordering, so no tabs.
 * Nothing at all while the cafeteria is switched off — or not known yet
 * (`enabled` undefined: the poll hasn't answered).
 */
export function cafePages(can: (p: Permission) => boolean, enabled: boolean | undefined): CafePage[] {
  if (!enabled) return [];
  if (can('cafeteria.serve')) return ['board', 'menu', 'order'];
  if (can('settings.manage')) return ['order', 'menu'];
  return ['order'];
}

/** Which cafeteria page a path is, or null for any other path. */
export function cafePageForPath(pathname: string): CafePage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === CAFE_BOARD_PATH) return 'board';
  if (path === CAFE_MENU_PATH) return 'menu';
  if (path === CAFE_PATH) return 'order';
  return null;
}

/**
 * Whether the orders board is this person's home: they serve and see none of
 * the three sections (the Office helper). Their menus then show the board and
 * the menu editor, "/" opens the board, and new orders are announced on every
 * screen. Someone who serves but works in a section (an owner) reaches the
 * board from "Cafeteria" in the account menu instead.
 */
export function boardIsHome(can: (p: Permission) => boolean, sectionCount: number, enabled: boolean | undefined): boolean {
  return !!enabled && sectionCount === 0 && can('cafeteria.serve');
}

/** The count on the "Cafeteria" / "Orders" menu entries: orders nobody has taken yet, for whoever serves; nothing for anyone else. */
export function cafeBadge(cafe: CafeUnread | undefined): number {
  return cafe?.enabled ? (cafe.newOrders ?? 0) : 0;
}

// ── The menu on screen ──────────────────────────────────────────────────────

/** The menu as the order screen and the editor show it: one group per category that has items, in the fixed category order. */
export function menuGroups<T extends Pick<CafeItem, 'category'>>(items: readonly T[]): { category: CafeCategory; items: T[] }[] {
  return CAFE_CATEGORIES.map((category) => ({ category, items: items.filter((i) => i.category === category) })).filter((g) => g.items.length);
}

/**
 * Up / down inside an item's own group: the ids of the whole menu in their new
 * order (what POST /api/cafe/menu/order takes), or null when the item is
 * already first / last of its group.
 */
export function moveInGroup(items: readonly Pick<CafeItem, 'id' | 'category'>[], id: number, delta: -1 | 1): number[] | null {
  const ordered = menuGroups(items).flatMap((g) => g.items);
  const at = ordered.findIndex((i) => i.id === id);
  const other = ordered[at + delta];
  if (at < 0 || !other || other.category !== ordered[at]!.category) return null;
  const ids = ordered.map((i) => i.id);
  [ids[at], ids[at + delta]] = [ids[at + delta]!, ids[at]!];
  return ids;
}

// ── The order being put together ────────────────────────────────────────────

/** One line of the order on screen. An item usually has one line; "another, made differently" gives it a second. */
export interface DraftLine {
  /** Stable while the line lives (React key, and what the buttons name). */
  key: string;
  itemId: number;
  qty: number;
  /** How it is wanted ("no sugar"), as typed. */
  options: string;
}

let lineSeq = 0;
const newLine = (itemId: number): DraftLine => ({ key: `l${++lineSeq}`, itemId, qty: 1, options: '' });

export const linesOf = (draft: readonly DraftLine[], itemId: number) => draft.filter((l) => l.itemId === itemId);
/** How many of everything is on the order. */
export const totalQty = (draft: readonly DraftLine[]) => draft.reduce((n, l) => n + l.qty, 0);
/** Whether another line fits (an order holds at most 10). */
export const canAddLine = (draft: readonly DraftLine[]) => draft.length < MAX_CAFE_ORDER_LINES;
/** Whether "+" on this line still does something (at most 10 of one item per line). */
export const canAddOne = (line: DraftLine | undefined, draft: readonly DraftLine[]) => (line ? line.qty < MAX_CAFE_QTY : canAddLine(draft));

/** "+" on an item's row (no `lineKey`: its first line, made if needed) or on one of its lines. Nothing changes at the limits. */
export function addOne(draft: readonly DraftLine[], itemId: number, lineKey?: string): DraftLine[] {
  const line = lineKey ? draft.find((l) => l.key === lineKey) : draft.find((l) => l.itemId === itemId);
  if (!line) return canAddLine(draft) ? [...draft, newLine(itemId)] : [...draft];
  if (line.qty >= MAX_CAFE_QTY) return [...draft];
  return draft.map((l) => (l === line ? { ...l, qty: l.qty + 1 } : l));
}

/** "−" on a line: one less; the line goes when none is left. */
export function removeOne(draft: readonly DraftLine[], lineKey: string): DraftLine[] {
  return draft.flatMap((l) => (l.key !== lineKey ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []));
}

/** "Another, made differently": one more line of the same item, right after its other lines, to say how that one is wanted. */
export function addVariant(draft: readonly DraftLine[], itemId: number): DraftLine[] {
  if (!canAddLine(draft)) return [...draft];
  const last = draft.map((l) => l.itemId).lastIndexOf(itemId);
  const next = [...draft];
  next.splice(last < 0 ? next.length : last + 1, 0, newLine(itemId));
  return next;
}

export function setOptions(draft: readonly DraftLine[], lineKey: string, options: string): DraftLine[] {
  return draft.map((l) => (l.key === lineKey ? { ...l, options } : l));
}

/**
 * Take off the order whatever can't be ordered right now (switched off, or
 * removed from the menu) — after the menu changed under the person, or the
 * server refused. `dropped` says how many lines went.
 */
export function dropUnavailable(draft: readonly DraftLine[], menu: readonly Pick<CafeItem, 'id' | 'available'>[]): { draft: DraftLine[]; dropped: number } {
  const ok = new Set(menu.filter((i) => i.available).map((i) => i.id));
  const kept = draft.filter((l) => ok.has(l.itemId));
  return { draft: kept, dropped: draft.length - kept.length };
}

/**
 * "Order again": a past order's lines put on the order form — those whose
 * item is still on the menu and available (`skipped` counts the others).
 * It replaces what was on the form.
 */
export function draftFromOrder(order: Pick<CafeOrder, 'items'>, menu: readonly Pick<CafeItem, 'id' | 'available'>[]): { draft: DraftLine[]; skipped: number } {
  const ok = new Set(menu.filter((i) => i.available).map((i) => i.id));
  const wanted = order.items.slice(0, MAX_CAFE_ORDER_LINES);
  const draft = wanted
    .filter((l) => l.itemId !== null && ok.has(l.itemId))
    .map((l) => ({ ...newLine(l.itemId!), qty: Math.min(Math.max(l.qty, 1), MAX_CAFE_QTY), options: l.options ?? '' }));
  return { draft, skipped: order.items.length - draft.length };
}

// ── Where it should come ────────────────────────────────────────────────────

/** The place picker: one of the configured places (by its English name), or "Somewhere else" with its text. */
export interface PlaceChoice {
  /** A configured place's English name, 'other', or null while nothing is picked. */
  pick: string | 'other' | null;
  other: string;
}

export const OTHER_PLACE = 'other' as const;

/** The picker as it opens: the person's last place again — a configured one picked, anything else in "Somewhere else". */
export function initialPlace(lastPlace: string | null, places: readonly CafePlace[]): PlaceChoice {
  if (!lastPlace) return { pick: null, other: '' };
  const known = findCafePlace(lastPlace, places);
  return known ? { pick: known.en, other: '' } : { pick: OTHER_PLACE, other: lastPlace };
}

/** The place to send, or null while none is chosen (or "Somewhere else" is still empty). */
export function chosenPlace(choice: PlaceChoice): string | null {
  if (choice.pick === null) return null;
  if (choice.pick === OTHER_PLACE) return choice.other.trim() || null;
  return choice.pick;
}

/** Why "Send order" can't go yet, or null when it can. */
export function orderProblem(draft: readonly DraftLine[], choice: PlaceChoice): 'nothing' | 'place' | null {
  if (!draft.length) return 'nothing';
  if (!chosenPlace(choice)) return 'place';
  return null;
}

/** The request body for POST /api/cafe/orders, or null while something is missing. */
export function toOrderInput(draft: readonly DraftLine[], choice: PlaceChoice, note: string): CafeOrderInput | null {
  const place = chosenPlace(choice);
  if (!draft.length || !place) return null;
  return {
    place,
    note: note.trim() || null,
    items: draft.map((l) => ({ itemId: l.itemId, qty: l.qty, options: l.options.trim() || null })),
  };
}

// ── My orders ───────────────────────────────────────────────────────────────

type BoardOrder = Pick<CafeOrder, 'id' | 'status' | 'createdAt' | 'onTheWayAt' | 'deliveredAt' | 'cancelledAt'>;

/** When an order was finished (delivered or cancelled), else when it was sent. */
export const finishedAt = (o: BoardOrder) => o.deliveredAt ?? o.cancelledAt ?? o.createdAt;

const isOpen = (o: Pick<CafeOrder, 'status'>) => o.status === 'new' || o.status === 'on_the_way';

/** A finished order keeps its large "Delivered ✓" (or "Cancelled") card this long before it joins the recent orders. */
export const STATUS_LINGER_MS = 10 * 60_000;

/**
 * My orders as the order screen shows them. In large words at the top: the
 * ones still coming, one that finished in the last ten minutes (so
 * "Delivered ✓" is seen), and the one an alert pointed at (`focusId`). The
 * rest, newest first, are the recent orders with "Order again".
 */
export function splitMyOrders<T extends BoardOrder>(orders: readonly T[], now: number, focusId: number | null = null, recent = 5): { current: T[]; recent: T[] } {
  const large = (o: T) => isOpen(o) || o.id === focusId || now - finishedAt(o) < STATUS_LINGER_MS;
  return { current: orders.filter(large), recent: orders.filter((o) => !large(o)).slice(0, recent) };
}

// ── The orders board ────────────────────────────────────────────────────────

/**
 * The board, top to bottom: new orders (the longest-waiting first — first
 * come, first served), then the ones on the way (in the order they were sent),
 * then today's delivered and cancelled ones, the latest first.
 */
export function boardSections<T extends BoardOrder>(orders: readonly T[]): { fresh: T[]; onTheWay: T[]; done: T[] } {
  const bySent = (a: T, b: T) => a.createdAt - b.createdAt || a.id - b.id;
  return {
    fresh: orders.filter((o) => o.status === 'new').sort(bySent),
    onTheWay: orders.filter((o) => o.status === 'on_the_way').sort(bySent),
    done: orders.filter((o) => o.status === 'delivered' || o.status === 'cancelled').sort((a, b) => finishedAt(b) - finishedAt(a) || b.id - a.id),
  };
}

/**
 * New orders the board hasn't rung for yet. `known` is every new order it has
 * already shown (null on the first load: nothing rings for what was waiting
 * when the board was opened).
 */
export function newArrivals<T extends Pick<CafeOrder, 'id' | 'status'>>(known: ReadonlySet<number> | null, orders: readonly T[]): T[] {
  if (known === null) return [];
  return orders.filter((o) => o.status === 'new' && !known.has(o.id));
}

/** How long ago, in the unit worth saying: under a minute "now", then minutes up to two hours, then hours. */
export function agoParts(then: number, now: number): { unit: 'now' } | { unit: 'minute' | 'hour'; value: number } {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 120) return { unit: 'minute', value: minutes };
  return { unit: 'hour', value: Math.floor(minutes / 60) };
}

/** The order id in a "/cafeteria?order=12" or "/cafeteria/board?order=12" link (an alert's link), else null. */
export function orderIdFrom(search: string): number | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search : (search.split('?')[1] ?? '')).get('order');
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}
