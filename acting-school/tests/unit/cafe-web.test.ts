import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_POSITIONS, servesFromBoard, type Permission } from '../../src/shared/permissions';
import {
  CAFE_OPTION_CHIPS,
  DEFAULT_CAFE_PLACES,
  MAX_CAFE_OPTIONS,
  MAX_CAFE_ORDER_LINES,
  MAX_CAFE_QTY,
  cafeLinesSummary,
  cafeOptionsLabel,
  cafeOrderInput,
  cafeReasonLabel,
  storedCafeReason,
  type CafeItem,
  type CafeOrder,
} from '../../src/shared/schemas/cafe';
import {
  CAFE_BOARD_PATH,
  CAFE_MENU_PATH,
  CAFE_PATH,
  CAFE_REPORT_PATH,
  BOARD_MOVE_REST_MS,
  BOARD_REMIND_MS,
  NO_PLACE,
  STATUS_LINGER_MS,
  activeOptionChips,
  addOne,
  addVariant,
  agoParts,
  boardIsHome,
  boardPins,
  boardResting,
  boardSections,
  cafeBadge,
  cafePageForPath,
  cafePages,
  canAddLine,
  canAddOne,
  chosenPlace,
  draftFromOrder,
  dropUnavailable,
  initialPlace,
  linesOf,
  menuGroups,
  moveInGroup,
  nameFieldsInOrder,
  newArrivals,
  optionChipsFor,
  orderIdFrom,
  orderProblem,
  placeRowErrors,
  removeOne,
  setOptions,
  shouldRemind,
  splitMyOrders,
  staleOrderTags,
  toOrderInput,
  toggleOptionChip,
  totalQty,
  type DraftLine,
  type PlaceChoice,
} from '../../src/web/features/cafe/utils';
import { CAFE_HOME_ITEMS, CAFE_ITEM, NAV_ITEMS, cafeMenuActive, cafeMenuHint, landingAfterSignIn, mobileTabs } from '../../src/web/layout/nav';
import { sectionForPath, visibleSections } from '../../src/web/layout/sections';

/**
 * The cafeteria on the web side (Part J): who sees which of its pages, the
 * order being put together, the order of the board. Plain functions, no React.
 */

const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions as readonly Permission[];
const canWith = (permissions: readonly Permission[]) => (p: Permission) => permissions.includes(p);
const sections = (permissions: readonly Permission[]) => visibleSections(canWith(permissions)).length;

const picked = (place: string): PlaceChoice => ({ pick: place, elsewhere: false, other: '' });
const item = (id: number, over: Partial<CafeItem> = {}): CafeItem => ({ id, nameEn: `Item ${id}`, nameAr: `صنف ${id}`, category: 'hot', available: true, sortOrder: id, ...over });
const TEA = 1;
const COFFEE = 2;
const WATER = 3;
const MENU = [item(TEA), item(COFFEE), item(WATER, { category: 'cold' })];

const person = (id: number) => ({ id, name: `P${id}`, photoFileId: null, active: true });
const order = (id: number, over: Partial<CafeOrder> = {}): CafeOrder => ({
  id,
  by: person(7),
  place: 'Studio 1',
  note: null,
  status: 'new',
  items: [{ id: id * 10, itemId: TEA, nameEn: 'Tea', nameAr: 'شاي', qty: 1, options: null }],
  handledBy: null,
  cancelReason: null,
  createdAt: 1_000_000 + id * 60_000,
  onTheWayAt: null,
  deliveredAt: null,
  cancelledAt: null,
  mine: false,
  ...over,
});

