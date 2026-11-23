import Database from 'better-sqlite3';
import { eq, getTableName } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { initDb, type DB } from '../../src/server/db/database';
import { applyMigrations } from '../../src/server/db/migrate';
import bundle from '../../src/server/db/migrations/bundle';
import * as schema from '../../src/server/db/schema';
import { cafeItems, cafeOrderItems, cafeOrders, notifications, positions, settings, userPositions, users } from '../../src/server/db/schema';
import { WIPE_ORDER, wipeAllData } from '../../src/server/db/wipe';
import { builtInGrantsVersion, ensureBuiltInPositions } from '../../src/server/lib/access';
import { generateVapidKeys } from '../../src/server/lib/push/keys';
import { durableObjectLimits, insertBatches } from '../../src/server/lib/sqlLimits';
import {
  BUILT_IN_GRANTS,
  BUILT_IN_GRANTS_SETTING,
  BUILT_IN_POSITIONS,
  LATEST_BUILT_IN_GRANTS_VERSION,
  PERMISSIONS,
  PERMISSION_GROUPS,
} from '../../src/shared/permissions';
import {
  CAFE_ORDERS_PER_HOUR,
  DEFAULT_CAFE_PLACES,
  MAX_CAFE_ITEMS,
  MAX_CAFE_ORDER_LINES,
  USUAL_CAFE_ITEMS,
  cafeLinesSummary,
  cafePlaceLabel,
  storedCafePlace,
  type CafeItem,
  type CafeMenu,
  type CafeOrder,
} from '../../src/shared/schemas/cafe';
import type { ChatUnreadResponse } from '../../src/shared/schemas/chat';
import type { NotificationsResponse } from '../../src/shared/schemas/notifications';
import type { Position } from '../../src/shared/schemas/positions';
import { makeTestContext, type Client } from '../helpers';
import { fakeBrowser, pushRecorder } from '../pushHelpers';

/**
 * Part J: the Reception and Office helper positions, the cafeteria.serve
 * permission, and cafeteria orders (/api/cafe).
 */

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;
const HOUR = 60 * 60 * 1000;

/** A school with the usual menu, an Arabic-speaking office helper and a coach. */
async function cafe(opts: Parameters<typeof makeTestContext>[0] = {}) {
  const t = await makeTestContext(opts);
  const helper = await t.as('office_helper', { name: 'Sayed Ramadan', locale: 'ar' });
  const coach = await t.as('acting_coach', { name: 'Layla Haddad' });
  const menu = (await helper.post<{ items: CafeItem[] }>('/api/cafe/menu/defaults')).body.items;
  const item = (nameEn: string) => menu.find((i) => i.nameEn === nameEn)!;
  return { t, helper, coach, menu, item };
}

/** An order as answered — or, on a refusal, the API's error (tests look at whichever applies). */
type OrderAnswer = CafeOrder & { error: { code: string; details?: any; issues?: any[] } };
const order = (client: Client, items: { itemId: number; qty?: number; options?: string }[], place = 'Studio 1', note?: string) =>
  client.post<OrderAnswer>('/api/cafe/orders', { place, note, items: items.map((l) => ({ qty: 1, ...l })) });
const move = (client: Client, id: number, status: string, reason?: string) => client.post<OrderAnswer>(`/api/cafe/orders/${id}/status`, { status, reason });
const bell = async (client: Client) => (await client.get<NotificationsResponse>('/api/notifications')).body;
const poll = async (client: Client) => (await client.get<ChatUnreadResponse>('/api/chat/unread')).body.cafe;

// ── Positions and the permission ────────────────────────────────────────────

