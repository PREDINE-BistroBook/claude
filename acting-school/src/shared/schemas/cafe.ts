import { z } from 'zod';
import { CAFE_CATEGORIES, CAFE_SERVE_STATUSES, type CafeCategory, type CafeOrderStatus, type Locale } from '../enums';
import { id, optText } from './common';
import type { PersonRef } from './team';

/**
 * The cafeteria (/api/cafe, Part J): every signed-in team member orders from a
 * short menu and says where it should come; whoever holds cafeteria.serve (the
 * Office helper, owners) sees the orders board and moves each order along:
 * new → on_the_way → delivered, or turns it down with a reason. The menu and
 * the places are edited by cafeteria.serve or settings.manage. No prices and
 * no tabs anywhere (the school's choice). The settings switch
 * `cafeteriaEnabled` turns all of it off: every /api/cafe route then answers
 * 409 cafeteria_off.
 */

export const MAX_CAFE_ITEM_NAME = 60;
/** Where an order should come ("Studio 1", or something typed). */
export const MAX_CAFE_PLACE = 80;
export const MAX_CAFE_NOTE = 200;
/** How one line is wanted ("no sugar"). */
export const MAX_CAFE_OPTIONS = 60;
/** Of one item on one line. */
export const MAX_CAFE_QTY = 10;
export const MAX_CAFE_ORDER_LINES = 10;
/** Orders one person may send per hour (429 too_many_orders beyond). */
export const CAFE_ORDERS_PER_HOUR = 10;
/** Why an order can't be done, for the person who ordered. */
export const MAX_CAFE_REASON = 200;
export const MAX_CAFE_ITEMS = 100;
export const MAX_CAFE_PLACES = 20;
/** GET /api/cafe/orders/mine answers the newest this many. */
export const CAFE_MY_ORDERS_PAGE = 20;
/** The board lists at most this many of today's finished orders. */
export const CAFE_BOARD_DONE_LIMIT = 100;

// ── The menu ────────────────────────────────────────────────────────────────

export interface CafeItem {
  id: number;
  nameEn: string;
  nameAr: string;
  category: CafeCategory;
  /** Off: still on the menu, greyed out with "Not available now", can't be ordered. */
  available: boolean;
  sortOrder: number;
}

/** A place an order can come to, in both languages. */
export interface CafePlace {
  en: string;
  ar: string;
}

/**
 * A name in English and Arabic where typing one is enough (the Office helper
 * may only type Arabic, the director only English): a blank half takes the
 * other's text, so the menu reads in both languages. At least one is needed.
 */
const bilingualName = (max: number) =>
  z
    .object({ en: optText(max), ar: optText(max) })
    .superRefine((v, ctx) => {
      if (!v.en && !v.ar) ctx.addIssue({ code: 'custom', path: ['en'], message: 'errors.required' });
    })
    .transform((v) => ({ en: (v.en ?? v.ar)!, ar: (v.ar ?? v.en)! }));

/** POST /api/cafe/menu (cafeteria.serve or settings.manage). Answers 201 CafeItem; the item goes last in its category. */
export const cafeItemInput = z
  .object({
    nameEn: optText(MAX_CAFE_ITEM_NAME),
    nameAr: optText(MAX_CAFE_ITEM_NAME),
    category: z.enum(CAFE_CATEGORIES),
    /** On unless said otherwise. */
    available: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.nameEn && !v.nameAr) ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'errors.required' });
  });
export type CafeItemInput = z.infer<typeof cafeItemInput>;

/**
 * PATCH /api/cafe/menu/:id: any of the names, the category, Available. A name
 * sent blank takes the other language's text (the one sent, else the stored one).
 */
export const cafeItemUpdateInput = z.object({
  nameEn: optText(MAX_CAFE_ITEM_NAME),
  nameAr: optText(MAX_CAFE_ITEM_NAME),
  category: z.enum(CAFE_CATEGORIES).optional(),
  available: z.boolean().optional(),
});
export type CafeItemUpdateInput = z.infer<typeof cafeItemUpdateInput>;

/** POST /api/cafe/menu/order: item ids in the new order (items not named keep their order after them). Answers { items }. */
export const cafeMenuOrderInput = z.object({
  ids: z
    .array(id)
    .min(1)
    .max(MAX_CAFE_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'errors.invalid' }),
});
export type CafeMenuOrderInput = z.infer<typeof cafeMenuOrderInput>;