describe('who sees what of the cafeteria', () => {
  it('everyone orders; whoever serves (the helper, the director, owners) also has the board and the menu editor; owners the monthly page too', () => {
    expect(cafePages(canWith(builtIn('acting_coach')), true)).toEqual(['order']);
    expect(cafePages(canWith(builtIn('reception')), true)).toEqual(['order']);
    expect(cafePages(canWith(builtIn('office_helper')), true)).toEqual(['board', 'menu', 'order']);
    expect(cafePages(canWith(builtIn('ceo')), true)).toEqual(['board', 'menu', 'order', 'report']);
    // The director serves since grant v4 (D2), and has no monthly page.
    expect(cafePages(canWith(builtIn('executive_director')), true)).toEqual(['board', 'menu', 'order']);
    // settings.manage without cafeteria.serve: their own order first, then the menu.
    expect(cafePages(canWith(['settings.manage']), true)).toEqual(['order', 'menu']);
    expect(cafePages(canWith(['cafeteria.serve']), true)).toEqual(['board', 'menu', 'order']);
    expect(cafePages(canWith(['cafeteria.report']), true)).toEqual(['order', 'report']);
  });

  it('nothing at all while the cafeteria is switched off, or before the poll has said', () => {
    for (const key of ['ceo', 'office_helper', 'executive_director', 'acting_coach', 'reception']) {
      expect(cafePages(canWith(builtIn(key)), false), key).toEqual([]);
      expect(cafePages(canWith(builtIn(key)), undefined), key).toEqual([]);
    }
    expect(cafeBadge({ enabled: false, newOrders: 3, myOpenOrders: 0 })).toBe(0);
    expect(cafeBadge(undefined)).toBe(0);
  });

  it('the orders board is home for someone who serves and sees no section — the Office helper, not an owner', () => {
    const helper = builtIn('office_helper');
    expect(sections(helper)).toBe(0);
    expect(boardIsHome(canWith(helper), sections(helper), true)).toBe(true);
    // Off, or not known yet: not their home (the small home, or a loader, instead).
    expect(boardIsHome(canWith(helper), sections(helper), false)).toBe(false);
    expect(boardIsHome(canWith(helper), sections(helper), undefined)).toBe(false);
    // An owner serves too but works in the sections; a receptionist sees no section but doesn't serve.
    const ceo = builtIn('ceo');
    expect(boardIsHome(canWith(ceo), sections(ceo), true)).toBe(false);
    const reception = builtIn('reception');
    expect(sections(reception)).toBe(0);
    expect(boardIsHome(canWith(reception), 0, true)).toBe(false);
    // It follows the permission and the sections, never the position's name: a helper who is also given a section starts there.
    const helperAndCoach = [...helper, ...builtIn('acting_coach')];
    expect(boardIsHome(canWith(helperAndCoach), sections(helperAndCoach), true)).toBe(false);
    // The director serves too (D2), but works in the sections.
    const director = builtIn('executive_director');
    expect(boardIsHome(canWith(director), sections(director), true)).toBe(false);
  });

  it('the board is home for exactly those the server alerts about new orders (D1: the same rule, servesFromBoard)', () => {
    const sets: (readonly Permission[])[] = [
      ...BUILT_IN_POSITIONS.map((p) => p.permissions as readonly Permission[]),
      [...builtIn('office_helper'), ...builtIn('acting_coach')],
      ['cafeteria.serve', 'website.manage'],
      ['cafeteria.serve', 'settings.manage', 'staff.manage', 'cafeteria.report'],
      ['cafeteria.serve', 'talent.read'],
    ];
    for (const held of sets) expect(boardIsHome(canWith(held), sections(held), true), held.join()).toBe(servesFromBoard(held));
  });

  it('Reception sees none of the three sections (School, Casting, Website)', () => {
    expect(visibleSections(canWith(builtIn('reception')))).toEqual([]);
    expect(visibleSections(canWith(builtIn('office_helper')))).toEqual([]);
    expect(mobileTabs(null, canWith(builtIn('reception')))).toEqual(['/']);
  });

  it('the badge counts orders nobody has taken yet, only for whoever serves', () => {
    expect(cafeBadge({ enabled: true, newOrders: 2, myOpenOrders: 1 })).toBe(2);
    expect(cafeBadge({ enabled: true, newOrders: null, myOpenOrders: 1 })).toBe(0);
  });

  it('the cafeteria pages are outside the three sections, and are told apart by their path', () => {
    for (const p of [CAFE_PATH, CAFE_BOARD_PATH, CAFE_MENU_PATH, CAFE_REPORT_PATH]) expect(sectionForPath(p), p).toBeNull();
    expect(cafePageForPath('/cafeteria')).toBe('order');
    expect(cafePageForPath('/cafeteria/')).toBe('order');
    expect(cafePageForPath('/cafeteria/board')).toBe('board');
    expect(cafePageForPath('/cafeteria/menu')).toBe('menu');
    expect(cafePageForPath('/cafeteria/report')).toBe('report');
    expect(cafePageForPath('/cafeteria/else')).toBeNull();
    expect(cafePageForPath('/team')).toBeNull();
  });

  it('menus: one Cafeteria entry outside the section menus; the helper’s own menu is the board (with its count), the menu editor and his own order', () => {
    expect(NAV_ITEMS.some((i) => i.to.startsWith('/cafeteria'))).toBe(false);
    expect(CAFE_ITEM).toMatchObject({ to: '/cafeteria', label: 'cafeteria', badge: 'cafeNewOrders' });
    // One navigation for the helper (UX-9): the bottom bar has all three; the pages show no second row of tabs.
    expect(CAFE_HOME_ITEMS.map((i) => [i.to, i.label, i.badge])).toEqual([
      ['/cafeteria/board', 'cafeBoard', 'cafeNewOrders'],
      ['/cafeteria/menu', 'cafeMenu', undefined],
      ['/cafeteria', 'cafeOrder', undefined],
    ]);
    expect(CAFE_HOME_ITEMS.find((i) => i.to === '/cafeteria')?.end).toBe(true);
    // The entry is current on every cafeteria page — except for the helper, whose own menu has the other two.
    for (const p of ['/cafeteria', '/cafeteria/board', '/cafeteria/menu']) expect(cafeMenuActive(p), p).toBe(true);
    expect(cafeMenuActive('/cafeteria', true)).toBe(true);
    expect(cafeMenuActive('/cafeteria/board', true)).toBe(false);
    expect(cafeMenuActive('/cafeteriax')).toBe(false);
    expect(cafeMenuActive('/team')).toBe(false);
    expect(cafeMenuHint(canWith(builtIn('acting_coach')))).toBe('cafeteriaHint');
    expect(cafeMenuHint(canWith(builtIn('office_helper')))).toBe('cafeteriaHintServe');
  });

  it('after signing in on a shared phone: the board and the menu editor open only for those who may; ordering for everyone', () => {
    const coach = canWith(builtIn('acting_coach'));
    const helper = canWith(builtIn('office_helper'));
    const director = canWith(builtIn('executive_director'));
    expect(landingAfterSignIn('/cafeteria/board', coach)).toBe('/');
    expect(landingAfterSignIn('/cafeteria/menu', coach)).toBe('/');
    expect(landingAfterSignIn('/cafeteria?order=4', coach)).toBe('/cafeteria?order=4');
    expect(landingAfterSignIn('/cafeteria/board?order=4', helper)).toBe('/cafeteria/board?order=4');
    expect(landingAfterSignIn('/cafeteria/menu', helper)).toBe('/cafeteria/menu');
    expect(landingAfterSignIn('/cafeteria/board', director)).toBe('/cafeteria/board');
    expect(landingAfterSignIn('/cafeteria/menu', director)).toBe('/cafeteria/menu');
    // The monthly page: owners only.
    expect(landingAfterSignIn('/cafeteria/report', director)).toBe('/');
    expect(landingAfterSignIn('/cafeteria/report', helper)).toBe('/');
    expect(landingAfterSignIn('/cafeteria/report', canWith(builtIn('ceo')))).toBe('/cafeteria/report');
  });
});

