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
import { epochAt } from '../../src/server/lib/clock';
import { generateVapidKeys } from '../../src/server/lib/push/keys';
import { durableObjectLimits, insertBatches } from '../../src/server/lib/sqlLimits';
import {
  BUILT_IN_GRANTS,
  BUILT_IN_GRANTS_SETTING,
  BUILT_IN_POSITIONS,
  LATEST_BUILT_IN_GRANTS_VERSION,
  PERMISSIONS,
  PERMISSION_GROUPS,
  SECTION_PERMISSIONS,
  servesFromBoard,
} from '../../src/shared/permissions';
import {
  CAFE_ORDERS_PER_HOUR,
  DEFAULT_CAFE_PLACES,
  MAX_CAFE_ITEMS,
  MAX_CAFE_ORDER_LINES,
  USUAL_CAFE_ITEMS,
  cafeLinesSummary,
  cafePlaceLabel,
  shiftCafeMonth,
  storedCafePlace,
  type CafeItem,
  type CafeMenu,
  type CafeOrder,
  type CafeReport,
  type CafeReportLine,
} from '../../src/shared/schemas/cafe';
import type { ChatUnreadResponse } from '../../src/shared/schemas/chat';
import type { NotificationsResponse } from '../../src/shared/schemas/notifications';
import type { Position } from '../../src/shared/schemas/positions';
import { makeTestContext, todayISO, type Client } from '../helpers';
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

  it('cafeteria.serve and cafeteria.report: their own group; owners hold both; the Executive Director serves (grant v4, D2) but has no monthly page; nobody else gets either', () => {
    expect(PERMISSIONS).toContain('cafeteria.serve');
    expect(PERMISSIONS).toContain('cafeteria.report');
    expect(PERMISSION_GROUPS.find((g) => g.id === 'cafeteria')?.permissions).toEqual(['cafeteria.serve', 'cafeteria.report']);
    for (const p of BUILT_IN_POSITIONS) {
      const held = p.permissions as readonly string[];
      expect(held.includes('cafeteria.serve'), p.key).toBe(p.isOwner || p.key === 'office_helper' || p.key === 'executive_director');
      expect(held.includes('cafeteria.report'), p.key).toBe(p.isOwner);
    }
    // The released grants are untouched; the director's cafeteria.serve comes as the next one, for databases that exist.
    expect(LATEST_BUILT_IN_GRANTS_VERSION).toBe(4);
    expect(BUILT_IN_GRANTS.map((g) => g.version)).toEqual([1, 2, 3, 4]);
    expect(BUILT_IN_GRANTS.at(-1)).toEqual({ version: 4, grants: { executive_director: ['cafeteria.serve'] } });
    expect(BUILT_IN_GRANTS.slice(0, 3).flatMap((g) => Object.values(g.grants).flat())).not.toContain('cafeteria.serve');
    expect(BUILT_IN_GRANTS.flatMap((g) => Object.values(g.grants).flat())).not.toContain('cafeteria.report');
  });

  it('who serves from the board (D1): cafeteria.serve and no School, Casting or Website section — the Office helper, never an owner or the director', () => {
    const allows = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!.permissions;
    expect(servesFromBoard(allows('office_helper'))).toBe(true);
    for (const key of ['ceo', 'cfo', 'executive_director', 'reception', 'acting_coach']) expect(servesFromBoard(allows(key)), key).toBe(false);
    expect(servesFromBoard(['cafeteria.serve', 'cafeteria.report', 'staff.summon', 'settings.manage'])).toBe(true);
    // Any one permission that opens a section is enough to work in the sections instead.
    for (const section of Object.values(SECTION_PERMISSIONS)) {
      for (const p of section) expect(servesFromBoard(['cafeteria.serve', p]), p).toBe(false);
    }
    expect(servesFromBoard([])).toBe(false);
  });

  it('the migration is found by its tag, comes after the usernames one, and only adds (three tables, their indexes — no rebuild)', () => {
    const tags = bundle.journal.entries.map((e) => e.tag);
    const at = tags.findIndex((tag) => tag.endsWith('_cafeteria'));
    expect(tags.filter((tag) => tag.endsWith('_cafeteria'))).toHaveLength(1);
    expect(tags.slice(0, at)).toEqual(['0000_init', '0001_positions', '0002_created_by', '0003_admissions', '0004_cloudflare', '0005_website', '0006_team', '0007_usernames']);
    const entry = bundle.journal.entries[at]!;
    expect(entry.when).toBeGreaterThan(bundle.journal.entries[at - 1]!.when);
    const text = bundle.migrations[`m${String(entry.idx).padStart(4, '0')}`]!;
    expect(text).toContain('CREATE TABLE `cafe_items`');
    expect(text).toContain('CREATE TABLE `cafe_orders`');
    expect(text).toContain('CREATE TABLE `cafe_order_items`');
    expect(text).not.toMatch(/PRAGMA|DROP|__new_|RENAME|ALTER TABLE/i);
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
        .run(p.key, p.name, p.nameAr, p.isOwner ? 1 : 0, JSON.stringify(p.permissions.filter((x) => !x.startsWith('cafeteria.'))), i * 10);
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
    // The eight it had are exactly as they were — except that the director gained cafeteria.serve (grant v4, D2) and
    // nothing else (not the monthly page) — and so is who holds what.
    const director = before.find((p) => p.key === 'executive_director')!;
    expect(allPositions(db).slice(0, 8)).toEqual(before.map((p) => (p.key === 'executive_director' ? { ...p, permissions: [...p.permissions, 'cafeteria.serve'], updatedAt: expect.any(Number) } : p)));
    expect(byKey(db, 'executive_director')!.permissions).toEqual([...director.permissions, 'cafeteria.serve']);
    expect(byKey(db, 'executive_director')!.permissions).not.toContain('cafeteria.report');
    expect(db.select().from(userPositions).all()).toEqual(holdersBefore);
    expect(builtInGrantsVersion(db)).toBe(4);

    // Every later start: still ten, and the grant ran once — an owner who takes cafeteria.serve from the director again keeps it that way.
    db.update(positions).set({ permissions: director.permissions }).where(eq(positions.key, 'executive_director')).run();
    initDb(db);
    initDb(db);
    expect(allPositions(db)).toHaveLength(10);
    expect(byKey(db, 'executive_director')!.permissions).toEqual(director.permissions);
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

  it('the Executive Director can give Reception and Office helper: she holds cafeteria.serve (D2) — nobody gives access they don’t hold', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const list = (await director.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(list.find((p) => p.key === 'reception')).toMatchObject({ editable: true, assignable: true });
    expect(list.find((p) => p.key === 'office_helper')).toMatchObject({ editable: true, assignable: true });
    const add = (key: 'reception' | 'office_helper') =>
      director.post('/api/staff', { name: 'New Person', email: `${key}@example.com`, password: 'a-long-password', positionIds: [t.positionId(key)] });
    expect((await add('reception')).status).toBe(201);
    expect((await add('office_helper')).status).toBe(201);
    // Someone who manages the team, the positions and the settings but doesn't serve still can't: there is no exception to the rule.
    const manager = await t.as({ permissions: ['staff.manage', 'positions.manage', 'settings.manage'] });
    expect((await manager.get<{ items: Position[] }>('/api/positions')).body.items.find((p) => p.key === 'office_helper')).toMatchObject({ editable: false, assignable: false });
    expect((await manager.post('/api/staff', { name: 'X', email: 'x@example.com', password: 'a-long-password', positionIds: [t.positionId('office_helper')] })).status).toBe(403);
  });

  it('the Executive Director manages the Office helper’s account — password, phone, photo, switching it off — like any other (PERM-1)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const sayed = await t.createUser('office_helper', { name: 'Sayed Ramadan' });
    expect((await director.get<{ manageable: boolean }>(`/api/staff/${sayed.id}`)).body.manageable).toBe(true);
    expect((await director.patch(`/api/staff/${sayed.id}`, { password: 'newpass1234' })).status).toBe(200);
    expect((await director.patch(`/api/staff/${sayed.id}`, { phone: '+20 100 000 0000' })).status).toBe(200);
    expect((await director.patch(`/api/staff/${sayed.id}`, { active: false })).status).toBe(200);
    expect((await director.patch(`/api/staff/${sayed.id}`, { active: true })).status).toBe(200);
    // She may make a position with cafeteria.serve — not one with what she doesn't hold: money, the monthly page.
    expect((await director.post('/api/positions', { name: 'Kitchen', permissions: ['cafeteria.serve'] })).status).toBe(201);
    expect((await director.post('/api/positions', { name: 'Money', permissions: ['payments.manage'] })).status).toBe(403);
    expect((await director.post('/api/positions', { name: 'Accounts', permissions: ['cafeteria.report'] })).status).toBe(403);
    // Without cafeteria.serve — settings.manage or not — the Office helper's account is out of reach.
    const manager = await t.as({ permissions: ['staff.manage', 'settings.manage'] });
    expect((await manager.patch(`/api/staff/${sayed.id}`, { password: 'another1234' })).status).toBe(403);
    // An owner takes cafeteria.serve from the director's position: then his account is out of her reach too.
    const owner = await t.as('owner');
    const directorPosition = t.positionId('executive_director');
    const without = (await owner.get<{ items: Position[] }>('/api/positions')).body.items.find((p) => p.id === directorPosition)!.permissions.filter((p) => p !== 'cafeteria.serve');
    expect((await owner.patch(`/api/positions/${directorPosition}`, { permissions: without })).status).toBe(200);
    expect((await director.patch(`/api/staff/${sayed.id}`, { password: 'third-pass-1234' })).status).toBe(403);
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
  it('the board and the status buttons need cafeteria.serve: the helper, the director (D2) and owners — not a coach, not Reception', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const director = await t.as('executive_director');
    const other = await t.as('casting_team');
    const reception = await t.as('reception');
    const o = (await order(coach, [{ itemId: item('Tea').id }])).body;
    for (const who of [coach, reception, other]) {
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
    for (const who of [helper, owner, director]) {
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
  it('a new order alerts only the Office helpers (D1): active, serving, no section — in their own language; not the owners or the director, not the person ordering', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner', { name: 'Karim Mansour' });
    const cfo = await t.as('cfo');
    const director = await t.as('executive_director');
    const gone = await t.createUser('office_helper', { active: false });
    // A second, English-speaking helper (a custom position: it follows the permissions, never a name) …
    const barista = await t.as({ permissions: ['cafeteria.serve'], name: 'Barista' });
    // … and two who serve but work in a section: no order alerts for them.
    const helperAndCoach = await t.as(['office_helper', 'acting_coach']);
    const serveAndWebsite = await t.as({ permissions: ['cafeteria.serve', 'website.manage'] });
    const o = (await order(coach, [{ itemId: item('Tea').id, qty: 2, options: 'no sugar' }, { itemId: item('Water').id }], 'Studio 1')).body;

    const rows = t.db.select().from(notifications).all();
    expect(rows.map((n) => n.userId).sort()).toEqual([helper.user.id, barista.user.id].sort());
    expect(rows.every((n) => n.kind === 'cafe_order' && n.link === `/cafeteria/board?order=${o.id}` && n.readAt === null)).toBe(true);
    for (const who of [owner, cfo, director, helperAndCoach, serveAndWebsite, coach]) {
      expect((await bell(who)).items, who.user.name).toEqual([]);
      // They can still open the board from the Cafeteria entry, and its count is there for them.
      if (who !== coach) expect((await poll(who)).newOrders, who.user.name).toBe(1);
    }
    expect(rows.some((n) => n.userId === gone.id)).toBe(false);
    // The helper's account is in Arabic: Arabic words, the items' Arabic names, the place's Arabic name.
    const forHelper = (await bell(helper)).items[0]!;
    // "no sugar" is one of the ready-made words, so the helper reads it in Arabic too.
    expect(forHelper).toMatchObject({ kind: 'cafe_order', title: 'طلب جديد من Layla Haddad', body: '2 × شاي (سادة)، 1 × مياه — إلى استوديو 1', readAt: null });
    expect((await bell(barista)).items[0]).toMatchObject({ title: 'New order from Layla Haddad', body: '2 × Tea (No sugar), 1 × Water — to Studio 1' });
    expect((await bell(helper)).unread).toBe(1);
    expect(cafeLinesSummary(o.items, 'en')).toBe('2 × Tea (No sugar), 1 × Water');

    // Someone who serves and orders for themselves gets no alert about it; the others who serve do.
    await order(helper, [{ itemId: item('Coffee').id }], 'Office');
    expect((await bell(helper)).items).toHaveLength(1);
    expect((await bell(barista)).items).toHaveLength(2);
    // An owner's or the director's own order alerts the helpers like anyone's — and still nothing for the other owners.
    await order(director, [{ itemId: item('Tea').id }], 'Office');
    expect((await bell(helper)).items).toHaveLength(2);
    expect((await bell(owner)).items).toEqual([]);
    // The person who ordered still hears about their order: on the way, delivered (unchanged by D1).
    await move(helper, o.id, 'on_the_way');
    expect((await bell(coach)).items[0]).toMatchObject({ kind: 'cafe_status', title: 'Your order is on the way' });
  });

  it('on the way, then delivered: the person who ordered has one alert per order, updated and unread again; whoever serves has the new-order alert cleared', async () => {
    const { t, helper, item } = await cafe();
    const second = await t.as({ permissions: ['cafeteria.serve'] });
    const dalia = await t.as('executive_director', { name: 'Dalia Fathy', locale: 'ar' });
    const o = (await order(dalia, [{ itemId: item('Turkish coffee').id, options: 'مظبوط' }], 'المكتب')).body;
    expect((await bell(helper)).unread).toBe(1);
    expect((await bell(second)).unread).toBe(1);

    await move(helper, o.id, 'on_the_way');
    // Taken: it leaves every server's bell count, the second helper's too.
    expect((await bell(helper)).unread).toBe(0);
    expect((await bell(second)).unread).toBe(0);
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
    const toCoach = push.sent.slice(1).filter((s) => s.url === coachesPhone.endpoint);
    expect(toCoach).toHaveLength(1);
    expect(await coachesPhone.decrypt(toCoach[0]!.body)).toEqual({
      title: 'Your order is on the way',
      body: '2 × Tea — to Studio 2',
      link: `/cafeteria?order=${o.id}`,
      kind: 'cafe_status',
      tag: `cafe-${o.id}`,
    });
    // Taken: "New order from …" on the helper's phone is replaced — same tag and topic — quietly (NIT-3).
    const toHelper = push.sent.slice(1).filter((s) => s.url === helpersPhone.endpoint);
    expect(toHelper).toHaveLength(1);
    expect(await helpersPhone.decrypt(toHelper[0]!.body)).toEqual({
      title: 'طلب Layla Haddad: في الطريق',
      body: '2 × شاي — إلى استوديو 2',
      link: `/cafeteria/board?order=${o.id}`,
      kind: 'cafe_status',
      tag: `cafe-order-${o.id}`,
      quiet: true,
    });
    expect(toHelper[0]!.headers).toMatchObject({ urgency: 'normal', topic: `cafe-order-${o.id}` });
    expect(push.sent[0]!.headers.topic).toBe(`cafe-order-${o.id}`);

    await move(helper, o.id, 'delivered');
    await t.settle();
    expect(push.sent).toHaveLength(4);
    expect(push.sent[3]!.url).toBe(coachesPhone.endpoint);
    expect(await coachesPhone.decrypt(push.sent[3]!.body)).toMatchObject({ title: 'Your order was delivered', kind: 'cafe_status', tag: `cafe-${o.id}` });
    expect(push.sent[3]!.headers.urgency).toBe('normal');
  });

  it('push: an order cancelled by the person who ordered (or turned down) replaces the servers’ "New order" quietly; nothing to the orderer for their own cancel (NIT-3)', async () => {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const { t, helper, coach, item } = await cafe({ config: { vapid }, outboundFetch: push.fetch });
    // A second helper, in English (the "owner" phone below), and an owner whose phone is subscribed too: D1, nothing to the owner.
    const owner = await t.as({ permissions: ['cafeteria.serve'], name: 'Karim' });
    const realOwner = await t.as('owner');
    const helpersPhone = await fakeBrowser('https://fcm.googleapis.com/fcm/send/helper');
    const ownersPhone = await fakeBrowser('https://fcm.googleapis.com/fcm/send/owner');
    const coachesPhone = await fakeBrowser('https://web.push.apple.com/QGrZ-coach');
    const realOwnersPhone = await fakeBrowser('https://fcm.googleapis.com/fcm/send/real-owner');
    await helper.post('/api/push/subscribe', helpersPhone.subscription);
    await owner.post('/api/push/subscribe', ownersPhone.subscription);
    await coach.post('/api/push/subscribe', coachesPhone.subscription);
    await realOwner.post('/api/push/subscribe', realOwnersPhone.subscription);

    const a = (await order(coach, [{ itemId: item('Tea').id }], 'Office')).body;
    await t.settle();
    expect(push.sent.map((s) => s.url).sort()).toEqual([helpersPhone.endpoint, ownersPhone.endpoint].sort());
    push.sent.length = 0;
    await coach.post(`/api/cafe/orders/${a.id}/cancel`);
    await t.settle();
    expect(push.sent.map((s) => s.url).sort()).toEqual([helpersPhone.endpoint, ownersPhone.endpoint].sort());
    const toOwner = push.sent.find((s) => s.url === ownersPhone.endpoint)!;
    expect(await ownersPhone.decrypt(toOwner.body)).toEqual({
      title: 'Order from Layla Haddad: cancelled',
      body: '1 × Tea — to Office',
      link: `/cafeteria/board?order=${a.id}`,
      kind: 'cafe_status',
      tag: `cafe-order-${a.id}`,
      quiet: true,
    });

    // Turned down by the helper: the orderer is told (loud), the servers' "New order" replaced (quiet).
    const b = (await order(coach, [{ itemId: item('Tea').id }], 'Office')).body;
    await t.settle();
    push.sent.length = 0;
    await move(helper, b.id, 'cancelled', 'busy now');
    await t.settle();
    expect(push.sent.map((s) => s.url).sort()).toEqual([coachesPhone.endpoint, helpersPhone.endpoint, ownersPhone.endpoint].sort());
    expect(await ownersPhone.decrypt(push.sent.find((s) => s.url === ownersPhone.endpoint)!.body)).toMatchObject({ title: 'Order from Layla Haddad: cancelled', quiet: true });
    expect(await coachesPhone.decrypt(push.sent.find((s) => s.url === coachesPhone.endpoint)!.body)).toMatchObject({ title: 'Sorry, your order can’t be made', body: 'Reason: busy now' });

    // An order already on the way is no longer on anyone's screen as new: delivering it sends nothing to the servers.
    const c2 = (await order(coach, [{ itemId: item('Tea').id }], 'Office')).body;
    await move(helper, c2.id, 'on_the_way');
    await t.settle();
    push.sent.length = 0;
    await move(helper, c2.id, 'delivered');
    await t.settle();
    expect(push.sent.map((s) => s.url)).toEqual([coachesPhone.endpoint]);
  });

  it('ready-made reasons are kept by their English words and read in each reader’s language; a typed reason stays as typed (UX-12)', async () => {
    const { t, helper, coach, item } = await cafe();
    const dalia = await t.as('acting_coach', { name: 'Dalia', locale: 'ar' });
    // The helper's app is in Arabic: he taps «نعتذر، الصنف غير متوفر الآن».
    const a = (await order(coach, [{ itemId: item('Juice').id }])).body;
    const turned = await move(helper, a.id, 'cancelled', ' نعتذر، الصنف غير متوفر الآن ');
    expect(turned.body.cancelReason).toBe('Sorry, it is not available now');
    expect((await bell(coach)).items[0]).toMatchObject({ body: 'Reason: Sorry, it is not available now' });
    const b = (await order(dalia, [{ itemId: item('Juice').id }])).body;
    await move(helper, b.id, 'cancelled', 'Sorry, the cafeteria is busy right now');
    expect((await bell(dalia)).items[0]).toMatchObject({ title: 'عذرًا، تعذّر تنفيذ طلبك', body: 'السبب: نعتذر، البوفيه مشغول الآن' });
    const c2 = (await order(dalia, [{ itemId: item('Juice').id }])).body;
    expect((await move(helper, c2.id, 'cancelled', 'لا يوجد ثلج')).body.cancelReason).toBe('لا يوجد ثلج');
  });

  it('new-order alerts leave the bell of someone who no longer serves, and come back if they serve again (NIT-1)', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    await order(coach, [{ itemId: item('Tea').id }]);
    expect((await bell(helper)).unread).toBe(1);
    expect((await helper.get<ChatUnreadResponse>('/api/chat/unread')).body.notifications).toBe(1);
    const officeHelper = t.positionId('office_helper');
    expect((await owner.patch(`/api/positions/${officeHelper}`, { permissions: [] })).status).toBe(200);
    expect((await helper.get<ChatUnreadResponse>('/api/chat/unread')).body).toMatchObject({ notifications: 0, cafe: { newOrders: null } });
    expect(await bell(helper)).toEqual({ items: [], unread: 0 });
    await owner.patch(`/api/positions/${officeHelper}`, { permissions: ['cafeteria.serve'] });
    expect((await bell(helper)).unread).toBe(1);
    expect((await bell(helper)).items.map((n) => n.kind)).toEqual(['cafe_order']);
    // Given a section as well, he works there now (D1): the board is no longer his home, and its alerts leave his bell.
    await owner.patch(`/api/positions/${officeHelper}`, { permissions: ['cafeteria.serve', 'students.read'] });
    expect(await bell(helper)).toEqual({ items: [], unread: 0 });
    expect((await poll(helper)).newOrders).toBe(1);
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

// ── The owners' monthly page (D3) ───────────────────────────────────────────

describe('the monthly consumption page (GET /api/cafe/report, cafeteria.report)', () => {
  const report = async (client: Client, month?: string) => client.get<CafeReport & { error: { code: string } }>(`/api/cafe/report${month ? `?month=${month}` : ''}`);
  const deliver = async (helper: Client, id: number) => {
    await move(helper, id, 'on_the_way');
    return move(helper, id, 'delivered');
  };
  const qtys = (lines: CafeReportLine[]) => lines.map((l) => [l.nameEn, l.qty]);

  it('owners only: the CEO and the CFO, or a position given cafeteria.report — not the director, the helper or anyone else; 401 signed out', async () => {
    const { t, helper, coach } = await cafe();
    const accounts = await t.as({ permissions: ['cafeteria.report'] });
    for (const who of [await t.as('owner'), await t.as('cfo'), accounts]) expect((await report(who)).status).toBe(200);
    for (const who of [await t.as('executive_director'), helper, coach, await t.as('reception'), await t.as({ permissions: ['cafeteria.serve', 'settings.manage', 'staff.manage'] })]) {
      expect((await report(who)).status).toBe(403);
    }
    expect((await t.anon.get('/api/cafe/report')).status).toBe(401);
  });

  it('opens on the current month at the school; another month by ?month=YYYY-MM; anything else is a 400', async () => {
    const { t } = await cafe();
    const owner = await t.as('owner');
    const now = (await report(owner)).body;
    expect(now.month).toBe(todayISO().slice(0, 7));
    expect(now.currentMonth).toBe(now.month);
    expect(now).toMatchObject({ people: [], totals: [], orders: 0 });
    expect((await report(owner, '2026-02')).body).toMatchObject({ month: '2026-02', currentMonth: now.month });
    for (const bad of ['2026-13', '2026-1', '26-11', 'november', '2026-11-01']) expect((await report(owner, bad)).status, bad).toBe(400);
    expect(shiftCafeMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftCafeMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftCafeMonth('2026-11', 0)).toBe('2026-11');
  });

  it('per person (by name), the delivered items with how many, and a total per item in menu order; cancelled and open orders don’t count; no prices', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const nour = await t.as('reception', { name: 'Nour Hassan' });
    const a = (await order(coach, [{ itemId: item('Water').id }, { itemId: item('Tea').id, qty: 2 }, { itemId: item('Tea').id, qty: 1, options: 'no sugar' }])).body;
    await deliver(helper, a.id);
    const b = (await order(nour, [{ itemId: item('Tea').id }, { itemId: item('Biscuits').id, qty: 3 }], 'Reception')).body;
    await deliver(helper, b.id);
    // The helper's own tea, delivered by himself: counted like anyone's.
    const own = (await order(helper, [{ itemId: item('Tea').id }], 'Office')).body;
    await deliver(helper, own.id);
    // Turned down, taken back, still on its way, still new: none of it counts.
    const juice = (await order(coach, [{ itemId: item('Juice').id, qty: 5 }])).body;
    await move(helper, juice.id, 'cancelled', 'No juice today');
    const back = (await order(nour, [{ itemId: item('Coffee').id }], 'Reception')).body;
    await nour.post(`/api/cafe/orders/${back.id}/cancel`);
    const coming = (await order(coach, [{ itemId: item('Coffee').id, qty: 4 }])).body;
    await move(helper, coming.id, 'on_the_way');
    await order(coach, [{ itemId: item('Sandwich').id }]);

    const res = await report(owner);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.orders).toBe(3);
    expect(r.people.map((p) => [p.person.name, p.orders])).toEqual([
      ['Layla Haddad', 1],
      ['Nour Hassan', 1],
      ['Sayed Ramadan', 1],
    ]);
    // The same item on two lines (made differently) is one row: 3 teas.
    expect(qtys(r.people[0]!.items)).toEqual([
      ['Tea', 3],
      ['Water', 1],
    ]);
    expect(qtys(r.people[1]!.items)).toEqual([
      ['Tea', 1],
      ['Biscuits', 3],
    ]);
    expect(r.people[0]!.person).toEqual({ id: coach.user.id, name: 'Layla Haddad', photoFileId: null, active: true });
    expect(r.people[0]!.items[0]).toEqual({ itemId: item('Tea').id, nameEn: 'Tea', nameAr: 'شاي', qty: 3 });
    expect(qtys(r.totals)).toEqual([
      ['Tea', 5],
      ['Water', 1],
      ['Biscuits', 3],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/price|cost|amount/i);
  });

  it('a renamed item stays one row under its name now; a deleted one is counted under the names it had, after the menu’s; someone who left is still listed', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const a = (await order(coach, [{ itemId: item('Coffee').id }, { itemId: item('Biscuits').id, qty: 2 }])).body;
    await deliver(helper, a.id);
    await helper.patch(`/api/cafe/menu/${item('Coffee').id}`, { nameEn: 'Filter coffee', nameAr: 'قهوة فلتر' });
    const b = (await order(coach, [{ itemId: item('Coffee').id, qty: 2 }])).body;
    await deliver(helper, b.id);
    await helper.delete(`/api/cafe/menu/${item('Biscuits').id}`);
    expect((await owner.patch(`/api/staff/${coach.user.id}`, { active: false })).status).toBe(200);

    const r = (await report(owner)).body;
    expect(r.people).toHaveLength(1);
    expect(r.people[0]!.person).toMatchObject({ id: coach.user.id, active: false });
    expect(r.people[0]!.orders).toBe(2);
    expect(r.people[0]!.items).toEqual([
      { itemId: item('Coffee').id, nameEn: 'Filter coffee', nameAr: 'قهوة فلتر', qty: 3 },
      { itemId: null, nameEn: 'Biscuits', nameAr: 'بسكويت', qty: 2 },
    ]);
    expect(r.totals).toEqual(r.people[0]!.items);
  });

  it('counts an order in the month it was delivered, at the school’s clock (Cairo), not the server’s (UTC)', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const tz = t.config.timeZone;
    const ids: number[] = [];
    for (const qty of [1, 2, 4]) {
      const o = (await order(coach, [{ itemId: item('Tea').id, qty }])).body;
      await deliver(helper, o.id);
      ids.push(o.id);
    }
    // 31 October at 23:30 in Cairo; 1 November at 00:30 in Cairo (still 31 October in UTC); 30 November at 23:59 in Cairo.
    const when = [epochAt(tz, '2026-10-31', '23:30'), epochAt(tz, '2026-11-01', '00:30'), epochAt(tz, '2026-11-30', '23:59')];
    expect(new Date(when[1]!).toISOString().slice(0, 10)).toBe('2026-10-31');
    ids.forEach((id, i) => t.db.update(cafeOrders).set({ createdAt: when[i]! - 600_000, deliveredAt: when[i]! }).where(eq(cafeOrders.id, id)).run());
    expect(qtys((await report(owner, '2026-10')).body.totals)).toEqual([['Tea', 1]]);
    expect(qtys((await report(owner, '2026-11')).body.totals)).toEqual([['Tea', 6]]);
    expect((await report(owner, '2026-12')).body.orders).toBe(0);
  });

  it('a whole team’s month stays within the Durable Object limits (counted in SQL, people read in slices)', async () => {
    const { t, item } = await cafe();
    const owner = await t.as('owner');
    const people = Array.from({ length: 140 }, (_, i) => ({ email: `p${i}@month.test`, name: `Person ${String(i).padStart(3, '0')}`, passwordHash: 'x' }));
    for (const batch of insertBatches(users, people)) t.db.insert(users).values(batch).run();
    const ids = t.db.select({ id: users.id }).from(users).all().map((u) => u.id).filter((id) => id !== owner.user.id);
    const at = Date.now() - 60_000;
    const orders = ids.flatMap((userId) => [0, 1].map(() => ({ userId, place: 'Office', status: 'delivered' as const, createdAt: at - 60_000, deliveredAt: at })));
    for (const batch of insertBatches(cafeOrders, orders)) t.db.insert(cafeOrders).values(batch).run();
    const stored = t.db.select({ id: cafeOrders.id }).from(cafeOrders).all();
    const lines = stored.flatMap((o) => [
      { orderId: o.id, itemId: item('Tea').id, nameEn: 'Tea', nameAr: 'شاي', qty: 2 },
      { orderId: o.id, itemId: item('Water').id, nameEn: 'Water', nameAr: 'مياه', qty: 1 },
    ]);
    for (const batch of insertBatches(cafeOrderItems, lines)) t.db.insert(cafeOrderItems).values(batch).run();
    const res = await report(owner);
    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(ids.length);
    expect(res.body.orders).toBe(ids.length * 2);
    expect(qtys(res.body.totals)).toEqual([
      ['Tea', ids.length * 4],
      ['Water', ids.length * 2],
    ]);
  });

  it('is part of the cafeteria: 409 cafeteria_off while it is switched off', async () => {
    const { t } = await cafe();
    const owner = await t.as('owner');
    await owner.patch('/api/settings', { cafeteriaEnabled: false });
    const res = await report(owner);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('cafeteria_off');
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

  it('off: every cafeteria route answers 409 cafeteria_off, the poll says so — and back on, the menu and places are where they were', async () => {
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
    // The order that was waiting was closed with the switch (below): it doesn't come back as waiting.
    expect((await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items.map((x) => [x.id, x.status])).toEqual([[o.id, 'cancelled']]);
    expect(await poll(helper)).toEqual({ enabled: true, newOrders: 0, myOpenOrders: 0 });
    expect((await move(helper, o.id, 'on_the_way')).body.error.code).toBe('order_closed');
  });

  it('switching it off cancels what was still open, tells each person who ordered in their language, and clears every bell (SWITCH-1)', async () => {
    const vapid = await generateVapidKeys();
    const push = pushRecorder();
    const { t, helper, coach, item } = await cafe({ config: { vapid }, outboundFetch: push.fetch });
    const owner = await t.as('owner');
    const director = await t.as('executive_director');
    const dalia = await t.as('acting_coach', { name: 'Dalia', locale: 'ar' });
    const coachesPhone = await fakeBrowser('https://web.push.apple.com/QGrZ-coach');
    await coach.post('/api/push/subscribe', coachesPhone.subscription);
    const waiting = (await order(coach, [{ itemId: item('Tea').id }])).body;
    const walking = (await order(dalia, [{ itemId: item('Water').id }])).body;
    const done = (await order(coach, [{ itemId: item('Coffee').id }])).body;
    await move(helper, walking.id, 'on_the_way');
    await move(helper, done.id, 'on_the_way');
    await move(helper, done.id, 'delivered');
    expect((await bell(helper)).unread).toBe(1);
    await t.settle();
    push.sent.length = 0;

    // Saving other settings while it is on closes nothing.
    await director.patch('/api/settings', { weekStartsOn: 6 });
    expect((await poll(helper)).newOrders).toBe(1);

    await director.patch('/api/settings', { cafeteriaEnabled: false });
    const rows = new Map(t.db.select().from(cafeOrders).all().map((r) => [r.id, r]));
    expect(rows.get(waiting.id)).toMatchObject({ status: 'cancelled', cancelReason: 'The cafeteria is closed now' });
    expect(rows.get(walking.id)).toMatchObject({ status: 'cancelled', cancelReason: 'The cafeteria is closed now', handledById: helper.user.id });
    expect(rows.get(done.id)).toMatchObject({ status: 'delivered', cancelReason: null });
    expect((await bell(coach)).items[0]).toMatchObject({ kind: 'cafe_status', title: 'Sorry, your order can’t be made', body: 'Reason: The cafeteria is closed now', link: `/cafeteria?order=${waiting.id}`, readAt: null });
    expect((await bell(dalia)).items[0]).toMatchObject({ title: 'عذرًا، تعذّر تنفيذ طلبك', body: 'السبب: البوفيه مغلق الآن' });
    // Nothing about new orders is left in a bell: not the helper's, not the owner's.
    expect(t.db.select().from(notifications).where(eq(notifications.kind, 'cafe_order')).all().every((n) => n.readAt !== null)).toBe(true);
    expect((await helper.get<ChatUnreadResponse>('/api/chat/unread')).body.notifications).toBe(0);
    expect((await owner.get<ChatUnreadResponse>('/api/chat/unread')).body.notifications).toBe(0);
    await t.settle();
    expect(push.sent.map((s) => s.url)).toEqual([coachesPhone.endpoint]);
    expect(await coachesPhone.decrypt(push.sent[0]!.body)).toMatchObject({ body: 'Reason: The cafeteria is closed now', kind: 'cafe_status' });

    // Off again while off: nothing more happens.
    const before = t.db.select().from(notifications).all();
    await director.patch('/api/settings', { cafeteriaEnabled: false });
    expect(t.db.select().from(notifications).all()).toEqual(before);
  });

  it('while it is off, a new-order alert left unread is not shown or counted (NIT-1)', async () => {
    const { t, helper, coach, item } = await cafe();
    const director = await t.as('executive_director');
    await order(coach, [{ itemId: item('Tea').id }]);
    await director.patch('/api/settings', { cafeteriaEnabled: false });
    // Even one written by hand, unread: hidden while the cafeteria is off.
    t.db.insert(notifications).values({ userId: helper.user.id, kind: 'cafe_order', title: 'x', body: 'y', link: '/cafeteria/board?order=99', createdAt: Date.now() }).run();
    expect(await bell(helper)).toEqual({ items: [], unread: 0 });
    await director.patch('/api/settings', { cafeteriaEnabled: true });
    expect((await bell(helper)).unread).toBe(1);
  });
});

// ── Leaving the team ────────────────────────────────────────────────────────

describe('an account switched off (ABUSE-1)', () => {
  it('cancels that person’s open orders — off the board, out of every bell, not to be carried out — and leaves the rest alone', async () => {
    const { t, helper, coach, item } = await cafe();
    const owner = await t.as('owner');
    const other = await t.as('acting_coach', { name: 'Other' });
    const a = (await order(coach, [{ itemId: item('Tea').id }])).body;
    const b = (await order(coach, [{ itemId: item('Water').id }])).body;
    const c2 = (await order(coach, [{ itemId: item('Juice').id }])).body;
    const theirs = (await order(other, [{ itemId: item('Tea').id }])).body;
    await move(helper, b.id, 'on_the_way');
    await move(helper, c2.id, 'on_the_way');
    await move(helper, c2.id, 'delivered');
    expect((await poll(helper)).newOrders).toBe(2);

    expect((await owner.patch(`/api/staff/${coach.user.id}`, { active: false })).status).toBe(200);
    const board = (await helper.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items;
    const status = new Map(board.map((o) => [o.id, o]));
    expect(status.get(a.id)).toMatchObject({ status: 'cancelled', cancelReason: 'No longer on the team' });
    expect(status.get(b.id)).toMatchObject({ status: 'cancelled', cancelReason: 'No longer on the team' });
    expect(status.get(c2.id)?.status).toBe('delivered');
    expect(status.get(theirs.id)?.status).toBe('new');
    expect((await poll(helper)).newOrders).toBe(1);
    expect((await bell(helper)).unread).toBe(1);
    expect((await move(helper, b.id, 'delivered')).body.error.code).toBe('order_closed');
    // The person who left is not told (they can't sign in), and switching the account on again brings nothing back.
    expect(t.db.select().from(notifications).where(eq(notifications.userId, coach.user.id)).all().filter((n) => n.kind === 'cafe_status')).toHaveLength(2);
    await owner.patch(`/api/staff/${coach.user.id}`, { active: true });
    expect((await poll(helper)).newOrders).toBe(1);
  });
});

// ── The places: one name, one place ─────────────────────────────────────────

describe('the places list (NIT-2)', () => {
  it('refuses two places with the same name in either language (ignoring case and spaces); "other" is a name like any other', async () => {
    const { helper } = await cafe();
    const twice = await helper.put<any>('/api/cafe/places', { places: [{ en: 'Office', ar: 'المكتب' }, { en: ' office ', ar: 'مكتب' }] });
    expect(twice.status).toBe(400);
    expect(twice.body.error.issues).toEqual([expect.objectContaining({ path: ['places', 1, 'en'], message: 'cafe:errors.placeTwice' })]);
    const arabicTwice = await helper.put<any>('/api/cafe/places', { places: [{ en: 'Office', ar: 'المكتب' }, { en: 'Back office', ar: 'المكتب' }] });
    expect(arabicTwice.body.error.issues[0]).toMatchObject({ path: ['places', 1, 'ar'], message: 'cafe:errors.placeTwice' });
    // One place's English name used as another's Arabic name is the same name too.
    expect((await helper.put('/api/cafe/places', { places: [{ en: 'Roof' }, { en: 'Garden', ar: 'roof' }] })).status).toBe(400);
    expect((await helper.put('/api/cafe/places', { places: [{ en: 'Office', ar: 'المكتب' }, { en: 'other', ar: 'أخرى' }] })).status).toBe(200);
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