/** PUT /api/cafe/places (cafeteria.serve or settings.manage): the whole list, in order. Answers { places }. */
export const cafePlacesInput = z.object({
  places: z.array(bilingualName(MAX_CAFE_PLACE)).max(MAX_CAFE_PLACES),
});
export type CafePlacesInput = z.infer<typeof cafePlacesInput>;

/** GET /api/cafe/menu — for every signed-in team member. */
export interface CafeMenu {
  /** Every item, unavailable ones included, by category then order. */
  items: CafeItem[];
  places: CafePlace[];
  /** Where my last order went (as stored), to pick it again; null before a first order. */
  lastPlace: string | null;
}

/** Until the school changes them (settings `cafePlaces`). */
export const DEFAULT_CAFE_PLACES: CafePlace[] = [
  { en: 'Office', ar: 'المكتب' },
  { en: 'Reception', ar: 'الاستقبال' },
  { en: 'Studio 1', ar: 'استوديو 1' },
  { en: 'Studio 2', ar: 'استوديو 2' },
];

/** What "Add the usual items" (POST /api/cafe/menu/defaults) puts on an empty menu. */
export const USUAL_CAFE_ITEMS: { nameEn: string; nameAr: string; category: CafeCategory }[] = [
  { nameEn: 'Tea', nameAr: 'شاي', category: 'hot' },
  { nameEn: 'Coffee', nameAr: 'قهوة', category: 'hot' },
  { nameEn: 'Turkish coffee', nameAr: 'قهوة تركي', category: 'hot' },
  { nameEn: 'Nescafé', nameAr: 'نسكافيه', category: 'hot' },
  { nameEn: 'Green tea', nameAr: 'شاي أخضر', category: 'hot' },
  { nameEn: 'Water', nameAr: 'مياه', category: 'cold' },
  { nameEn: 'Juice', nameAr: 'عصير', category: 'cold' },
  { nameEn: 'Soft drink', nameAr: 'مشروب غازي', category: 'cold' },
  { nameEn: 'Sandwich', nameAr: 'ساندوتش', category: 'food' },
  { nameEn: 'Biscuits', nameAr: 'بسكويت', category: 'food' },
];

// ── Orders ──────────────────────────────────────────────────────────────────

/** One line of a new order. The same item may be on two lines, made differently (one tea plain, one "no sugar"). */
export const cafeOrderLineInput = z.object({
  itemId: id,
  qty: z.number().int().min(1).max(MAX_CAFE_QTY),
  options: optText(MAX_CAFE_OPTIONS),
});
export type CafeOrderLineInput = z.infer<typeof cafeOrderLineInput>;

/** POST /api/cafe/orders (every signed-in team member). Answers 201 CafeOrder. */
export const cafeOrderInput = z.object({
  place: z.string().trim().min(1).max(MAX_CAFE_PLACE),
  note: optText(MAX_CAFE_NOTE),
  items: z.array(cafeOrderLineInput).min(1).max(MAX_CAFE_ORDER_LINES),
});
export type CafeOrderInput = z.infer<typeof cafeOrderInput>;

/**
 * POST /api/cafe/orders/:id/status (cafeteria.serve): the next step
 * (on_the_way, then delivered), or cancelled with a reason the person who
 * ordered will read.
 */
export const cafeStatusInput = z
  .object({
    status: z.enum(CAFE_SERVE_STATUSES),
    reason: optText(MAX_CAFE_REASON),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'cancelled' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'cafe:errors.reasonRequired' });
  });
export type CafeStatusInput = z.infer<typeof cafeStatusInput>;

/** GET /api/cafe/orders?status= (cafeteria.serve). */
export const cafeOrdersQuery = z.object({ status: z.enum(['new', 'on_the_way', 'delivered', 'cancelled']).optional() });
export type CafeOrdersQuery = z.infer<typeof cafeOrdersQuery>;

export interface CafeOrderLine {
  id: number;
  /** The menu item, or null once it was deleted from the menu (the names below stay). */
  itemId: number | null;
  /** The item's names as they were when the order was sent. */
  nameEn: string;
  nameAr: string;
  qty: number;
  options: string | null;
}