describe('the menu on screen', () => {
  it('is grouped by category in the fixed order (hot, cold, food, other), skipping empty groups', () => {
    const mixed = [item(5, { category: 'food' }), item(1), item(4, { category: 'cold' }), item(2)];
    expect(menuGroups(mixed).map((g) => [g.category, g.items.map((i) => i.id)])).toEqual([
      ['hot', [1, 2]],
      ['cold', [4]],
      ['food', [5]],
    ]);
    expect(menuGroups([])).toEqual([]);
  });

  it('up / down moves an item inside its own group only, and gives the whole menu’s new order', () => {
    const menu = [item(1), item(2), item(3), item(4, { category: 'cold' }), item(5, { category: 'cold' })];
    expect(moveInGroup(menu, 2, -1)).toEqual([2, 1, 3, 4, 5]);
    expect(moveInGroup(menu, 2, 1)).toEqual([1, 3, 2, 4, 5]);
    expect(moveInGroup(menu, 5, -1)).toEqual([1, 2, 3, 5, 4]);
    // First and last of a group stay there: never across into the next group.
    expect(moveInGroup(menu, 1, -1)).toBeNull();
    expect(moveInGroup(menu, 3, 1)).toBeNull();
    expect(moveInGroup(menu, 4, -1)).toBeNull();
    expect(moveInGroup(menu, 5, 1)).toBeNull();
    expect(moveInGroup(menu, 99, 1)).toBeNull();
  });
});