describe('Reception and Office helper: two more built-in positions', () => {
  const builtIn = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!;

  it('are defined with English and Arabic names; Reception allows nothing yet, the Office helper serves the cafeteria', () => {
    expect(builtIn('reception')).toEqual({ key: 'reception', name: 'Reception', nameAr: 'الاستقبال', isOwner: false, permissions: [] });
    expect(builtIn('office_helper')).toEqual({ key: 'office_helper', name: 'Office helper', nameAr: 'عامل المكتب', isOwner: false, permissions: ['cafeteria.serve'] });
  });

  it('cafeteria.serve: its own group; owners hold it by definition; the Executive Director does not get it; no upgrade grant was needed', () => {
    expect(PERMISSIONS).toContain('cafeteria.serve');
    expect(PERMISSION_GROUPS.find((g) => g.id === 'cafeteria')?.permissions).toEqual(['cafeteria.serve']);
    for (const p of BUILT_IN_POSITIONS) {
      expect((p.permissions as readonly string[]).includes('cafeteria.serve'), p.key).toBe(p.isOwner || p.key === 'office_helper');
    }
    // The released grants are untouched: a new position comes with its own list.
    expect(LATEST_BUILT_IN_GRANTS_VERSION).toBe(3);
    expect(BUILT_IN_GRANTS.flatMap((g) => Object.values(g.grants).flat())).not.toContain('cafeteria.serve');
  });

  /** A database as the live one is today: every migration before the cafeteria's, the eight positions it has, people holding them. */
  function databaseFromBeforeThisRelease() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema, logger: durableObjectLimits }) as unknown as DB;
    const upTo = bundle.journal.entries.findIndex((e) => e.tag.endsWith('_cafeteria'));
    expect(upTo).toBeGreaterThan(0);
    applyMigrations(db, { ...bundle, journal: { ...bundle.journal, entries: bundle.journal.entries.slice(0, upTo) } });
    const old = BUILT_IN_POSITIONS.filter((p) => p.key !== 'reception' && p.key !== 'office_helper');
    for (const [i, p] of old.entries()) {
      sqlite
        .prepare('insert into positions (key, name, name_ar, is_owner, permissions, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, 1)')
        .run(p.key, p.name, p.nameAr, p.isOwner ? 1 : 0, JSON.stringify(p.permissions.filter((x) => x !== 'cafeteria.serve')), i * 10);
    }
    sqlite.prepare(`insert into settings (key, value) values (?, '3')`).run(BUILT_IN_GRANTS_SETTING);
    const insertUser = sqlite.prepare(`insert into users (email, name, password_hash, created_at, updated_at) values (?, ?, 'x', 1, 1)`);
    const hold = sqlite.prepare('insert into user_positions (user_id, position_id) select ?, id from positions where key = ?');
    for (const [email, name, key] of [
      ['ceo@studio.test', 'Ahmed', 'ceo'],
      ['salma@studio.test', 'Salma', 'executive_director'],
      ['taha@studio.test', 'Taha', 'casting_team'],
    ] as const) {
      hold.run(insertUser.run(email, name).lastInsertRowid, key);
    }
    return { sqlite, db };
  }
  const allPositions = (db: DB) => db.select().from(positions).all();
  const byKey = (db: DB, key: string) => allPositions(db).find((p) => p.key === key);

  it('an existing database gets them once at the next start — with the new tables — and nothing else about its positions or people changes', () => {
    const { sqlite, db } = databaseFromBeforeThisRelease();
    expect(sqlite.prepare(`select count(*) as n from sqlite_master where name like 'cafe_%' and type = 'table'`).get()).toEqual({ n: 0 });
    const before = allPositions(db);
    const holdersBefore = db.select().from(userPositions).all();
    expect(before).toHaveLength(8);

    initDb(db);
    expect(sqlite.prepare(`select count(*) as n from sqlite_master where name like 'cafe_%' and type = 'table'`).get()).toEqual({ n: 3 });
    expect(allPositions(db).map((p) => p.key)).toEqual([...before.map((p) => p.key), 'reception', 'office_helper']);
    expect(byKey(db, 'reception')).toMatchObject({ name: 'Reception', nameAr: 'الاستقبال', isOwner: false, permissions: [], sortOrder: 80 });
    expect(byKey(db, 'office_helper')).toMatchObject({ name: 'Office helper', nameAr: 'عامل المكتب', isOwner: false, permissions: ['cafeteria.serve'], sortOrder: 90 });
    // The eight it had are exactly as they were (the director was not given cafeteria.serve), and so is who holds what.
    expect(allPositions(db).slice(0, 8)).toEqual(before);
    expect(byKey(db, 'executive_director')!.permissions).not.toContain('cafeteria.serve');
    expect(db.select().from(userPositions).all()).toEqual(holdersBefore);
    expect(builtInGrantsVersion(db)).toBe(3);

    // Every later start: still ten.
    initDb(db);
    initDb(db);
    expect(allPositions(db)).toHaveLength(10);
  });

  it('an owner renames them and changes what they allow: later starts neither create them again nor reset them', () => {
    const { db } = databaseFromBeforeThisRelease();
    initDb(db);
    db.update(positions).set({ name: 'Front desk', nameAr: 'مكتب الاستقبال', permissions: ['admissions.read', 'students.read'] }).where(eq(positions.key, 'reception')).run();
    // The helper's cafeteria permission is taken away (say the school stops using the cafeteria) and he is given something else.
    db.update(positions).set({ name: 'Buffet', nameAr: 'البوفيه', permissions: ['students.read'], sortOrder: 5 }).where(eq(positions.key, 'office_helper')).run();
    const edited = allPositions(db);

    initDb(db);
    initDb(db);
    expect(allPositions(db)).toEqual(edited);
    expect(allPositions(db)).toHaveLength(10);
    expect(byKey(db, 'reception')).toMatchObject({ name: 'Front desk', permissions: ['admissions.read', 'students.read'] });
    expect(byKey(db, 'office_helper')).toMatchObject({ name: 'Buffet', permissions: ['students.read'], sortOrder: 5 });
    expect(allPositions(db).filter((p) => /reception|office helper/i.test(p.name))).toEqual([]);
  });

  it('a position the school already made by hand under that name is taken over, not doubled: it keeps its people and gains what the built-in allows', () => {
    const { sqlite, db } = databaseFromBeforeThisRelease();
    const custom = sqlite.prepare(`insert into positions (key, name, name_ar, is_owner, permissions, sort_order, created_at, updated_at) values (null, ?, ?, 0, ?, ?, 1, 1)`);
    const receptionId = Number(custom.run('reception', null, JSON.stringify(['admissions.read']), 200).lastInsertRowid);
    const helperId = Number(custom.run('Office boy', 'عامل المكتب', JSON.stringify(['students.read']), 210).lastInsertRowid);
    const user = Number(sqlite.prepare(`insert into users (email, name, password_hash, created_at, updated_at) values ('sayed@studio.test', 'Sayed', 'x', 1, 1)`).run().lastInsertRowid);
    sqlite.prepare('insert into user_positions (user_id, position_id) values (?, ?)').run(user, helperId);

    initDb(db);
    initDb(db);
    expect(allPositions(db)).toHaveLength(10);
    // Matched by its English name (any letter case) …
    expect(byKey(db, 'reception')).toMatchObject({ id: receptionId, name: 'reception', nameAr: 'الاستقبال', permissions: ['admissions.read'], sortOrder: 200 });
    // … or by its Arabic name: its own names and order stay, the cafeteria permission is added, its holder keeps it.
    expect(byKey(db, 'office_helper')).toMatchObject({ id: helperId, name: 'Office boy', nameAr: 'عامل المكتب', permissions: ['students.read', 'cafeteria.serve'], sortOrder: 210 });
    expect(db.select().from(userPositions).where(eq(userPositions.userId, user)).all()).toEqual([{ userId: user, positionId: helperId }]);
  });

  it('an owner position is never taken over, and nor is a hand-made owner position', async () => {
    const t = await makeTestContext();
    t.db.delete(positions).where(eq(positions.key, 'reception')).run();
    const ownerNamedLikeIt = t.db.insert(positions).values({ name: 'Reception', isOwner: true, permissions: [], sortOrder: 300 }).returning().get();
    expect(ensureBuiltInPositions(t.db)).toEqual(['reception']);
    expect(t.db.select().from(positions).where(eq(positions.id, ownerNamedLikeIt.id)).get()).toMatchObject({ key: null, isOwner: true });
    expect(t.db.select().from(positions).where(eq(positions.key, 'reception')).get()).toMatchObject({ isOwner: false, permissions: [] });
  });

  it('a new school has them from the start; they can be renamed through the API but not deleted', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const list = (await owner.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(list.map((p) => p.key).slice(-2)).toEqual(['reception', 'office_helper']);
    const helper = list.find((p) => p.key === 'office_helper')!;
    expect(helper).toMatchObject({ name: 'Office helper', nameAr: 'عامل المكتب', permissions: ['cafeteria.serve'], editable: true, assignable: true });
    expect((await owner.patch(`/api/positions/${helper.id}`, { name: 'Office assistant' })).body).toMatchObject({ key: 'office_helper', name: 'Office assistant' });
    const gone = await owner.delete(`/api/positions/${helper.id}`);
    expect(gone.status).toBe(409);
    expect(gone.body.error.code).toBe('position_built_in');
  });

  it('the Executive Director can give Reception to someone, but not Office helper: it allows cafeteria.serve, which she does not hold', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const list = (await director.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(list.find((p) => p.key === 'reception')).toMatchObject({ editable: true, assignable: true });
    expect(list.find((p) => p.key === 'office_helper')).toMatchObject({ editable: false, assignable: false });
    const add = (key: 'reception' | 'office_helper') =>
      director.post('/api/staff', { name: 'New Person', email: `${key}@example.com`, password: 'a-long-password', positionIds: [t.positionId(key)] });
    expect((await add('reception')).status).toBe(201);
    expect((await add('office_helper')).status).toBe(403);
    // An owner can.
    const owner = await t.as('owner');
    expect((await owner.post('/api/staff', { name: 'Sayed', email: 'sayed@example.com', password: 'a-long-password', positionIds: [t.positionId('office_helper')] })).status).toBe(201);
  });

  it('a receptionist has no section permissions, and still has Team, Messages, Alerts, the profile and cafeteria ordering', async () => {
    const { t, item } = await cafe();
    const reception = await t.as('reception', { name: 'Nour' });
    expect((await reception.get('/api/auth/me')).body.user).toMatchObject({ permissions: [], isOwner: false });
    for (const closed of ['/api/students', '/api/courses', '/api/talent', '/api/castings', '/api/leads', '/api/site/content', '/api/staff', '/api/positions', '/api/cafe/orders']) {
      expect((await reception.get(closed)).status, closed).toBe(403);
    }
    for (const open of ['/api/team', '/api/chat/conversations', '/api/notifications', '/api/chat/unread', '/api/settings', '/api/cafe/menu', '/api/cafe/orders/mine']) {
      expect((await reception.get(open)).status, open).toBe(200);
    }
    expect((await order(reception, [{ itemId: item('Tea').id }], 'Reception')).status).toBe(201);
    // And can be called to the office.
    const director = await t.as('executive_director');
    expect((await director.post('/api/summons', { userId: reception.user.id })).status).toBe(201);
  });
});