/** An order as every cafeteria endpoint answers it. */
export interface CafeOrder {
  id: number;
  /** Who ordered (name and photo, owners too — like the rest of the team pack). */
  by: PersonRef;
  /** A configured place's English name, or what the person typed. Show it with cafePlaceLabel. */
  place: string;
  note: string | null;
  status: CafeOrderStatus;
  items: CafeOrderLine[];
  /** Who last moved it (took it, delivered it, or turned it down); null while new, or cancelled by the person who ordered. */
  handledBy: PersonRef | null;
  /** Why it can't be done, when whoever serves cancelled it; null when the person who ordered cancelled it themselves. */
  cancelReason: string | null;
  createdAt: number;
  onTheWayAt: number | null;
  deliveredAt: number | null;
  cancelledAt: number | null;
  /** It is the caller's own order (so "Cancel order" while it is new). */
  mine: boolean;
}

/**
 * The cafeteria's part of the one 20-second poll (GET /api/chat/unread →
 * `cafe`): whether the cafeteria is switched on at all, and the counts behind
 * the board's badge.
 */
export interface CafeUnread {
  /** The `cafeteriaEnabled` setting. Off: nothing about the cafeteria is shown anywhere. */
  enabled: boolean;
  /** With cafeteria.serve: orders nobody has taken yet (status new); null for everyone else. */
  newOrders: number | null;
  /** My own orders still on their way to me (new or on the way). */
  myOpenOrders: number;
}

/** Error codes (error.code) of the cafeteria API besides the generic ones. */
export const CAFE_ERROR_CODES = {
  /** 409 — the cafeteria is switched off in Settings (every /api/cafe route). */
  cafeteriaOff: 'cafeteria_off',
  /** 409 — an item on the order is not available now, or no longer on the menu; error.details: { itemIds: number[] }. */
  itemUnavailable: 'item_unavailable',
  /** 429 — over 10 orders in an hour. */
  tooManyOrders: 'too_many_orders',
  /** 409 — the order is already delivered or cancelled: nothing changes after that; error.details: { order: CafeOrder }. */
  orderClosed: 'order_closed',
  /** 409 — not the order's next step (delivered before on_the_way, on_the_way twice); error.details: { order: CafeOrder }. */
  notNextStep: 'not_next_step',
  /** 409 — the person who ordered can only cancel while it is still new; error.details: { order: CafeOrder }. */
  alreadyOnTheWay: 'already_on_the_way',
  /** 409 — "Add the usual items" on a menu that already has items. */
  menuNotEmpty: 'menu_not_empty',
  /** 409 — the menu already has 100 items. */
  menuFull: 'menu_full',
} as const;

// ── Shown in the reader's language (shared by the server's alerts and the web app) ──

/** An item's (or an order line's) name in `locale`. */
export function cafeItemName(item: { nameEn: string; nameAr: string }, locale: Locale | string): string {
  return locale === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr;
}

/** A configured place matching `place` in either language (ignoring case and outer spaces), or undefined. */
export function findCafePlace(place: string, places: readonly CafePlace[]): CafePlace | undefined {
  const needle = place.trim().toLocaleLowerCase();
  return places.find((p) => p.en.trim().toLocaleLowerCase() === needle || p.ar.trim().toLocaleLowerCase() === needle);
}

/**
 * How an order's place is stored: a configured place by its English name
 * (whichever language it was picked or typed in), anything else as typed.
 */
export function storedCafePlace(place: string, places: readonly CafePlace[]): string {
  return findCafePlace(place, places)?.en ?? place.trim();
}

/** A stored place in `locale`: the configured place's name in that language, else the text as it is. */
export function cafePlaceLabel(place: string, places: readonly CafePlace[], locale: Locale | string): string {
  const known = findCafePlace(place, places);
  if (!known) return place;
  return locale === 'ar' ? known.ar : known.en;
}

/** "2 × Tea (no sugar), 1 × Water" in `locale`, for alerts and one-line summaries. */
export function cafeLinesSummary(lines: readonly Pick<CafeOrderLine, 'nameEn' | 'nameAr' | 'qty' | 'options'>[], locale: Locale | string): string {
  const sep = locale === 'ar' ? '، ' : ', ';
  return lines.map((l) => `${l.qty} × ${cafeItemName(l, locale)}${l.options ? ` (${l.options})` : ''}`).join(sep);
}