describe('putting an order together (− / +)', () => {
  const qtys = (draft: DraftLine[]) => draft.map((l) => [l.itemId, l.qty, l.options]);

  it('"+" on an item starts its line and adds to it; "−" takes one off and the line goes at zero', () => {
    let draft = addOne([], TEA);
    draft = addOne(draft, TEA);
    draft = addOne(draft, WATER);
    expect(qtys(draft)).toEqual([
      [TEA, 2, ''],
      [WATER, 1, ''],
    ]);
    expect(totalQty(draft)).toBe(3);
    draft = removeOne(draft, linesOf(draft, TEA)[0]!.key);
    expect(qtys(draft)).toEqual([
      [TEA, 1, ''],
      [WATER, 1, ''],
    ]);
    draft = removeOne(draft, linesOf(draft, TEA)[0]!.key);
    expect(qtys(draft)).toEqual([[WATER, 1, '']]);
    expect(removeOne(draft, 'no-such-line')).toEqual(draft);
  });

  it('two teas, one with no sugar: "another, made differently" gives the item a second line with its own words', () => {
    let draft = addOne([], TEA);
    draft = addOne(draft, COFFEE);
    draft = addVariant(draft, TEA);
    // The second tea sits right after the first, before the coffee.
    expect(draft.map((l) => l.itemId)).toEqual([TEA, TEA, COFFEE]);
    const [plain, special] = linesOf(draft, TEA) as [DraftLine, DraftLine];
    expect(plain.key).not.toBe(special.key);
    draft = setOptions(draft, special.key, 'no sugar');
    expect(qtys(draft)).toEqual([
      [TEA, 1, ''],
      [TEA, 1, 'no sugar'],
      [COFFEE, 1, ''],
    ]);
    // "+" on the second line adds to that line; "+" on the item's row adds to its first.
    draft = addOne(draft, TEA, special.key);
    draft = addOne(draft, TEA);
    expect(linesOf(draft, TEA).map((l) => [l.qty, l.options])).toEqual([
      [2, ''],
      [2, 'no sugar'],
    ]);
    // What is sent validates on the server's own schema.
    const input = toOrderInput(draft, picked('Studio 1'), '')!;
    expect(cafeOrderInput.safeParse(input).success).toBe(true);
    expect(input.items).toEqual([
      { itemId: TEA, qty: 2, options: null },
      { itemId: TEA, qty: 2, options: 'no sugar' },
      { itemId: COFFEE, qty: 1, options: null },
    ]);
  });

  it('the limits: 10 of an item on a line, 10 lines an order — the buttons stop there', () => {
    let draft: DraftLine[] = [];
    for (let i = 0; i < MAX_CAFE_QTY + 3; i++) draft = addOne(draft, TEA);
    expect(linesOf(draft, TEA)[0]!.qty).toBe(MAX_CAFE_QTY);
    expect(canAddOne(linesOf(draft, TEA)[0], draft)).toBe(false);
    for (let i = 0; i < MAX_CAFE_ORDER_LINES + 3; i++) draft = addVariant(draft, TEA);
    expect(draft).toHaveLength(MAX_CAFE_ORDER_LINES);
    expect(canAddLine(draft)).toBe(false);
    // A new item has no room either; an existing line under 10 still takes "+".
    expect(canAddOne(undefined, draft)).toBe(false);
    expect(addOne(draft, COFFEE)).toHaveLength(MAX_CAFE_ORDER_LINES);
    expect(canAddOne(draft[1], draft)).toBe(true);
    expect(cafeOrderInput.safeParse(toOrderInput(draft, picked('Office'), '')).success).toBe(true);
  });

  it('nothing is changed in place (React state)', () => {
    const draft = addOne([], TEA);
    const frozen = Object.freeze(draft.map((l) => Object.freeze({ ...l }))) as unknown as DraftLine[];
    expect(() => {
      addOne(frozen, TEA);
      addVariant(frozen, TEA);
      removeOne(frozen, frozen[0]!.key);
      setOptions(frozen, frozen[0]!.key, 'x');
    }).not.toThrow();
    expect(frozen[0]!.qty).toBe(1);
  });

  it('an item switched off or removed while the person was choosing comes off the order', () => {
    let draft = addOne(addOne(addOne([], TEA), COFFEE), WATER);
    draft = addVariant(draft, COFFEE);
    const menu = [item(TEA), item(COFFEE, { available: false })];
    const next = dropUnavailable(draft, menu);
    expect(next.draft.map((l) => l.itemId)).toEqual([TEA]);
    expect(next.dropped).toBe(3);
    expect(dropUnavailable(next.draft, menu)).toEqual({ draft: next.draft, dropped: 0 });
  });

  it('"Order again" puts a past order on the form — what is still available of it', () => {
    const past = order(1, {
      items: [
        { id: 1, itemId: TEA, nameEn: 'Tea', nameAr: 'شاي', qty: 2, options: 'no sugar' },
        { id: 2, itemId: COFFEE, nameEn: 'Coffee', nameAr: 'قهوة', qty: 1, options: null },
        // Removed from the menu since: the order kept its name, but it can't be ordered again.
        { id: 3, itemId: null, nameEn: 'Cake', nameAr: 'كيك', qty: 1, options: null },
      ],
    });
    const all = draftFromOrder(past, MENU);
    expect(all.draft.map((l) => [l.itemId, l.qty, l.options])).toEqual([
      [TEA, 2, 'no sugar'],
      [COFFEE, 1, ''],
    ]);
    expect(all.skipped).toBe(1);
    expect(new Set(all.draft.map((l) => l.key)).size).toBe(2);
    const some = draftFromOrder(past, [item(TEA), item(COFFEE, { available: false })]);
    expect(some.draft.map((l) => l.itemId)).toEqual([TEA]);
    expect(some.skipped).toBe(2);
    expect(draftFromOrder(past, [])).toEqual({ draft: [], skipped: 3 });
  });
});

describe('where should it come?', () => {
  const elsewhere = (other: string): PlaceChoice => ({ pick: null, elsewhere: true, other });

  it('starts on the person’s last place: a configured one picked, anything else in "Somewhere else"', () => {
    expect(initialPlace(null, DEFAULT_CAFE_PLACES)).toEqual(NO_PLACE);
    expect(initialPlace('Studio 1', DEFAULT_CAFE_PLACES)).toEqual(picked('Studio 1'));
    // Stored in English whichever language it was picked in; an old Arabic text still finds its place.
    expect(initialPlace('استوديو 2', DEFAULT_CAFE_PLACES)).toEqual(picked('Studio 2'));
    expect(initialPlace('The roof', DEFAULT_CAFE_PLACES)).toEqual(elsewhere('The roof'));
    // The place was removed from the list since: it is still offered, as text.
    expect(initialPlace('Studio 1', [])).toEqual(elsewhere('Studio 1'));
  });

  it('"Send order" needs something chosen and a place; the note is optional', () => {
    const draft = addOne([], TEA);
    expect(orderProblem([], picked('Office'))).toBe('nothing');
    expect(orderProblem(draft, NO_PLACE)).toBe('place');
    expect(orderProblem(draft, elsewhere('   '))).toBe('place');
    expect(orderProblem(draft, elsewhere(' The roof '))).toBeNull();
    expect(chosenPlace(elsewhere(' The roof '))).toBe('The roof');
    // A picked place wins over text left in the "Somewhere else" field; once "Somewhere else" is tapped, its text counts.
    expect(chosenPlace({ pick: 'Office', elsewhere: false, other: 'The roof' })).toBe('Office');
    expect(chosenPlace({ pick: 'Office', elsewhere: true, other: 'The roof' })).toBe('The roof');
    expect(toOrderInput([], picked('Office'), 'x')).toBeNull();
    expect(toOrderInput(draft, NO_PLACE, 'x')).toBeNull();
    expect(toOrderInput(setOptions(draft, draft[0]!.key, '  '), picked('Office'), '  after 11  ')).toEqual({
      place: 'Office',
      note: 'after 11',
      items: [{ itemId: TEA, qty: 1, options: null }],
    });
    expect(toOrderInput(draft, picked('Office'), ' ')!.note).toBeNull();
  });

  it('a place called "other" is a place like any other: "Somewhere else" is its own flag (NIT-2)', () => {
    const places = [...DEFAULT_CAFE_PLACES, { en: 'other', ar: 'أخرى' }];
    const draft = addOne([], TEA);
    expect(initialPlace('other', places)).toEqual(picked('other'));
    expect(chosenPlace(picked('other'))).toBe('other');
    expect(orderProblem(draft, picked('other'))).toBeNull();
    expect(toOrderInput(draft, picked('other'), '')!.place).toBe('other');
  });
});