// ── The menu and the places ─────────────────────────────────────────────────

describe('the cafeteria menu', () => {
  it('everyone signed in reads it; it starts empty, with the default places and no remembered place', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/cafe/menu')).status).toBe(401);
    const coach = await t.as('acting_coach');
    const res = await coach.get<CafeMenu>('/api/cafe/menu');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], places: DEFAULT_CAFE_PLACES, lastPlace: null });
    expect(DEFAULT_CAFE_PLACES.map((p) => p.en)).toEqual(['Office', 'Reception', 'Studio 1', 'Studio 2']);
  });

  it('"Add the usual items" fills an empty menu once, in English and Arabic, grouped hot → cold → food', async () => {
    const { t, helper, coach, menu } = await cafe();
    expect(menu.map((i) => i.nameEn)).toEqual(['Tea', 'Coffee', 'Turkish coffee', 'Nescafé', 'Green tea', 'Water', 'Juice', 'Soft drink', 'Sandwich', 'Biscuits']);
    expect(menu.map((i) => i.nameAr)).toEqual(USUAL_CAFE_ITEMS.map((i) => i.nameAr));
    expect(menu.every((i) => i.available && /[؀-ۿ]/.test(i.nameAr))).toBe(true);
    expect([...new Set(menu.map((i) => i.category))]).toEqual(['hot', 'cold', 'food']);
    expect(Object.keys(menu[0]!).sort()).toEqual(['available', 'category', 'id', 'nameAr', 'nameEn', 'sortOrder']);
    const again = await helper.post('/api/cafe/menu/defaults');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('menu_not_empty');
    expect((await coach.get<CafeMenu>('/api/cafe/menu')).body.items).toEqual(menu);
    expect((await coach.post('/api/cafe/menu/defaults')).status).toBe(403);
    expect((await t.anon.post('/api/cafe/menu/defaults')).status).toBe(401);
  });

  it('whoever serves — or holds settings.manage, like the director — adds, renames, switches off, regroups and removes items; nobody else', async () => {
    const { t, helper, coach } = await cafe();
    const director = await t.as('executive_director');
    // One name is enough: the helper types Arabic only, the director English only.
    const mint = await helper.post<CafeItem>('/api/cafe/menu', { nameAr: 'شاي بالنعناع', category: 'hot' });
    expect(mint.status).toBe(201);
    expect(mint.body).toMatchObject({ nameEn: 'شاي بالنعناع', nameAr: 'شاي بالنعناع', category: 'hot', available: true });
    const cake = await director.post<CafeItem>('/api/cafe/menu', { nameEn: ' Cake ', nameAr: '', category: 'food', available: false });
    expect(cake.body).toMatchObject({ nameEn: 'Cake', nameAr: 'Cake', category: 'food', available: false });
    // New items go last in their group.
    const names = async () => (await coach.get<CafeMenu>('/api/cafe/menu')).body.items.map((i) => i.nameEn);
    expect(await names()).toEqual(['Tea', 'Coffee', 'Turkish coffee', 'Nescafé', 'Green tea', 'شاي بالنعناع', 'Water', 'Juice', 'Soft drink', 'Sandwich', 'Biscuits', 'Cake']);

    const renamed = await director.patch<CafeItem>(`/api/cafe/menu/${mint.body.id}`, { nameEn: 'Mint tea' });
    expect(renamed.body).toMatchObject({ nameEn: 'Mint tea', nameAr: 'شاي بالنعناع' });
    // A name cleared takes the other language's.
    expect((await helper.patch<CafeItem>(`/api/cafe/menu/${cake.body.id}`, { nameAr: 'كيك', nameEn: '' })).body).toMatchObject({ nameEn: 'كيك', nameAr: 'كيك' });
    expect((await helper.patch<CafeItem>(`/api/cafe/menu/${cake.body.id}`, { available: true })).body).toMatchObject({ available: true, nameAr: 'كيك' });
    // Moved to another group: last there.
    expect((await helper.patch<CafeItem>(`/api/cafe/menu/${mint.body.id}`, { category: 'other' })).body.category).toBe('other');
    expect((await names()).at(-1)).toBe('Mint tea');

    expect((await helper.post('/api/cafe/menu', { category: 'hot' })).status).toBe(400);
    expect((await helper.post('/api/cafe/menu', { nameEn: 'Soup', category: 'soup' })).status).toBe(400);
    expect((await helper.post('/api/cafe/menu', { nameEn: 'x'.repeat(61), category: 'hot' })).status).toBe(400);
    expect((await helper.patch(`/api/cafe/menu/${cake.body.id}`, { nameEn: '', nameAr: '' })).status).toBe(400);
    expect((await helper.patch('/api/cafe/menu/99999', { available: false })).status).toBe(404);

    for (const call of [
      () => coach.post('/api/cafe/menu', { nameEn: 'Beer', category: 'cold' }),
      () => coach.patch(`/api/cafe/menu/${cake.body.id}`, { available: false }),
      () => coach.delete(`/api/cafe/menu/${cake.body.id}`),
      () => coach.post('/api/cafe/menu/order', { ids: [cake.body.id] }),
    ]) {
      expect((await call()).status).toBe(403);
    }
    expect((await director.delete(`/api/cafe/menu/${cake.body.id}`)).status).toBe(204);
    expect((await director.delete(`/api/cafe/menu/${cake.body.id}`)).status).toBe(404);
  });

  it('up / down: the ids in their new order; items not named follow in the order they had', async () => {
    const { helper, menu, item } = await cafe();
    const hot = menu.filter((i) => i.category === 'hot').map((i) => i.id);
    // Coffee before Tea.
    const moved = await helper.post<{ items: CafeItem[] }>('/api/cafe/menu/order', { ids: [hot[1], hot[0], ...hot.slice(2)] });
    expect(moved.status).toBe(200);
    expect(moved.body.items.map((i) => i.nameEn).slice(0, 3)).toEqual(['Coffee', 'Tea', 'Turkish coffee']);
    expect(moved.body.items.map((i) => i.nameEn).slice(5)).toEqual(['Water', 'Juice', 'Soft drink', 'Sandwich', 'Biscuits']);
    // Only one named: it goes first of its group, the rest keep their order.
    const juiceFirst = await helper.post<{ items: CafeItem[] }>('/api/cafe/menu/order', { ids: [item('Juice').id] });
    expect(juiceFirst.body.items.filter((i) => i.category === 'cold').map((i) => i.nameEn)).toEqual(['Juice', 'Water', 'Soft drink']);
    expect(juiceFirst.body.items.filter((i) => i.category === 'hot').map((i) => i.nameEn).slice(0, 2)).toEqual(['Coffee', 'Tea']);
    expect((await helper.post('/api/cafe/menu/order', { ids: [99999] })).status).toBe(400);
    expect((await helper.post('/api/cafe/menu/order', { ids: [hot[0], hot[0]] })).status).toBe(400);
    expect((await helper.post('/api/cafe/menu/order', { ids: [] })).status).toBe(400);
  });

  it('holds at most 100 items', async () => {
    const { t, helper, menu } = await cafe();
    const more = Array.from({ length: MAX_CAFE_ITEMS - menu.length }, (_, i) => ({ nameEn: `Item ${i}`, nameAr: `صنف ${i}`, category: 'other' as const, sortOrder: 100 + i }));
    for (const batch of insertBatches(cafeItems, more)) t.db.insert(cafeItems).values(batch).run();
    const full = await helper.post('/api/cafe/menu', { nameEn: 'One too many', category: 'other' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('menu_full');
    // The whole menu still reads and orders within the Durable Object limits.
    const all = (await helper.get<CafeMenu>('/api/cafe/menu')).body.items;
    expect(all).toHaveLength(MAX_CAFE_ITEMS);
    expect((await helper.post('/api/cafe/menu/order', { ids: all.map((i) => i.id).reverse() })).status).toBe(200);
  });

  it('the places: the whole list is saved in order by whoever serves or the director; a name in one language is enough', async () => {
    const { t, helper, coach } = await cafe();
    const director = await t.as('executive_director');
    const saved = await helper.put('/api/cafe/places', { places: [{ en: 'Office', ar: 'المكتب' }, { ar: 'السطح' }, { en: ' Kitchen ' }] });
    expect(saved.status).toBe(200);
    const places = [
      { en: 'Office', ar: 'المكتب' },
      { en: 'السطح', ar: 'السطح' },
      { en: 'Kitchen', ar: 'Kitchen' },
    ];
    expect(saved.body).toEqual({ places });
    expect((await coach.get<CafeMenu>('/api/cafe/menu')).body.places).toEqual(places);
    expect((await coach.get('/api/settings')).body.cafePlaces).toEqual(places);
    expect((await director.put('/api/cafe/places', { places: [] })).body).toEqual({ places: [] });
    expect((await coach.get<CafeMenu>('/api/cafe/menu')).body.places).toEqual([]);

    expect((await coach.put('/api/cafe/places', { places })).status).toBe(403);
    expect((await helper.put('/api/cafe/places', { places: [{ en: '', ar: '' }] })).status).toBe(400);
    expect((await helper.put('/api/cafe/places', { places: [{ en: 'x'.repeat(81) }] })).status).toBe(400);
    expect((await helper.put('/api/cafe/places', { places: Array.from({ length: 21 }, (_, i) => ({ en: `Room ${i}` })) })).status).toBe(400);
    expect((await helper.put('/api/cafe/places', {})).status).toBe(400);
    // PATCH /api/settings doesn't take the places (one way in), and unknown keys are dropped.
    await director.patch('/api/settings', { cafePlaces: [{ en: 'Hack', ar: 'Hack' }] });
    expect((await coach.get('/api/settings')).body.cafePlaces).toEqual([]);
  });
});

