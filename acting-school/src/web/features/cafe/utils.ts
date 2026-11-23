import { CAFE_CATEGORIES, type CafeCategory } from '@shared/enums';
import type { Permission } from '@shared/permissions';
import {
  CAFE_OPTION_CHIPS,
  MAX_CAFE_OPTIONS,
  MAX_CAFE_ORDER_LINES,
  MAX_CAFE_QTY,
  cafeListSeparator,
  cafeOptionParts,
  cafePlacesInput,
  findCafeOptionChip,
  findCafePlace,
  type CafeItem,
  type CafeOptionChip,
  type CafeOptionChipKey,
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
export const CAFE_REPORT_PATH = '/cafeteria/report';

export type CafePage = 'board' | 'menu' | 'order' | 'report';

const CAFE_PAGE_PATHS: Record<CafePage, string> = { board: CAFE_BOARD_PATH, menu: CAFE_MENU_PATH, order: CAFE_PATH, report: CAFE_REPORT_PATH };
export const cafePagePath = (page: CafePage) => CAFE_PAGE_PATHS[page];

/**
 * The cafeteria pages a person may open, in the order of the tabs on them.
 * Whoever serves (cafeteria.serve: the Office helper, the director, owners):
 * the orders board first, then the menu editor, then their own order. With
 * settings.manage only: their own order, then the menu editor. Everyone else:
 * ordering. With cafeteria.report (owners) the monthly page comes last. Only
 * someone with two or more gets tabs. Nothing at all while the cafeteria is
 * switched off — or not known yet (`enabled` undefined: the poll hasn't answered).
 */
export function cafePages(can: (p: Permission) => boolean, enabled: boolean | undefined): CafePage[] {
  if (!enabled) return [];
  const pages: CafePage[] = can('cafeteria.serve') ? ['board', 'menu', 'order'] : can('settings.manage') ? ['order', 'menu'] : ['order'];
  return can('cafeteria.report') ? [...pages, 'report'] : pages;
}

/** Which cafeteria page a path is, or null for any other path. */
export function cafePageForPath(pathname: string): CafePage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === CAFE_BOARD_PATH) return 'board';
  if (path === CAFE_MENU_PATH) return 'menu';
  if (path === CAFE_REPORT_PATH) return 'report';
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

/** The two name fields (an item's, a place's) in the order a screen shows them: its own language first. */
export function nameFieldsInOrder(language: string): ('en' | 'ar')[] {
  return language === 'ar' ? ['ar', 'en'] : ['en', 'ar'];
}

/**
 * What is wrong with each row of the places editor before it is saved, by row
 * index: 'blank' (no name in either language) or 'twice' (a name another
 * place already has) — the same rules as PUT /api/cafe/places.
 */
export function placeRowErrors(rows: readonly { en: string; ar: string }[]): Map<number, 'blank' | 'twice'> {
  const out = new Map<number, 'blank' | 'twice'>();
  const parsed = cafePlacesInput.safeParse({ places: rows.map((r) => ({ en: r.en, ar: r.ar })) });
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const [root, index] = issue.path;
    if (root !== 'places' || typeof index !== 'number') continue;
    if (issue.message === 'cafe:errors.placeTwice') out.set(index, 'twice');
    else if (!out.has(index)) out.set(index, 'blank');
  }
  return out;
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

// ── Sugar and extras: the quick choices on a hot drink ──────────────────────

/** The quick choices offered under a menu item: sugar and milk on hot drinks, none elsewhere. */
export function optionChipsFor(category: CafeCategory): readonly CafeOptionChip[] {
  return category === 'hot' ? CAFE_OPTION_CHIPS : [];
}

/** Which quick choices a line's text already holds (in either language). */
export function activeOptionChips(options: string): Set<CafeOptionChipKey> {
  return new Set(cafeOptionParts(options).flatMap((p) => findCafeOptionChip(p)?.key ?? []));
}

/**
 * A tap on a quick choice: added to the line's text in the screen's language
 * (one sugar level at a time: another one is replaced), or taken out again
 * when it is already there. Typed words stay. Nothing changes if the text
 * would grow past what a line holds (60 characters).
 */