describe('my orders on the order screen', () => {
  const now = 10_000_000;
  const delivered = (id: number, minutesAgo: number) => order(id, { status: 'delivered', deliveredAt: now - minutesAgo * 60_000 });

  it('in large words: the ones still coming, one just finished, and the one an alert pointed at; the rest are "recent"', () => {
    const waiting = order(5);
    const coming = order(4, { status: 'on_the_way', onTheWayAt: now - 60_000 });
    const justDelivered = delivered(3, 2);
    const older = delivered(2, 45);
    const cancelled = order(1, { status: 'cancelled', cancelledAt: now - 3 * 60 * 60_000, cancelReason: 'No milk' });
    const mine = [waiting, coming, justDelivered, older, cancelled];
    const split = splitMyOrders(mine, now);
    expect(split.current.map((o) => o.id)).toEqual([5, 4, 3]);
    expect(split.recent.map((o) => o.id)).toEqual([2, 1]);
    // "Delivered ✓" stays large for ten minutes, then joins the recent orders.
    expect(splitMyOrders(mine, now + STATUS_LINGER_MS).current.map((o) => o.id)).toEqual([5, 4]);
    // Opened from the alert "Sorry, your order can’t be made": that order is at the top with its reason.
    const focused = splitMyOrders(mine, now, 1);
    expect(focused.current.map((o) => o.id)).toEqual([5, 4, 3, 1]);
    expect(focused.recent.map((o) => o.id)).toEqual([2]);
    expect(splitMyOrders([], now)).toEqual({ current: [], recent: [] });
  });

  it('only the latest finished order stays large, so a second one doesn’t push the menu a screen further down (UX-17)', () => {
    const cancelledJustNow = order(9, { status: 'cancelled', cancelledAt: now - 60_000 });
    const deliveredBefore = delivered(8, 5);
    const split = splitMyOrders([cancelledJustNow, deliveredBefore], now);
    expect(split.current.map((o) => o.id)).toEqual([9]);
    expect(split.recent.map((o) => o.id)).toEqual([8]);
    // …unless an alert points at the other one.
    expect(splitMyOrders([cancelledJustNow, deliveredBefore], now, 8).current.map((o) => o.id)).toEqual([9, 8]);
  });

  it('shows the five newest recent orders', () => {
    const many = Array.from({ length: 9 }, (_, i) => delivered(20 - i, 60 + i));
    expect(splitMyOrders(many, now).recent.map((o) => o.id)).toEqual([20, 19, 18, 17, 16]);
  });

  it('reads the order an alert points at from its link', () => {
    expect(orderIdFrom('?order=12')).toBe(12);
    expect(orderIdFrom('/cafeteria/board?order=3')).toBe(3);
    expect(orderIdFrom('?order=abc')).toBeNull();
    expect(orderIdFrom('?order=-2')).toBeNull();
    expect(orderIdFrom('')).toBeNull();
  });
});