// ── Ordering ────────────────────────────────────────────────────────────────

describe('ordering (every signed-in team member)', () => {
  it('an order: lines with quantities and how each is wanted, a place, a note — answered 201 as it is stored', async () => {
    const { t, coach, item } = await cafe();
    expect((await t.anon.post('/api/cafe/orders', { place: 'Office', items: [{ itemId: item('Tea').id, qty: 1 }] })).status).toBe(401);
    const before = Date.now();
    // Two teas, one of them with no sugar: the same item on two lines.
    const res = await order(coach, [{ itemId: item('Tea').id }, { itemId: item('Tea').id, options: ' no sugar ' }, { itemId: item('Water').id, qty: 2 }], 'Studio 1', ' After the warm-up, please ');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      by: { id: coach.user.id, name: 'Layla Haddad', photoFileId: null, active: true },
      place: 'Studio 1',
      note: 'After the warm-up, please',
      status: 'new',
      handledBy: null,
      cancelReason: null,
      onTheWayAt: null,
      deliveredAt: null,
      cancelledAt: null,
      mine: true,
    });
    expect(res.body.createdAt).toBeGreaterThanOrEqual(before);
    expect(res.body.items.map(({ id: _id, ...l }) => l)).toEqual([
      { itemId: item('Tea').id, nameEn: 'Tea', nameAr: 'شاي', qty: 1, options: null },
      { itemId: item('Tea').id, nameEn: 'Tea', nameAr: 'شاي', qty: 1, options: 'no sugar' },
      { itemId: item('Water').id, nameEn: 'Water', nameAr: 'مياه', qty: 2, options: null },
    ]);
    expect(Object.keys(res.body).sort()).toEqual(
      ['by', 'cancelReason', 'cancelledAt', 'createdAt', 'deliveredAt', 'handledBy', 'id', 'items', 'mine', 'note', 'onTheWayAt', 'place', 'status'].sort(),
    );
    expect(t.db.select().from(cafeOrders).all()).toHaveLength(1);
    expect(t.db.select().from(cafeOrderItems).all()).toHaveLength(3);
  });

  it('a configured place is stored the same whichever language it was picked in; anything else as typed; the last place is remembered', async () => {
    const { coach, helper, item } = await cafe();
    const tea = [{ itemId: item('Tea').id }];
    expect((await order(coach, tea, 'استوديو 1')).body.place).toBe('Studio 1');
    expect((await order(coach, tea, ' studio 2 ')).body.place).toBe('Studio 2');
    expect((await order(coach, tea, 'The roof, by the door')).body.place).toBe('The roof, by the door');
    expect((await coach.get<CafeMenu>('/api/cafe/menu')).body.lastPlace).toBe('The roof, by the door');
    expect((await helper.get<CafeMenu>('/api/cafe/menu')).body.lastPlace).toBeNull();
    // Shown in the reader's language.
    expect(cafePlaceLabel('Studio 1', DEFAULT_CAFE_PLACES, 'ar')).toBe('استوديو 1');
    expect(cafePlaceLabel('Studio 1', DEFAULT_CAFE_PLACES, 'en')).toBe('Studio 1');
    expect(cafePlaceLabel('The roof', DEFAULT_CAFE_PLACES, 'ar')).toBe('The roof');
    expect(storedCafePlace('الاستقبال', DEFAULT_CAFE_PLACES)).toBe('Reception');
  });

  it('validation (400): a place, 1–10 lines, 1–10 of each, short texts', async () => {
    const { coach, item } = await cafe();
    const tea = item('Tea').id;
    const bad: unknown[] = [
      { place: 'Office', items: [] },
      { place: '   ', items: [{ itemId: tea, qty: 1 }] },
      { items: [{ itemId: tea, qty: 1 }] },
      { place: 'x'.repeat(81), items: [{ itemId: tea, qty: 1 }] },
      { place: 'Office', note: 'x'.repeat(201), items: [{ itemId: tea, qty: 1 }] },
      { place: 'Office', items: [{ itemId: tea, qty: 0 }] },
      { place: 'Office', items: [{ itemId: tea, qty: 11 }] },
      { place: 'Office', items: [{ itemId: tea, qty: 1.5 }] },
      { place: 'Office', items: [{ itemId: tea, qty: 1, options: 'x'.repeat(61) }] },
      { place: 'Office', items: [{ qty: 1 }] },
      { place: 'Office', items: Array.from({ length: MAX_CAFE_ORDER_LINES + 1 }, () => ({ itemId: tea, qty: 1 })) },
    ];
    for (const body of bad) expect((await coach.post('/api/cafe/orders', body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    // The limits themselves are fine: 10 lines of 10.
    const most = await coach.post<CafeOrder>('/api/cafe/orders', { place: 'x'.repeat(80), note: 'n'.repeat(200), items: Array.from({ length: 10 }, () => ({ itemId: tea, qty: 10, options: 'o'.repeat(60) })) });
    expect(most.status).toBe(201);
    expect(most.body.items).toHaveLength(10);
  });

  it('an item that is not available now, or no longer on the menu, can’t be ordered (409, saying which); nothing is stored', async () => {
    const { t, helper, coach, item } = await cafe();
    await helper.patch(`/api/cafe/menu/${item('Juice').id}`, { available: false });
    await helper.delete(`/api/cafe/menu/${item('Biscuits').id}`);
    const res = await order(coach, [{ itemId: item('Tea').id }, { itemId: item('Juice').id }, { itemId: item('Biscuits').id }]);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'item_unavailable', details: { itemIds: [item('Juice').id, item('Biscuits').id] } } });
    expect(t.db.select().from(cafeOrders).all()).toEqual([]);
    expect(t.db.select().from(notifications).all()).toEqual([]);
    await helper.patch(`/api/cafe/menu/${item('Juice').id}`, { available: true });
    expect((await order(coach, [{ itemId: item('Juice').id }])).status).toBe(201);
  });

  it('at most 10 orders an hour per person (429); a cancelled one still counts; an hour later there is room again', async () => {
    const { t, helper, coach, item } = await cafe();
    const tea = [{ itemId: item('Tea').id }];
    for (let i = 0; i < CAFE_ORDERS_PER_HOUR; i++) expect((await order(coach, tea)).status).toBe(201);
    const first = (await coach.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items.at(-1)!;
    expect((await coach.post(`/api/cafe/orders/${first.id}/cancel`)).status).toBe(200);
    const over = await order(coach, tea);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('too_many_orders');
    // Someone else is not held back by it.
    expect((await order(helper, tea)).status).toBe(201);
    t.db.update(cafeOrders).set({ createdAt: Date.now() - HOUR - 1000 }).where(eq(cafeOrders.id, first.id)).run();
    expect((await order(coach, tea)).status).toBe(201);
    expect((await order(coach, tea)).status).toBe(429);
  });

  it('my orders: only mine, newest first, the newest 20', async () => {
    const { t, coach, helper, item } = await cafe();
    const tea = [{ itemId: item('Tea').id }];
    const a = (await order(coach, tea, 'Office')).body;
    const b = (await order(coach, tea, 'Studio 2')).body;
    const other = await t.as('video_editor');
    await order(other, tea);
    const mine = await coach.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((o) => o.id)).toEqual([b.id, a.id]);
    expect(mine.body.items.every((o) => o.mine && o.by.id === coach.user.id)).toBe(true);
    expect((await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items).toEqual([]);
    expect((await t.anon.get('/api/cafe/orders/mine')).status).toBe(401);
    const many = Array.from({ length: 25 }, () => ({ userId: other.user.id, place: 'Office', status: 'delivered' as const, deliveredAt: 1 }));
    for (const batch of insertBatches(cafeOrders, many)) t.db.insert(cafeOrders).values(batch).run();
    expect((await other.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items).toHaveLength(20);
  });
});