export function toggleOptionChip(options: string, key: CafeOptionChipKey, locale: string): string {
  const chip = CAFE_OPTION_CHIPS.find((c) => c.key === key)!;
  const parts = cafeOptionParts(options);
  const had = parts.some((p) => findCafeOptionChip(p)?.key === key);
  const kept = parts.filter((p) => {
    const other = findCafeOptionChip(p);
    if (!other) return true;
    if (other.key === key) return false;
    return !(chip.group === 'sugar' && other.group === 'sugar');
  });
  const next = (had ? kept : [...kept, locale === 'ar' ? chip.ar : chip.en]).join(cafeListSeparator(locale));
  return next.length > MAX_CAFE_OPTIONS ? options : next;
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

/**
 * The place picker: one of the configured places (by its English name), or
 * "Somewhere else" with its text. "Somewhere else" is its own flag, so no
 * place's name — not even one called "other" — can be mistaken for it.
 */
export interface PlaceChoice {
  /** A configured place's English name, or null while none is picked. */
  pick: string | null;
  /** "Somewhere else" is picked (then `pick` doesn't count). */
  elsewhere: boolean;
  /** What was typed for "Somewhere else". */
  other: string;
}

export const NO_PLACE: PlaceChoice = { pick: null, elsewhere: false, other: '' };

/** The picker as it opens: the person's last place again — a configured one picked, anything else in "Somewhere else". */
export function initialPlace(lastPlace: string | null, places: readonly CafePlace[]): PlaceChoice {
  if (!lastPlace) return NO_PLACE;
  const known = findCafePlace(lastPlace, places);
  return known ? { pick: known.en, elsewhere: false, other: '' } : { pick: null, elsewhere: true, other: lastPlace };
}

/** The place to send, or null while none is chosen (or "Somewhere else" is still empty). */
export function chosenPlace(choice: PlaceChoice): string | null {
  if (choice.elsewhere) return choice.other.trim() || null;
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
 * ones still coming, the latest one that finished in the last ten minutes (so
 * "Delivered ✓" is seen — only that one, so the menu isn't pushed screens
 * down), and the one an alert pointed at (`focusId`). The rest, newest first,
 * are the recent orders with "Order again".
 */
export function splitMyOrders<T extends BoardOrder>(orders: readonly T[], now: number, focusId: number | null = null, recent = 5): { current: T[]; recent: T[] } {
  const latestFinished = orders.filter((o) => !isOpen(o)).sort((a, b) => finishedAt(b) - finishedAt(a) || b.id - a.id)[0];
  const lingering = latestFinished && now - finishedAt(latestFinished) < STATUS_LINGER_MS ? latestFinished.id : null;
  const large = (o: T) => isOpen(o) || o.id === focusId || o.id === lingering;
  return { current: orders.filter(large), recent: orders.filter((o) => !large(o)).slice(0, recent) };
}

// ── The orders board ────────────────────────────────────────────────────────

export type BoardSection = 'fresh' | 'onTheWay';

/**
 * The board, top to bottom: new orders (the longest-waiting first — first
 * come, first served), then the ones on the way (in the order they were sent),
 * then today's delivered and cancelled ones, the latest first.
 *
 * `pinned` keeps orders in the section they were in (while the step buttons
 * rest after a tap, BOARD_MOVE_REST_MS): the card just moved stays under the
 * finger, showing its new state, instead of the next order sliding into its place.
 */
export function boardSections<T extends BoardOrder>(orders: readonly T[], pinned: ReadonlyMap<number, BoardSection> = new Map()): { fresh: T[]; onTheWay: T[]; done: T[] } {
  const bySent = (a: T, b: T) => a.createdAt - b.createdAt || a.id - b.id;
  const sectionOf = (o: T): BoardSection | 'done' => pinned.get(o.id) ?? (o.status === 'new' ? 'fresh' : o.status === 'on_the_way' ? 'onTheWay' : 'done');
  return {
    fresh: orders.filter((o) => sectionOf(o) === 'fresh').sort(bySent),
    onTheWay: orders.filter((o) => sectionOf(o) === 'onTheWay').sort(bySent),
    done: orders.filter((o) => sectionOf(o) === 'done').sort((a, b) => finishedAt(b) - finishedAt(a) || b.id - a.id),
  };
}

/** Where every open order is on the board now (to pin them while the step buttons rest). */
export function boardPins(orders: readonly BoardOrder[]): Map<number, BoardSection> {
  const { fresh, onTheWay } = boardSections(orders);
  return new Map([...fresh.map((o) => [o.id, 'fresh'] as const), ...onTheWay.map((o) => [o.id, 'onTheWay'] as const)]);
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

/**
 * After any tap on a board's step button, every step button rests this long:
 * a second tap on the same spot (a habit for people new to apps) must not mark
 * the order Delivered at once, or take the next order that slid under the
 * finger. The API has no step back.
 */
export const BOARD_MOVE_REST_MS = 2_000;

/** Whether the board's step buttons are resting after the last tap on one (at `lastMoveAt`). */
export function boardResting(lastMoveAt: number | null, now: number): boolean {
  return lastMoveAt !== null && now - lastMoveAt < BOARD_MOVE_REST_MS;
}

/** While an order waits untaken, the board rings again this often — until someone taps the screen. */
export const BOARD_REMIND_MS = 60_000;

/**
 * Whether the board rings again for orders still waiting: there are some, it
 * has rung before, nobody has touched the screen since, and a minute has passed.
 * A tap anywhere stops it until the next new order rings.
 */
export function shouldRemind({ waiting, lastRingAt, lastTapAt, now }: { waiting: number; lastRingAt: number | null; lastTapAt: number | null; now: number }): boolean {
  if (!waiting || lastRingAt === null) return false;
  if (lastTapAt !== null && lastTapAt >= lastRingAt) return false;
  return now - lastRingAt >= BOARD_REMIND_MS;
}

/** The notification tags of new orders that no longer wait (to close their notifications on this phone). */
export function staleOrderTags(tags: readonly string[], waitingIds: ReadonlySet<number>): string[] {
  return tags.filter((tag) => {
    const m = /^cafe-order-(\d+)$/.exec(tag);
    return !!m && !waitingIds.has(Number(m[1]));
  });
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
