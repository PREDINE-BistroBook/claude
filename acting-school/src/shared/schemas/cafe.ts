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

/** A name as it is compared: outer spaces and letter case don't count. */
const sameName = (name: string | null | undefined) => (name ?? '').trim().toLocaleLowerCase();

/**
 * PUT /api/cafe/places (cafeteria.serve or settings.manage): the whole list,
 * in order. Answers { places }. No two places may share a name, in either
 * language (ignoring case and outer spaces): an order's place is found by its
 * name, so a second "Office" could never be told from the first.
 */
export const cafePlacesInput = z.object({
  places: z
    .array(bilingualName(MAX_CAFE_PLACE))
    .max(MAX_CAFE_PLACES)
    .superRefine((places, ctx) => {
      const seen = new Set<string>();
      places.forEach((p, i) => {
        // (Also run on a list with a blank entry, which has its own error: nothing to compare there.)
        const names = new Set([sameName(p.en), sameName(p.ar)].filter(Boolean));
        const twice = [...names].find((n) => seen.has(n));
        if (twice !== undefined) ctx.addIssue({ code: 'custom', path: [i, twice === sameName(p.en) ? 'en' : 'ar'], message: 'cafe:errors.placeTwice' });
        names.forEach((n) => seen.add(n));
      });
    }),
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
  /**
   * Why it can't be done, when whoever serves (or the server itself) cancelled
   * it; null when the person who ordered cancelled it themselves. A ready-made
   * reason is stored by its English words: show it with cafeReasonLabel.
   */
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
  const needle = sameName(place);
  return places.find((p) => sameName(p.en) === needle || sameName(p.ar) === needle);
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

/** The list separator in `locale` ("، " in Arabic). */
export const cafeListSeparator = (locale: Locale | string) => (locale === 'ar' ? '، ' : ', ');

// ── Ready-made words, shown in the reader's language ────────────────────────
// Like places, these are stored as typed (or tapped) — in whichever language —
// and shown in the reader's language wherever they match one of these
// (ignoring case and outer spaces). Anything else stays as typed. They are
// data, shared by the server's alerts and the web app, so both say the same.

/** A fixed word or phrase in both languages. */
export interface CafeWords {
  key: string;
  en: string;
  ar: string;
}

/**
 * The quick choices under "Sugar and extras" on a hot drink: one sugar level
 * (tapping another replaces it) and "With milk".
 */
export const CAFE_OPTION_CHIPS = [
  { key: 'no_sugar', group: 'sugar', en: 'No sugar', ar: 'سادة' },
  { key: 'little_sugar', group: 'sugar', en: 'A little sugar', ar: 'على الريحة' },
  { key: 'medium_sugar', group: 'sugar', en: 'Medium sugar', ar: 'مضبوط' },
  { key: 'sweet', group: 'sugar', en: 'Sweet', ar: 'سكر زيادة' },
  { key: 'milk', group: 'extra', en: 'With milk', ar: 'باللبن' },
] as const satisfies readonly (CafeWords & { group: 'sugar' | 'extra' })[];
export type CafeOptionChip = (typeof CAFE_OPTION_CHIPS)[number];
export type CafeOptionChipKey = CafeOptionChip['key'];

/**
 * "Can't do this one": the ready-made reasons the board offers in one tap,
 * and the ones the server gives itself — `closed` when the cafeteria is
 * switched off, `left` when the person who ordered is no longer on the team.
 */
export const CAFE_READY_REASONS = [
  { key: 'out', en: 'Sorry, it is not available now', ar: 'نعتذر، الصنف غير متوفر الآن' },
  { key: 'closed', en: 'The cafeteria is closed now', ar: 'البوفيه مغلق الآن' },
  { key: 'busy', en: 'Sorry, the cafeteria is busy right now', ar: 'نعتذر، البوفيه مشغول الآن' },
  { key: 'left', en: 'No longer on the team', ar: 'لم يعد ضمن الفريق' },
] as const satisfies readonly CafeWords[];
export type CafeReasonKey = (typeof CAFE_READY_REASONS)[number]['key'];
/** The reasons the board offers to tap (`left` is the server's own). */
export const CAFE_QUICK_REASONS = ['out', 'closed', 'busy'] as const satisfies readonly CafeReasonKey[];

function findWords<T extends CafeWords>(text: string, words: readonly T[]): T | undefined {
  const needle = sameName(text);
  return needle ? words.find((w) => sameName(w.en) === needle || sameName(w.ar) === needle) : undefined;
}

/** The ready-made option chip this text is (either language), or undefined. */
export const findCafeOptionChip = (text: string) => findWords(text, CAFE_OPTION_CHIPS);
/** A ready-made reason by its key. */
export const cafeReason = (key: CafeReasonKey) => CAFE_READY_REASONS.find((r) => r.key === key)!;

/** How a line is wanted, split into its parts ("Medium sugar, with milk" → two parts). */
export function cafeOptionParts(options: string | null | undefined): string[] {
  return (options ?? '')
    .split(/\s*[,،]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** How a line is wanted, in `locale`: each ready-made part in that language, the rest as typed. */
export function cafeOptionsLabel(options: string | null | undefined, locale: Locale | string): string {
  const parts = cafeOptionParts(options);
  if (!parts.length) return options ?? '';
  return parts.map((p) => cafeWordsIn(findCafeOptionChip(p), locale) ?? p).join(cafeListSeparator(locale));
}

/** How a reason is stored: a ready-made one by its English words (whichever language it was tapped in), anything else as typed. */
export function storedCafeReason(reason: string): string {
  return findWords(reason, CAFE_READY_REASONS)?.en ?? reason.trim();
}

/** A stored reason in `locale`: a ready-made one in that language, else as typed. */
export function cafeReasonLabel(reason: string, locale: Locale | string): string {
  return cafeWordsIn(findWords(reason, CAFE_READY_REASONS), locale) ?? reason;
}

function cafeWordsIn(words: CafeWords | undefined, locale: Locale | string): string | undefined {
  if (!words) return undefined;
  return locale === 'ar' ? words.ar : words.en;
}

/** "2 × Tea (no sugar), 1 × Water" in `locale`, for alerts and one-line summaries. */
export function cafeLinesSummary(lines: readonly Pick<CafeOrderLine, 'nameEn' | 'nameAr' | 'qty' | 'options'>[], locale: Locale | string): string {
  return lines
    .map((l) => {
      const options = cafeOptionsLabel(l.options, locale);
      return `${l.qty} × ${cafeItemName(l, locale)}${options ? ` (${options})` : ''}`;
    })
    .join(cafeListSeparator(locale));
}