// ── The status machine ──────────────────────────────────────────────────────

describe('an order’s life: new → on the way → delivered, or cancelled', () => {
  it('whoever serves moves it one step at a time; each step is stamped with the time and who did it', async () => {
    const { helper, coach, item } = await cafe();
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    const onTheWay = await move(helper, o.id, 'on_the_way');
    expect(onTheWay.status).toBe(200);
    expect(onTheWay.body).toMatchObject({ status: 'on_the_way', handledBy: { id: helper.user.id, name: 'Sayed Ramadan' }, deliveredAt: null, cancelledAt: null, mine: false });
    expect(onTheWay.body.onTheWayAt).toBeGreaterThanOrEqual(o.createdAt);
    const delivered = await move(helper, o.id, 'delivered');
    expect(delivered.body).toMatchObject({ status: 'delivered', handledBy: { id: helper.user.id }, onTheWayAt: onTheWay.body.onTheWayAt, cancelReason: null });
    expect(delivered.body.deliveredAt).toBeGreaterThanOrEqual(onTheWay.body.onTheWayAt!);
    expect((await coach.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items[0]).toMatchObject({ id: o.id, status: 'delivered', mine: true });
  });

  it('only forward: no step skipped, repeated or taken back; nothing at all after delivered', async () => {
    const { helper, coach, item } = await cafe();
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    const skipped = await move(helper, o.id, 'delivered');
    expect(skipped.status).toBe(409);
    expect(skipped.body.error).toMatchObject({ code: 'not_next_step', details: { order: { id: o.id, status: 'new' } } });
    await move(helper, o.id, 'on_the_way');
    expect((await move(helper, o.id, 'on_the_way')).body.error.code).toBe('not_next_step');
    expect((await helper.post(`/api/cafe/orders/${o.id}/status`, { status: 'new' })).status).toBe(400);
    await move(helper, o.id, 'delivered');
    for (const status of ['on_the_way', 'delivered']) {
      const res = await move(helper, o.id, status);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'order_closed', details: { order: { status: 'delivered' } } });
    }
    expect((await move(helper, o.id, 'cancelled', 'Too late')).body.error.code).toBe('order_closed');
    expect((await coach.post(`/api/cafe/orders/${o.id}/cancel`)).body.error.code).toBe('order_closed');
    expect((await move(helper, 99999, 'on_the_way')).status).toBe(404);
  });

  it('the person who ordered cancels while it is still new — not once it is on the way, and never someone else’s order', async () => {
    const { t, helper, coach, item } = await cafe();
    const tea = [{ itemId: item('Tea').id }];
    const mine = (await order(coach, tea)).body;
    const other = await t.as('video_editor');
    // Someone else's order doesn't exist for them — whoever they are, the helper included (he has "Can't do this one").
    expect((await other.post(`/api/cafe/orders/${mine.id}/cancel`)).status).toBe(404);
    expect((await helper.post(`/api/cafe/orders/${mine.id}/cancel`)).status).toBe(404);
    const cancelled = await coach.post<CafeOrder>(`/api/cafe/orders/${mine.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: null, handledBy: null, mine: true });
    expect(cancelled.body.cancelledAt).toBeGreaterThanOrEqual(mine.createdAt);
    expect((await coach.post(`/api/cafe/orders/${mine.id}/cancel`)).body.error.code).toBe('order_closed');
    expect((await move(helper, mine.id, 'on_the_way')).body.error.code).toBe('order_closed');

    const second = (await order(coach, tea)).body;
    await move(helper, second.id, 'on_the_way');
    const late = await coach.post(`/api/cafe/orders/${second.id}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: 'already_on_the_way', details: { order: { id: second.id, status: 'on_the_way' } } });
    expect((await coach.post('/api/cafe/orders/99999/cancel')).status).toBe(404);
    expect((await coach.post('/api/cafe/orders/abc/cancel')).status).toBe(404);
  });

  it('"Can’t do this one": whoever serves cancels a new order or one on the way, always with a reason the person reads', async () => {
    const { helper, coach, item } = await cafe();
    const tea = [{ itemId: item('Tea').id }];
    const a = (await order(coach, tea)).body;
    for (const reason of [undefined, '', '   ']) {
      const res = await move(helper, a.id, 'cancelled', reason);
      expect(res.status).toBe(400);
      expect(res.body.error.issues?.[0]).toMatchObject({ path: ['reason'], message: 'cafe:errors.reasonRequired' });
    }
    expect((await move(helper, a.id, 'cancelled', 'x'.repeat(201))).status).toBe(400);
    const turnedDown = await move(helper, a.id, 'cancelled', ' No milk left ');
    expect(turnedDown.status).toBe(200);
    expect(turnedDown.body).toMatchObject({ status: 'cancelled', cancelReason: 'No milk left', handledBy: { id: helper.user.id }, onTheWayAt: null });
    expect((await coach.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items[0]).toMatchObject({ status: 'cancelled', cancelReason: 'No milk left' });

    const b = (await order(coach, tea)).body;
    await move(helper, b.id, 'on_the_way');
    expect((await move(helper, b.id, 'cancelled', 'Dropped the tray, sorry')).body).toMatchObject({ status: 'cancelled', cancelReason: 'Dropped the tray, sorry' });
    expect((await move(helper, b.id, 'delivered')).body.error.code).toBe('order_closed');
  });

  it('two people tapping the same card can’t both move it', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    const [first, second] = await Promise.all([move(helper, o.id, 'on_the_way'), move(owner, o.id, 'on_the_way')]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(t.db.select().from(notifications).where(eq(notifications.kind, 'cafe_status')).all()).toHaveLength(1);
  });

  it('the names on an order are copies: renaming or deleting the menu item later changes nothing on it', async () => {
    const { helper, coach, item } = await cafe();
    const o = (await order(coach, [{ itemId: item('Tea').id, qty: 2 }, { itemId: item('Sandwich').id }])).body;
    await helper.patch(`/api/cafe/menu/${item('Tea').id}`, { nameEn: 'Black tea', nameAr: 'شاي أحمر' });
    expect((await helper.delete(`/api/cafe/menu/${item('Sandwich').id}`)).status).toBe(204);
    const after = (await coach.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items[0]!;
    expect(after.items.map(({ id: _id, ...l }) => l)).toEqual([
      { itemId: item('Tea').id, nameEn: 'Tea', nameAr: 'شاي', qty: 2, options: null },
      { itemId: null, nameEn: 'Sandwich', nameAr: 'ساندوتش', qty: 1, options: null },
    ]);
    // The board shows the same, and the order still moves along.
    expect((await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items[0]!.items.map((l) => l.nameEn)).toEqual(['Tea', 'Sandwich']);
    expect((await move(helper, o.id, 'on_the_way')).status).toBe(200);
    // A new order gets the new name.
    expect((await order(coach, [{ itemId: item('Tea').id }])).body.items[0]).toMatchObject({ nameEn: 'Black tea', nameAr: 'شاي أحمر' });
  });
});

// ── Who sees what ───────────────────────────────────────────────────────────

describe('privacy: an order is for the person who ordered and for whoever serves', () => {
  it('the board and the status buttons need cafeteria.serve: the helper and owners, not a coach, not the director', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const director = await t.as('executive_director');
    const other = await t.as('casting_team');
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    for (const who of [coach, director, other]) {
      expect((await who.get('/api/cafe/orders')).status).toBe(403);
      expect((await who.get('/api/cafe/orders?status=new')).status).toBe(403);
      expect((await move(who, o.id, 'on_the_way')).status).toBe(403);
      expect((await move(who, o.id, 'cancelled', 'No')).status).toBe(403);
    }
    expect((await t.anon.get('/api/cafe/orders')).status).toBe(401);
    expect((await t.anon.post(`/api/cafe/orders/${o.id}/status`, { status: 'on_the_way' })).status).toBe(401);
    // Nobody but the coach finds it among their own orders.
    for (const who of [director, other, helper, owner]) expect((await who.get<{ items: CafeOrder[] }>('/api/cafe/orders/mine')).body.items).toEqual([]);
    // Whoever serves sees it — with the orderer's name and photo, an owner's too.
    const karim = (await order(owner, [{ itemId: item('Coffee').id }], 'Office')).body;
    for (const who of [helper, owner]) {
      const board = await who.get<{ items: CafeOrder[] }>('/api/cafe/orders');
      expect(board.status).toBe(200);
      expect(board.body.items.map((x) => x.id)).toEqual([o.id, karim.id]);
    }
    expect((await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items[1]).toMatchObject({ by: { id: owner.user.id, name: owner.user.name }, mine: false });
    expect((await move(owner, o.id, 'on_the_way')).status).toBe(200);
  });

  it('a custom position with cafeteria.serve serves too: it follows the permission, never a position’s name', async () => {
    const { t, coach, item } = await cafe();
    const barista = await t.as({ permissions: ['cafeteria.serve'], name: 'Barista' });
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    expect((await barista.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items.map((x) => x.id)).toEqual([o.id]);
    expect((await move(barista, o.id, 'on_the_way')).status).toBe(200);
    expect((await barista.post('/api/cafe/menu', { nameEn: 'Espresso', category: 'hot' })).status).toBe(201);
  });
});

describe('the orders board (GET /api/cafe/orders)', () => {
  it('open orders first — new, then on the way, oldest first — then today’s delivered and cancelled, newest first; older finished ones are gone from it', async () => {
    const { t, helper, coach, item } = await cafe();
    const tea = [{ itemId: item('Tea').id }];
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push((await order(coach, tea, `Place ${i}`)).body.id);
    const [n1, n2, w1, w2, d1, c1, old] = ids as [number, number, number, number, number, number, number];
    const at = (id: number, minutesAgo: number) => t.db.update(cafeOrders).set({ createdAt: Date.now() - minutesAgo * 60_000 }).where(eq(cafeOrders.id, id)).run();
    // n2 was sent before n1; w2 before w1.
    at(n1, 2);
    at(n2, 9);
    at(w1, 4);
    at(w2, 12);
    for (const id of [w1, w2, d1, old]) await move(helper, id, 'on_the_way');
    await move(helper, d1, 'delivered');
    await move(helper, c1, 'cancelled', 'No cups');
    await move(helper, old, 'delivered');
    // Delivered the day before yesterday (well before the school's midnight).
    t.db.update(cafeOrders).set({ deliveredAt: Date.now() - 49 * HOUR }).where(eq(cafeOrders.id, old)).run();

    const board = (await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items;
    expect(board.map((o) => o.id)).toEqual([n2, n1, w2, w1, c1, d1]);
    expect(board.map((o) => o.status)).toEqual(['new', 'new', 'on_the_way', 'on_the_way', 'cancelled', 'delivered']);
    expect(board.every((o) => o.items.length === 1 && o.by.name === 'Layla Haddad')).toBe(true);

    const only = async (status: string) => (await helper.get<{ items: CafeOrder[] }>(`/api/cafe/orders?status=${status}`)).body.items.map((o) => o.id);
    expect(await only('new')).toEqual([n2, n1]);
    expect(await only('on_the_way')).toEqual([w2, w1]);
    expect(await only('delivered')).toEqual([d1]);
    expect(await only('cancelled')).toEqual([c1]);
    expect((await helper.get('/api/cafe/orders?status=lost')).status).toBe(400);
    // An order left open overnight is still on the board: somebody still has to deal with it.
    t.db.update(cafeOrders).set({ createdAt: Date.now() - 30 * HOUR }).where(eq(cafeOrders.id, n1)).run();
    expect((await only('new'))[0]).toBe(n1);
  });

  it('reads a busy day within the Durable Object limits (more orders than one IN list holds)', async () => {
    const { t, helper, coach, item } = await cafe();
    const rows = Array.from({ length: 150 }, (_, i) => ({ userId: coach.user.id, place: `Room ${i}`, status: 'new' as const }));
    for (const batch of insertBatches(cafeOrders, rows)) t.db.insert(cafeOrders).values(batch).run();
    const stored = t.db.select({ id: cafeOrders.id }).from(cafeOrders).all();
    const lines = stored.map((o) => ({ orderId: o.id, itemId: item('Tea').id, nameEn: 'Tea', nameAr: 'شاي', qty: 1 }));
    for (const batch of insertBatches(cafeOrderItems, lines)) t.db.insert(cafeOrderItems).values(batch).run();
    const board = await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders');
    expect(board.status).toBe(200);
    expect(board.body.items).toHaveLength(150);
    expect(board.body.items.every((o) => o.items.length === 1)).toBe(true);
    expect((await poll(helper)).newOrders).toBe(150);
  });
});

// ── Alerts, push and the poll ───────────────────────────────────────────────

describe('alerts', () => {
  it('a new order alerts everyone active who serves, in their own language — nobody else, and not the person ordering', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner', { name: 'Karim Mansour' });
    const director = await t.as('executive_director');
    const gone = await t.createUser('office_helper', { active: false });
    const o = (await order(coach, [{ itemId: item('Tea').id, qty: 2, options: 'no sugar' }, { itemId: item('Water').id }], 'Studio 1')).body;

    const rows = t.db.select().from(notifications).all();
    expect(rows.map((n) => n.userId).sort()).toEqual([helper.user.id, owner.user.id].sort());
    expect(rows.every((n) => n.kind === 'cafe_order' && n.link === `/cafeteria/board?order=${o.id}` && n.readAt === null)).toBe(true);
    expect(rows.some((n) => n.userId === gone.id || n.userId === director.user.id || n.userId === coach.user.id)).toBe(false);
    // The helper's account is in Arabic: Arabic words, the items' Arabic names, the place's Arabic name.
    const forHelper = (await bell(helper)).items[0]!;
    expect(forHelper).toMatchObject({ kind: 'cafe_order', title: 'طلب جديد من Layla Haddad', body: '2 × شاي (no sugar)، 1 × مياه — إلى استوديو 1', readAt: null });
    expect((await bell(owner)).items[0]).toMatchObject({ title: 'New order from Layla Haddad', body: '2 × Tea (no sugar), 1 × Water — to Studio 1' });
    expect((await bell(helper)).unread).toBe(1);
    expect((await bell(coach)).items).toEqual([]);
    expect((await bell(director)).items).toEqual([]);
    expect(cafeLinesSummary(o.items, 'en')).toBe('2 × Tea (no sugar), 1 × Water');

    // Someone who serves and orders for themselves gets no alert about it; the others who serve do.
    await order(helper, [{ itemId: item('Coffee').id }], 'Office');
    expect((await bell(helper)).items).toHaveLength(1);
    expect((await bell(owner)).items).toHaveLength(2);
  });

  it('on the way, then delivered: the person who ordered has one alert per order, updated and unread again; whoever serves has the new-order alert cleared', async () => {
    const { t, helper, item } = await cafe();
    const owner = await t.as('owner');
    const dalia = await t.as('executive_director', { name: 'Dalia Fathy', locale: 'ar' });
    const o = (await order(dalia, [{ itemId: item('Turkish coffee').id, options: 'مظبوط' }], 'المكتب')).body;
    expect((await bell(helper)).unread).toBe(1);
    expect((await bell(owner)).unread).toBe(1);

    await move(helper, o.id, 'on_the_way');
    // Taken: it leaves every server's bell count, the owner's too.
    expect((await bell(helper)).unread).toBe(0);
    expect((await bell(owner)).unread).toBe(0);
    let mine = await bell(dalia);
    expect(mine.unread).toBe(1);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ kind: 'cafe_status', title: 'طلبك في الطريق', body: '1 × قهوة تركي (مظبوط) — إلى المكتب', link: `/cafeteria?order=${o.id}`, readAt: null });

    await dalia.post('/api/notifications/read', { all: true });
    await move(helper, o.id, 'delivered');
    mine = await bell(dalia);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ kind: 'cafe_status', title: 'تم توصيل طلبك', readAt: null });
    expect(mine.unread).toBe(1);
    expect(t.db.select().from(notifications).where(eq(notifications.kind, 'cafe_status')).all()).toHaveLength(1);
  });

  it('turned down: the person who ordered reads the reason; cancelling your own order tells nobody, and clears it from the servers’ bells', async () => {
    const { helper, coach, item } = await cafe();
    const a = (await order(coach, [{ itemId: item('Juice').id }])).body;
    await move(helper, a.id, 'cancelled', 'No juice today, sorry');
    expect((await bell(coach)).items[0]).toMatchObject({ kind: 'cafe_status', title: 'Sorry, your order can’t be made', body: 'Reason: No juice today, sorry', link: `/cafeteria?order=${a.id}` });
    expect((await bell(helper)).unread).toBe(0);

    const b = (await order(coach, [{ itemId: item('Tea').id }])).body;
    expect((await bell(helper)).unread).toBe(1);
    await coach.post(`/api/cafe/orders/${b.id}/cancel`);
    expect((await bell(helper)).unread).toBe(0);
    expect((await bell(coach)).items).toHaveLength(1);
  });

  it('whoever serves and moves their own order gets no alert about it', async () => {
    const { helper, item } = await cafe();
    const o = (await order(helper, [{ itemId: item('Tea').id }], 'Office')).body;
    await move(helper, o.id, 'on_the_way');
    await move(helper, o.id, 'delivered');
    expect((await bell(helper)).items).toEqual([]);
  });

  it('push: a new order reaches the helper’s phone, each step the phone of the person who ordered — after the response, in their language', async () => {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const { t, helper, coach, item } = await cafe({ config: { vapid }, outboundFetch: push.fetch });
    const helpersPhone = await fakeBrowser('https://fcm.googleapis.com/fcm/send/helper');
    const coachesPhone = await fakeBrowser('https://web.push.apple.com/QGrZ-coach');
    await helper.post('/api/push/subscribe', helpersPhone.subscription);
    await coach.post('/api/push/subscribe', coachesPhone.subscription);

    const o = (await order(coach, [{ itemId: item('Tea').id, qty: 2 }], 'Studio 2')).body;
    await t.settle();
    expect(push.sent.map((s) => s.url)).toEqual([helpersPhone.endpoint]);
    expect(push.sent[0]!.headers.urgency).toBe('high');
    expect(await helpersPhone.decrypt(push.sent[0]!.body)).toEqual({
      title: 'طلب جديد من Layla Haddad',
      body: '2 × شاي — إلى استوديو 2',
      link: `/cafeteria/board?order=${o.id}`,
      kind: 'cafe_order',
      tag: `cafe-order-${o.id}`,
    });

    await move(helper, o.id, 'on_the_way');
    await t.settle();
    expect(push.sent.map((s) => s.url)).toEqual([helpersPhone.endpoint, coachesPhone.endpoint]);
    expect(await coachesPhone.decrypt(push.sent[1]!.body)).toEqual({
      title: 'Your order is on the way',
      body: '2 × Tea — to Studio 2',
      link: `/cafeteria?order=${o.id}`,
      kind: 'cafe_status',
      tag: `cafe-${o.id}`,
    });
    await move(helper, o.id, 'delivered');
    await t.settle();
    expect(await coachesPhone.decrypt(push.sent[2]!.body)).toMatchObject({ title: 'Your order was delivered', kind: 'cafe_status', tag: `cafe-${o.id}` });
    expect(push.sent[2]!.headers.urgency).toBe('normal');
    expect(push.sent).toHaveLength(3);
  });

  it('the 20-second poll carries the cafeteria: switched on, orders waiting for whoever serves, my own open orders', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    expect(await poll(coach)).toEqual({ enabled: true, newOrders: null, myOpenOrders: 0 });
    expect(await poll(helper)).toEqual({ enabled: true, newOrders: 0, myOpenOrders: 0 });
    const a = (await order(coach, [{ itemId: item('Tea').id }])).body;
    const b = (await order(coach, [{ itemId: item('Water').id }])).body;
    expect(await poll(coach)).toEqual({ enabled: true, newOrders: null, myOpenOrders: 2 });
    expect(await poll(helper)).toEqual({ enabled: true, newOrders: 2, myOpenOrders: 0 });
    expect((await poll(owner)).newOrders).toBe(2);
    await move(helper, a.id, 'on_the_way');
    expect(await poll(helper)).toEqual({ enabled: true, newOrders: 1, myOpenOrders: 0 });
    expect((await poll(coach)).myOpenOrders).toBe(2);
    await move(helper, a.id, 'delivered');
    await coach.post(`/api/cafe/orders/${b.id}/cancel`);
    expect(await poll(coach)).toEqual({ enabled: true, newOrders: null, myOpenOrders: 0 });
    expect(await poll(helper)).toEqual({ enabled: true, newOrders: 0, myOpenOrders: 0 });
    // The rest of the poll is as it was.
    const whole = (await helper.get<ChatUnreadResponse>('/api/chat/unread')).body;
    expect(Object.keys(whole).sort()).toEqual(['cafe', 'notifications', 'summons', 'total']);
  });
});