describe('the orders board', () => {
  const t0 = 5_000_000;
  it('new orders first, the longest-waiting at the top; then the ones on the way; then today’s finished ones, the latest first', () => {
    const items = [
      order(1, { status: 'delivered', createdAt: t0, deliveredAt: t0 + 50 }),
      order(2, { status: 'new', createdAt: t0 + 30 }),
      order(3, { status: 'on_the_way', createdAt: t0 + 20, onTheWayAt: t0 + 60 }),
      order(4, { status: 'new', createdAt: t0 + 10 }),
      order(5, { status: 'cancelled', createdAt: t0 + 5, cancelledAt: t0 + 90, cancelReason: 'No cups' }),
      order(6, { status: 'on_the_way', createdAt: t0 + 15, onTheWayAt: t0 + 70 }),
      order(7, { status: 'new', createdAt: t0 + 10 }),
    ];
    const board = boardSections(items);
    expect(board.fresh.map((o) => o.id)).toEqual([4, 7, 2]);
    expect(board.onTheWay.map((o) => o.id)).toEqual([6, 3]);
    expect(board.done.map((o) => o.id)).toEqual([5, 1]);
    // The list it was given is left as it was.
    expect(items.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(boardSections([])).toEqual({ fresh: [], onTheWay: [], done: [] });
  });

  it('after a tap on a step button the cards stay where they were (pinned), so the next order can’t slide under the finger (UX-1)', () => {
    const items = [order(1, { status: 'new', createdAt: t0 }), order(2, { status: 'new', createdAt: t0 + 10 }), order(3, { status: 'on_the_way', createdAt: t0 - 10 })];
    const pins = boardPins(items);
    expect([...pins]).toEqual([
      [1, 'fresh'],
      [2, 'fresh'],
      [3, 'onTheWay'],
    ]);
    // Order 1 was taken and order 3 delivered meanwhile: while pinned they keep their places (showing their new state) …
    const after = [order(1, { status: 'on_the_way', createdAt: t0 }), order(2, { status: 'new', createdAt: t0 + 10 }), order(3, { status: 'delivered', createdAt: t0 - 10, deliveredAt: t0 + 99 })];
    const pinned = boardSections(after, pins);
    expect(pinned.fresh.map((o) => o.id)).toEqual([1, 2]);
    expect(pinned.onTheWay.map((o) => o.id)).toEqual([3]);
    expect(pinned.done).toEqual([]);
    // … a new order that came meanwhile goes where it belongs …
    expect(boardSections([...after, order(4, { createdAt: t0 + 20 })], pins).fresh.map((o) => o.id)).toEqual([1, 2, 4]);
    // … and once the rest is over, everything moves to its own section.
    const free = boardSections(after);
    expect([free.fresh, free.onTheWay, free.done].map((l) => l.map((o) => o.id))).toEqual([[2], [1], [3]]);
  });

  it('the step buttons rest for two seconds after any tap: a double tap can’t mark an order Delivered at once (UX-1)', () => {
    const tap = 1_000_000;
    expect(BOARD_MOVE_REST_MS).toBe(2_000);
    expect(boardResting(null, tap)).toBe(false);
    for (const later of [0, 350, 700, 1_200, 1_999]) expect(boardResting(tap, tap + later), String(later)).toBe(true);
    expect(boardResting(tap, tap + 2_000)).toBe(false);
  });

  it('rings again once a minute while an order waits and nobody has touched the screen; a tap stops it until the next new order (UX-8)', () => {
    const rang = 5_000_000;
    expect(BOARD_REMIND_MS).toBe(60_000);
    expect(shouldRemind({ waiting: 1, lastRingAt: rang, lastTapAt: null, now: rang + 59_999 })).toBe(false);
    expect(shouldRemind({ waiting: 1, lastRingAt: rang, lastTapAt: null, now: rang + 60_000 })).toBe(true);
    expect(shouldRemind({ waiting: 1, lastRingAt: rang, lastTapAt: rang - 5_000, now: rang + 90_000 })).toBe(true);
    // Touched since the ring, nothing waiting, or never rung (the orders were there when the board opened): quiet.
    expect(shouldRemind({ waiting: 1, lastRingAt: rang, lastTapAt: rang + 1_000, now: rang + 600_000 })).toBe(false);
    expect(shouldRemind({ waiting: 0, lastRingAt: rang, lastTapAt: null, now: rang + 600_000 })).toBe(false);
    expect(shouldRemind({ waiting: 3, lastRingAt: null, lastTapAt: null, now: rang })).toBe(false);
  });

  it('closes this phone’s “New order” notifications for orders that no longer wait (NIT-3)', () => {
    expect(staleOrderTags(['cafe-order-1', 'cafe-order-2', 'cafe-5', 'summons-3', 'cafe-order-x'], new Set([2]))).toEqual(['cafe-order-1']);
    expect(staleOrderTags([], new Set())).toEqual([]);
  });

  it('rings for orders that were not there at the last look — never for what was waiting when the board opened, never twice', () => {
    const first = [order(1), order(2, { status: 'on_the_way' })];
    expect(newArrivals(null, first)).toEqual([]);
    const known = new Set([1]);
    expect(newArrivals(known, first)).toEqual([]);
    const next = [order(1), order(2, { status: 'on_the_way' }), order(3), order(4, { status: 'delivered' })];
    expect(newArrivals(known, next).map((o) => o.id)).toEqual([3]);
    known.add(3);
    expect(newArrivals(known, next)).toEqual([]);
  });

  it('says how long ago in the unit worth saying', () => {
    const now = 100 * 60 * 60_000;
    expect(agoParts(now - 20_000, now)).toEqual({ unit: 'now' });
    expect(agoParts(now + 5_000, now)).toEqual({ unit: 'now' });
    expect(agoParts(now - 61_000, now)).toEqual({ unit: 'minute', value: 1 });
    expect(agoParts(now - 45 * 60_000, now)).toEqual({ unit: 'minute', value: 45 });
    expect(agoParts(now - 119 * 60_000, now)).toEqual({ unit: 'minute', value: 119 });
    expect(agoParts(now - 120 * 60_000, now)).toEqual({ unit: 'hour', value: 2 });
    expect(agoParts(now - 30 * 60 * 60_000, now)).toEqual({ unit: 'hour', value: 30 });
  });
});

describe('sugar and extras: one tap on a hot drink (UX-3)', () => {
  const chip = (key: string) => CAFE_OPTION_CHIPS.find((c) => c.key === key)!;

  it('are offered on hot drinks only, with the Egyptian words the helper reads', () => {
    expect(optionChipsFor('hot').map((c) => c.ar)).toEqual(['سادة', 'على الريحة', 'مضبوط', 'سكر زيادة', 'باللبن']);
    expect(optionChipsFor('hot').map((c) => c.en)).toEqual(['No sugar', 'A little sugar', 'Medium sugar', 'Sweet', 'With milk']);
    for (const category of ['cold', 'food', 'other'] as const) expect(optionChipsFor(category)).toEqual([]);
    // Every chip is 48 px of tappable words, and fits a line's 60 characters with room to spare.
    for (const c of CAFE_OPTION_CHIPS) expect(c.en.length + c.ar.length).toBeLessThan(MAX_CAFE_OPTIONS);
  });

  it('a tap writes the words in the screen’s language; one sugar level at a time; a second tap takes it out; typed words stay', () => {
    let text = toggleOptionChip('', 'medium_sugar', 'ar');
    expect(text).toBe('مضبوط');
    text = toggleOptionChip(text, 'milk', 'ar');
    expect(text).toBe('مضبوط، باللبن');
    // Another sugar level replaces the first.
    text = toggleOptionChip(text, 'no_sugar', 'ar');
    expect(text).toBe('باللبن، سادة');
    expect([...activeOptionChips(text)].sort()).toEqual(['milk', 'no_sugar']);
    text = toggleOptionChip(text, 'milk', 'ar');
    expect(text).toBe('سادة');
    // English, around what was typed; a chip typed in the other language is still recognised.
    expect(toggleOptionChip('in a big cup', 'sweet', 'en')).toBe('in a big cup, Sweet');
    expect(toggleOptionChip('Sweet, in a big cup', 'sweet', 'en')).toBe('in a big cup');
    expect(activeOptionChips('سكر زيادة, extra hot')).toEqual(new Set(['sweet']));
    expect(toggleOptionChip('سادة', 'sweet', 'en')).toBe('Sweet');
    // Never past what a line holds.
    const long = 'x'.repeat(MAX_CAFE_OPTIONS - 3);
    expect(toggleOptionChip(long, 'milk', 'en')).toBe(long);
    expect(chip('milk').group).toBe('extra');
  });

  it('each reader sees the ready-made words in their own language — the helper in Arabic, an English reader in English; typed words as typed', () => {
    expect(cafeOptionsLabel('No sugar, with milk', 'ar')).toBe('سادة، باللبن');
    expect(cafeOptionsLabel('مضبوط، extra hot', 'en')).toBe('Medium sugar, extra hot');
    expect(cafeOptionsLabel('in a mug', 'ar')).toBe('in a mug');
    expect(cafeOptionsLabel(null, 'en')).toBe('');
    expect(cafeLinesSummary([{ nameEn: 'Tea', nameAr: 'شاي', qty: 2, options: 'no sugar' }], 'ar')).toBe('2 × شاي (سادة)');
  });

  it('a ready-made reason is kept by its English words and read in each reader’s language (UX-12)', () => {
    expect(storedCafeReason('  نعتذر، البوفيه مشغول الآن ')).toBe('Sorry, the cafeteria is busy right now');
    expect(cafeReasonLabel('Sorry, the cafeteria is busy right now', 'ar')).toBe('نعتذر، البوفيه مشغول الآن');
    expect(cafeReasonLabel('The cafeteria is closed now', 'en')).toBe('The cafeteria is closed now');
    expect(storedCafeReason(' No milk left ')).toBe('No milk left');
    expect(cafeReasonLabel('No milk left', 'ar')).toBe('No milk left');
  });
});

describe('the Menu tab', () => {
  it('shows the two name fields in the screen’s own language first (UX-14)', () => {
    expect(nameFieldsInOrder('ar')).toEqual(['ar', 'en']);
    expect(nameFieldsInOrder('en')).toEqual(['en', 'ar']);
  });

  it('says which place rows can’t be saved, before anything is sent: a blank row, a name used twice in either language (NIT-2)', () => {
    expect(placeRowErrors(DEFAULT_CAFE_PLACES)).toEqual(new Map());
    const rows = [
      { en: 'Office', ar: 'المكتب' },
      { en: ' office ', ar: '' },
      { en: '', ar: '' },
      { en: 'Roof', ar: 'المكتب' },
      { en: 'other', ar: 'أخرى' },
    ];
    expect([...placeRowErrors(rows)].sort()).toEqual([
      [1, 'twice'],
      [2, 'blank'],
      [3, 'twice'],
    ]);
  });
});

describe('the cafeteria’s words on screen', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('the names the school asked for, in both languages', async () => {
    const { namespaces } = await import('../../src/web/i18n');
    const { common, cafe, positions } = namespaces;
    expect(common.en.nav.cafeteria).toBe('Cafeteria');
    expect(common.ar.nav.cafeteria).toBe('البوفيه');
    expect(cafe.en.orderDrink).toBe('Order a drink');
    expect(cafe.en.status).toMatchObject({ new: 'Sent — waiting', on_the_way: 'On the way', delivered: 'Delivered ✓' });
    // The buttons say what the helper does; the card's strip says where the order is (UX-5).
    expect(cafe.en.board).toMatchObject({ setOff: 'I’m taking it now', delivered: 'I’ve delivered it', cant: 'Can’t do this one', statusNew: 'New order', statusOnTheWay: 'On the way' });
    expect(cafe.ar.board).toMatchObject({ setOff: 'خرجت بالطلب', delivered: 'سلّمت الطلب', cant: 'اعتذار عن الطلب', fresh: 'طلبات جديدة', done: 'انتهت اليوم' });
    // Cancelling one's own order: two buttons that can't be mistaken for each other (UX-4).
    expect(cafe.en.mine).toMatchObject({ cancelYes: 'Yes, cancel the order', keep: 'Keep the order' });
    expect(cafe.ar.mine).toMatchObject({ cancelYes: 'نعم، إلغاء الطلب', keep: 'إبقاء الطلب', again: 'تكرار الطلب' });
    expect(cafe.ar.tabs.menu).toBe('المنيو');
    expect(cafe.en.report.title).toBe('Monthly consumption');
    expect(cafe.ar.report.title).toBe('الاستهلاك الشهري');
    expect(positions.en.perm.cafeteria.report.label).toBe('See monthly cafeteria consumption');
    expect(positions.ar.perm.cafeteria.report.label).toBeTruthy();
    expect(cafe.en.order).toMatchObject({ notAvailable: 'Not available now', somewhereElse: 'Somewhere else', send: 'Send order' });
    expect(cafe.en.mine).toMatchObject({ cancel: 'Cancel order', again: 'Order again' });
    expect(cafe.en.menu.addUsual).toBe('Add the usual items');
    expect(positions.en.perm.cafeteria.serve.label).toBe('Serve cafeteria orders and manage the menu');
    expect(positions.en.groups.cafeteria).toBe('Cafeteria');
    expect(positions.ar.groups.cafeteria).toBe('البوفيه');
  });

  it('every cafe:errors.* key the server and the shared schemas answer has words in English and Arabic', async () => {
    const { default: cafe } = await import('../../src/web/features/cafe/i18n');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(path.resolve(__dirname, '../../src/server'));
    walk(path.resolve(__dirname, '../../src/shared'));
    const keys = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/'cafe:errors\.(\w+)'/g)) keys.add(m[1]!);
    expect([...keys]).toContain('reasonRequired');
    const missing = [...keys].filter((k) => !(cafe.en.errors as Record<string, string>)[k] || !(cafe.ar.errors as Record<string, unknown>)[k]);
    expect(missing).toEqual([]);
  });

  it('every error code of the cafeteria API has its own words (never the generic "Something went wrong")', async () => {
    const { CAFE_ERROR_CODES } = await import('../../src/shared/schemas/cafe');
    const { cafeErrorKey } = await import('../../src/web/features/cafe/api');
    const { ApiError } = await import('../../src/web/lib/api');
    const { default: cafe } = await import('../../src/web/features/cafe/i18n');
    for (const code of Object.values(CAFE_ERROR_CODES)) {
      const key = cafeErrorKey(new ApiError(409, code, code));
      expect(key, code).toMatch(/^cafe:errors\.\w+$/);
      expect((cafe.en.errors as Record<string, string>)[key.split('.')[1]!], code).toBeTruthy();
    }
    expect(cafeErrorKey(new ApiError(0, 'network', 'x'))).toBe('common:errors.network');
    expect(cafeErrorKey(new ApiError(400, 'validation', 'x', [{ path: ['reason'], code: 'custom', message: 'cafe:errors.reasonRequired' }]))).toBe('cafe:errors.reasonRequired');
  });

  it('no price or currency anywhere in the cafeteria’s words (the school’s choice)', async () => {
    const { default: cafe } = await import('../../src/web/features/cafe/i18n');
    const strings = (obj: unknown): string[] => (obj && typeof obj === 'object' ? Object.values(obj).flatMap(strings) : typeof obj === 'string' ? [obj] : []);
    // "no prices" itself is said on the Menu tab; nothing else mentions money.
    const money = /\bEGP\b|\bLE\b|£|\$|جنيه|ج\.م|\bcost|\bpay|\bbill\b|فاتورة|الدفع/i;
    expect(strings(cafe.en).filter((s) => money.test(s))).toEqual([]);
    expect(strings(cafe.ar).filter((s) => money.test(s))).toEqual([]);
  });

  it('the route table: ordering for everyone, the board behind cafeteria.serve, the menu editor behind its own guard, the monthly page behind cafeteria.report', async () => {
    const { cafeRoutes } = await import('../../src/web/features/cafe/routes');
    expect(cafeRoutes.map((r) => r.path)).toEqual(['cafeteria', 'cafeteria/board', 'cafeteria/menu', 'cafeteria/report']);
    const element = (p: string) => cafeRoutes.find((r) => r.path === p)!.element as { props: Record<string, unknown>; type: { name?: string } };
    expect(element('cafeteria/board').props.permission).toBe('cafeteria.serve');
    expect(element('cafeteria/menu').type.name).toBe('MenuGuard');
    expect(element('cafeteria/report').props.permission).toBe('cafeteria.report');
    expect(element('cafeteria').props.permission).toBeUndefined();
  });

  it('the bell never breaks on an alert of a kind it doesn’t know (an older page, a newer server): the plain bell (NIT-4)', async () => {
    const { notificationLook } = await import('../../src/web/features/team/components/HeaderButtons');
    const { Bell } = await import('lucide-react');
    for (const kind of ['message', 'summon', 'summon_answer', 'cafe_order', 'cafe_status']) {
      const look = notificationLook(kind);
      expect(look.icon, kind).toBeTruthy();
      expect(look.tone, kind).toMatch(/\S/);
    }
    expect(notificationLook('something_new')).toEqual({ icon: Bell, tone: 'bg-surface-2 text-muted' });
  });
});