// ── The switch ──────────────────────────────────────────────────────────────

describe('the cafeteriaEnabled setting', () => {
  it('is on by default; settings.manage turns it off and on (nobody else); the places are not lost by it', async () => {
    const { t, helper, coach } = await cafe();
    const director = await t.as('executive_director');
    expect((await coach.get('/api/settings')).body).toMatchObject({ cafeteriaEnabled: true, cafePlaces: DEFAULT_CAFE_PLACES });
    expect((await coach.patch('/api/settings', { cafeteriaEnabled: false })).status).toBe(403);
    expect((await helper.patch('/api/settings', { cafeteriaEnabled: false })).status).toBe(403);
    expect((await director.patch('/api/settings', { cafeteriaEnabled: 'no' })).status).toBe(400);
    const off = await director.patch('/api/settings', { cafeteriaEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ cafeteriaEnabled: false, cafePlaces: DEFAULT_CAFE_PLACES });
    // Saving other settings leaves it alone.
    expect((await director.patch('/api/settings', { weekStartsOn: 6 })).body.cafeteriaEnabled).toBe(false);
    expect((await director.patch('/api/settings', { cafeteriaEnabled: true })).body.cafeteriaEnabled).toBe(true);
  });

  it('off: every cafeteria route answers 409 cafeteria_off, nobody is alerted, the poll says so — and back on, everything is where it was', async () => {
    const { t, helper, coach, item, menu } = await cafe();
    const director = await t.as('executive_director');
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    await director.patch('/api/settings', { cafeteriaEnabled: false });

    const calls: [string, () => Promise<{ status: number; body: any }>][] = [
      ['menu', () => coach.get('/api/cafe/menu')],
      ['order', () => order(coach, [{ itemId: item('Tea').id }])],
      ['mine', () => coach.get('/api/cafe/orders/mine')],
      ['own cancel', () => coach.post(`/api/cafe/orders/${o.id}/cancel`)],
      ['board', () => helper.get('/api/cafe/orders')],
      ['status', () => move(helper, o.id, 'on_the_way')],
      ['add item', () => helper.post('/api/cafe/menu', { nameEn: 'Soup', category: 'food' })],
      ['usual items', () => director.post('/api/cafe/menu/defaults')],
      ['edit item', () => director.patch(`/api/cafe/menu/${item('Tea').id}`, { available: false })],
      ['reorder', () => helper.post('/api/cafe/menu/order', { ids: [item('Tea').id] })],
      ['delete item', () => helper.delete(`/api/cafe/menu/${item('Tea').id}`)],
      ['places', () => director.put('/api/cafe/places', { places: [] })],
    ];
    for (const [what, call] of calls) {
      const res = await call();
      expect(res.status, what).toBe(409);
      expect(res.body.error.code, what).toBe('cafeteria_off');
    }
    // Signed out is still "sign in", and the switch comes before the permission check tells anyone anything.
    expect((await t.anon.get('/api/cafe/menu')).status).toBe(401);
    expect((await coach.get('/api/cafe/orders')).status).toBe(409);
    expect(await poll(helper)).toEqual({ enabled: false, newOrders: null, myOpenOrders: 0 });
    expect(await poll(coach)).toEqual({ enabled: false, newOrders: null, myOpenOrders: 0 });
    expect(t.db.select().from(cafeOrders).all()).toHaveLength(1);

    await director.patch('/api/settings', { cafeteriaEnabled: true });
    expect((await coach.get<CafeMenu>('/api/cafe/menu')).body.items).toEqual(menu);
    expect((await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items.map((x) => x.id)).toEqual([o.id]);
    expect(await poll(helper)).toEqual({ enabled: true, newOrders: 1, myOpenOrders: 0 });
    expect((await move(helper, o.id, 'on_the_way')).status).toBe(200);
  });
});

// ── Tools ───────────────────────────────────────────────────────────────────

describe('the demo reset (db/wipe.ts) covers every table', () => {
  it('WIPE_ORDER names every table in the schema once, children before their parents', () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => v instanceof SQLiteTable);
    expect(tables.length).toBeGreaterThan(35);
    expect(WIPE_ORDER.map(getTableName).sort()).toEqual(tables.map(getTableName).sort());
    const at = (table: SQLiteTable) => WIPE_ORDER.indexOf(table);
    expect(at(cafeOrderItems)).toBeLessThan(at(cafeOrders));
    expect(at(cafeOrderItems)).toBeLessThan(at(cafeItems));
    expect(at(cafeOrders)).toBeLessThan(at(users));
  });

  it('a reset leaves no orders, no menu and no stored places — and the ten built-in positions', async () => {
    const { t, helper, coach, item } = await cafe();
    await helper.put('/api/cafe/places', { places: [{ en: 'Roof' }] });
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    await move(helper, o.id, 'on_the_way');
    await wipeAllData(t.db, t.files);
    for (const table of [cafeOrderItems, cafeOrders, cafeItems, notifications, users]) expect(t.db.select().from(table).all(), getTableName(table)).toEqual([]);
    expect(t.db.select().from(settings).where(eq(settings.key, 'cafePlaces')).all()).toEqual([]);
    expect(t.db.select().from(positions).all().map((p) => p.key)).toEqual(BUILT_IN_POSITIONS.map((p) => p.key));
  });

  it('removing an account removes its orders with it; the helper who handled an order can go while the order stays', async () => {
    const { t, helper, coach, item } = await cafe();
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    await move(helper, o.id, 'on_the_way');
    t.db.delete(users).where(eq(users.id, helper.user.id)).run();
    expect(t.db.select().from(cafeOrders).where(eq(cafeOrders.id, o.id)).get()).toMatchObject({ handledById: null, status: 'on_the_way' });
    t.db.delete(users).where(eq(users.id, coach.user.id)).run();
    expect(t.db.select().from(cafeOrders).all()).toEqual([]);
    expect(t.db.select().from(cafeOrderItems).all()).toEqual([]);
  });
});
