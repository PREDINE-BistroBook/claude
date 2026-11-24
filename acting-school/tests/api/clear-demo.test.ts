import Database from 'better-sqlite3';
import { count, eq, sql } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLEAR_DEMO_TABLES, clearDemoConfirmCode, planClearDemo } from '../../src/server/db/clearDemo';
import { createDb, type NodeDB } from '../../src/server/db/client';
import * as schema from '../../src/server/db/schema';
import {
  authSessions,
  cafeItems,
  cafeOrderItems,
  cafeOrders,
  conversationMembers,
  conversations,
  courses,
  fileChunks,
  files,
  loginFailures,
  messageAttachments,
  messages,
  notifications,
  positions,
  pushSubscriptions,
  settings,
  siteCoaches,
  siteWorkshops,
  students,
  userPositions,
  users,
} from '../../src/server/db/schema';
import type { RestoreDeps } from '../../src/server/lib/restorePoint';
import { getSiteContent, hasSiteContent, SITE_FORM_SECRET_SETTING } from '../../src/server/lib/siteContent';
import { insertBatches } from '../../src/server/lib/sqlLimits';
import { nodeRestorePoints } from '../../src/server/nodeRestore';
import { addDays } from '../../src/shared/dates';
import { clearDemoInput, type ClearDemoResult } from '../../src/shared/schemas/admin';
import { DEFAULT_CAFE_PLACES, type CafeItem, type CafeMenu, type CafeOrder } from '../../src/shared/schemas/cafe';
import { DEFAULT_SITE_CONTENT } from '../../src/shared/schemas/site';
import { makeTestContext, todayISO, uploadPng, type Client } from '../helpers';

/**
 * POST /api/admin/clear-demo (db/clearDemo.ts) and the restore endpoints:
 * the operator's tool that deletes every record and every account not kept,
 * and creates the real team with temporary first passwords (Part I3).
 */

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;
type DryRun = Extract<ClearDemoResult, { dryRun: true }>;
type RealRun = Extract<ClearDemoResult, { dryRun: false }>;

const TOKEN = 'test-admin-token-0123456789abcdef';

/** The school's real team (docs/SECTIONS_AND_WEBSITE.md, "The real team"). */
const REAL_TEAM = [
  { name: 'Ahmed Tamam', username: 'ceo', password: 'ahmed789', positions: ['ceo'] },
  { name: 'Abdelrahman Tamam', username: 'cfo', password: 'abdelrahman789', positions: ['cfo'] },
  { name: 'Salma', username: 'salma', password: 'salma789', positions: ['executive_director'] },
  { name: 'Ahmed Abdellah', username: 'ahmed', password: 'ahmed789', positions: ['head_of_casting'] },
  { name: 'Ayman Farouk', username: 'ayman', password: 'ayman789', positions: ['head_of_casting'] },
  { name: 'Mohamed Hamzawy', username: 'hamzawy', password: 'mohamed789', positions: ['casting_team'] },
  { name: 'Taha', username: 'taha', password: 'taha789', positions: ['casting_team'] },
  { name: 'Ali El Gohary', username: 'ali', password: 'ali789', positions: ['video_editor'] },
  { name: 'Moaty', username: 'moaty', password: 'moaty789', positions: ['acting_coach', 'finance'] },
];
const REAL_REQUEST = { create: REAL_TEAM, owner: 'ceo', keepSiteContent: 'contact' };

/** A call to /api/admin/<action> with the bearer token (pass `token: null` for none): no cookie, no X-Requested-With. */
async function admin<T = any>(t: Ctx, action: string, body?: unknown, opts: { token?: string | null; method?: string; headers?: Record<string, string> } = {}) {
  const token = opts.token === undefined ? TOKEN : opts.token;
  const res = await t.anon.raw(`/api/admin/${action}`, {
    method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...opts.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

/** Dry run, then the real run with its code. */
async function clear(t: Ctx, request: Record<string, unknown>) {
  const dry = await admin<DryRun>(t, 'clear-demo', request);
  if (dry.status !== 200) throw new Error(`dry run failed: ${dry.status} ${JSON.stringify(dry.body)}`);
  const real = await admin<RealRun>(t, 'clear-demo', { ...request, dryRun: false, confirm: dry.body.confirm });
  if (real.status !== 200) throw new Error(`real run failed: ${real.status} ${JSON.stringify(real.body)}`);
  return { dry: dry.body, real: real.body };
}

/** Every table of the schema. */
const TABLES = Object.values(schema).filter((v) => !!v && typeof v === 'object' && Symbol.for('drizzle:IsDrizzleTable') in v) as SQLiteTable[];
const nameOf = (table: SQLiteTable) => getTableConfig(table).name;

function rowCounts(t: Ctx): Record<string, number> {
  return Object.fromEntries(TABLES.map((table) => [nameOf(table), t.db.select({ n: count() }).from(table).get()!.n]));
}

/** Every row of every table (file bytes as a hash), to show that nothing at all changed. */
function snapshot(t: Ctx): string {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) out[nameOf(table)] = t.db.select().from(table).all();
  return JSON.stringify(out, (_key, value) =>
    value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data) ? `bytes:${createHash('sha256').update(Buffer.from(value.data)).digest('hex')}` : value,
  );
}

const silently = async <T>(run: () => Promise<T>): Promise<T> => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await run();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
};

const fileBytes = (t: Ctx, fileId: string) => {
  const row = t.db.select().from(files).where(eq(files.id, fileId)).get();
  return row ? t.files.get(row.storageKey) : Promise.resolve(null);
};

// ── The table list ──────────────────────────────────────────────────────────

describe('CLEAR_DEMO_TABLES', () => {
  it('names every table of the schema exactly once — a new table must say what clearing does to its rows', () => {
    const listed = CLEAR_DEMO_TABLES.map((x) => nameOf(x.table));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(TABLES.map(nameOf).sort());
    expect(TABLES.length).toBeGreaterThanOrEqual(36);
  });

  it('is ordered children before parents: no delete leaves a row pointing at nothing', () => {
    const at = new Map(CLEAR_DEMO_TABLES.map((x, i) => [nameOf(x.table), i]));
    const backwards: string[] = [];
    for (const table of TABLES) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        const parent = nameOf(fk.reference().foreignTable as SQLiteTable);
        if (at.get(config.name)! > at.get(parent)!) backwards.push(`${config.name}.${fk.reference().columns[0]!.name} → ${parent}`);
      }
    }
    // The one link that runs the other way is cleared by hand before the accounts go (carryOut).
    expect(backwards).toEqual(['files.uploaded_by → users']);
  });
});

// ── Who may call it ─────────────────────────────────────────────────────────

describe('the token rules are those of every admin route', () => {
  const calls: [string, string, unknown][] = [
    ['POST', 'clear-demo', REAL_REQUEST],
    ['GET', 'restore-point', undefined],
    ['POST', 'restore', { minutesAgo: 5 }],
  ];

  it("without ADMIN_TOKEN the routes don't exist: the same answers as any unknown route", async () => {
    const t = await makeTestContext();
    const before = snapshot(t);
    for (const [method, action, body] of calls) {
      for (const token of [TOKEN, null]) {
        const real = await admin(t, action, body, { method, token, headers: { 'x-requested-with': 'fetch' } });
        const unknown = await admin(t, 'no-such-thing', body, { method, token, headers: { 'x-requested-with': 'fetch' } });
        expect([real.status, real.body], `${method} ${action}`).toEqual([unknown.status, unknown.body]);
        expect(real.status).toBe(404);
      }
    }
    expect(snapshot(t)).toBe(before);
  });

  it('401 without the bearer token or with a wrong one — a signed-in owner is not enough', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const owner = await t.as('owner');
    const before = snapshot(t);
    for (const [method, action, body] of calls) {
      for (const token of [null, 'wrong-token-wrong-token-wrong', TOKEN.slice(0, -1), `${TOKEN}x`]) {
        const res = await admin(t, action, body, { method, token });
        expect(res.status, `${method} ${action} with ${token}`).toBe(401);
        expect(res.body.error.code).toBe('unauthorized');
        expect(res.headers.get('www-authenticate')).toBe('Bearer');
      }
      const withCookie = await admin(t, action, body, { method, token: null, headers: { cookie: owner.cookie!, 'x-requested-with': 'fetch' } });
      expect(withCookie.status).toBe(401);
    }
    expect(snapshot(t)).toBe(before);
    // With the token: no cookie and no X-Requested-With needed (a dry run answers).
    expect((await admin(t, 'clear-demo', { create: [], keep: [owner.user.username], owner: owner.user.username, keepSiteContent: 'all' })).status).toBe(200);
  });
});

// ── What a request may say ──────────────────────────────────────────────────

describe('the request', () => {
  const one = { name: 'Salma', username: 'salma', password: 'salma789', positions: ['executive_director'] };
  const ok = { create: [one], owner: 'salma', keepSiteContent: 'contact' };

  it('is strict: unknown fields, a misspelt dryRun, a username that breaks the rules, an empty password — all 400, nothing changed', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    await t.as('owner');
    const before = snapshot(t);
    const bad = async (body: unknown, path?: (string | number)[], message?: string) => {
      const res = await admin(t, 'clear-demo', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation');
      if (path) expect(res.body.error.issues).toContainEqual(expect.objectContaining({ path, ...(message ? { message } : {}) }));
    };
    await bad({ ...ok, dryrun: false });
    await bad({ ...ok, dryRun: 'false' }, ['dryRun']);
    await bad({ ...ok, force: true });
    await bad({ ...ok, create: [{ ...one, admin: true }] });
    await bad({ ...ok, create: [{ ...one, username: 'ab' }] }, ['create', 0, 'username'], 'errors.usernameInvalid');
    await bad({ ...ok, create: [{ ...one, username: '1salma' }] }, ['create', 0, 'username'], 'errors.usernameInvalid');
    await bad({ ...ok, create: [{ ...one, username: 'salma@turquoisestudio.app' }] }, ['create', 0, 'username'], 'errors.usernameInvalid');
    await bad({ ...ok, create: [{ ...one, username: 'x'.repeat(21) }] }, ['create', 0, 'username']);
    await bad({ ...ok, create: [{ ...one, password: '' }] }, ['create', 0, 'password']);
    await bad({ ...ok, create: [{ ...one, password: 'x'.repeat(201) }] }, ['create', 0, 'password']);
    await bad({ ...ok, create: [{ ...one, positions: [] }] }, ['create', 0, 'positions']);
    await bad({ ...ok, create: [{ ...one, name: ' ' }] }, ['create', 0, 'name']);
    await bad({ ...ok, create: [{ ...one, locale: 'fr' }] }, ['create', 0, 'locale']);
    await bad({ ...ok, create: [{ ...one, email: 'not-an-address' }] }, ['create', 0, 'email']);
    await bad({ ...ok, create: Array.from({ length: 51 }, (_, i) => ({ ...one, username: `user${i}` })) }, ['create']);
    await bad({ ...ok, keep: Array.from({ length: 51 }, (_, i) => `user${i}`) }, ['keep']);
    await bad({ ...ok, keepSiteContent: 'some' }, ['keepSiteContent']);
    await bad({ create: [one], owner: 'salma' }, ['keepSiteContent']);
    await bad({ create: [one], keepSiteContent: 'contact' }, ['owner']);
    await bad({ owner: 'salma', keepSiteContent: 'contact' }, ['create']);
    expect((await admin(t, 'clear-demo', 'not json at all')).status).toBe(400);
    expect(snapshot(t)).toBe(before);

    // A first password may be shorter than the policy: it is temporary.
    const short = await admin<DryRun>(t, 'clear-demo', { ...ok, create: [{ ...one, password: 'x' }] });
    expect(short.status).toBe(200);
    // Names are taken as typed at sign-in: spaces and capitals don't matter.
    const typed = await admin<DryRun>(t, 'clear-demo', { ...ok, create: [{ ...one, username: ' Salma ' }], owner: ' SALMA ' });
    expect(typed.body.accounts.map((a) => a.username)).toEqual(['salma']);
  });

  it('has a code for each thing wrong with the plan — and none of them changes anything', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const boss = await t.as('owner', { username: 'boss', email: 'boss@old.example' });
    await t.createUser('acting_coach', { username: 'coach', email: 'salma@turquoisestudio.app' });
    const before = snapshot(t);
    const refused = async (body: Record<string, unknown>, status: number, code: string) => {
      const res = await admin(t, 'clear-demo', body);
      expect([res.status, res.body.error?.code], JSON.stringify(body)).toEqual([status, code]);
      return res.body.error;
    };

    const position = await refused({ ...ok, create: [{ ...one, positions: ['executive_director', 'janitor', 'Custom 1'] }] }, 400, 'unknown_position');
    expect(position.details).toEqual({ positions: ['janitor', 'Custom 1'] });
    expect(position.issues.map((i: { path: unknown }) => i.path)).toEqual([
      ['create', 0, 'positions', 1],
      ['create', 0, 'positions', 2],
    ]);

    // Two new accounts with one username; a new account with a kept account's username.
    const twice = await refused({ ...ok, create: [one, { ...one, name: 'Another Salma' }] }, 400, 'duplicate_username');
    expect(twice.issues[0].path).toEqual(['create', 1, 'username']);
    await refused({ create: [{ ...one, username: 'boss' }], keep: ['boss'], owner: 'boss', keepSiteContent: 'all' }, 400, 'duplicate_username');

    // Two accounts with one email address: typed twice, or the automatic address of one is a kept account's.
    await refused({ ...ok, create: [{ ...one, email: 'x@studio.example' }, { ...one, username: 'salma2', email: 'X@Studio.example' }] }, 400, 'duplicate_email');
    const auto = await refused({ ...ok, keep: ['coach'] }, 400, 'duplicate_email');
    expect(auto.details).toEqual({ email: 'salma@turquoisestudio.app' });
    expect(auto.issues[0].path).toEqual(['create', 0, 'username']);
    await refused({ ...ok, create: [{ ...one, email: 'boss@old.example' }], keep: ['boss'] }, 400, 'duplicate_email');

    // The owner must be one of the accounts that will exist.
    await refused({ ...ok, owner: 'nobody' }, 400, 'owner_not_listed');
    await refused({ ...ok, owner: 'boss' }, 400, 'owner_not_listed'); // exists today, but is not kept
    await refused({ ...ok, owner: 'salma@elsewhere.example' }, 400, 'owner_not_listed');

    // Somebody has to be able to sign in afterwards.
    await refused({ create: [], owner: 'salma', keepSiteContent: 'contact' }, 400, 'no_accounts');
    await refused({ create: [], keep: [], owner: 'salma', keepSiteContent: 'contact' }, 400, 'no_accounts');

    // `keep` names accounts that exist.
    const unknown = await refused({ ...ok, keep: ['boss', 'ghost', 'nobody@old.example'] }, 400, 'unknown_account');
    expect(unknown.details).toEqual({ names: ['ghost', 'nobody@old.example'] });

    // A real run needs the code of a dry run.
    await refused({ ...ok, dryRun: false }, 400, 'confirm_required');
    await refused({ ...ok, dryRun: false, confirm: 'please' }, 409, 'confirm_mismatch');
    await refused({ ...ok, dryRun: false, confirm: '00000000-00000000' }, 409, 'confirm_mismatch');

    expect(snapshot(t)).toBe(before);
    expect((await boss.get('/api/auth/me')).body.user.username).toBe('boss');

    // A username or an address that only a deleted account has is free for a new one.
    const reuse = await admin<DryRun>(t, 'clear-demo', { create: [{ ...one, username: 'coach', email: 'boss@old.example' }], owner: 'coach', keepSiteContent: 'contact' });
    expect(reuse.status).toBe(200);
    expect(reuse.body.accounts).toEqual([
      { id: null, username: 'coach', email: 'boss@old.example', name: 'Salma', positions: [{ key: 'executive_director', name: 'Executive Director' }, { key: 'ceo', name: 'CEO' }], owner: true, active: true, status: 'created' },
    ]);
    expect(snapshot(t)).toBe(before);
  });
});

// ── The demo school, cleared for the real team ──────────────────────────────

describe('on the demo school (run in order)', () => {
  const DEMO_PASSWORD = 'deployed-demo-password';
  let t: Ctx;
  let director: Client;
  let heroFileId: string;
  let dry: DryRun;
  let real: RealRun;

  beforeAll(async () => {
    // As on Cloudflare: setup needs the setup code.
    t = await makeTestContext({ config: { adminToken: TOKEN, requireSetupCode: true } });
    const seeded = await silently(() => admin(t, 'seed-demo', { password: DEMO_PASSWORD }));
    expect(seeded.status).toBe(201);
    director = await t.login('director', DEMO_PASSWORD);
    // What the demo doesn't have: a main photo on the website, a failed sign-in, a phone with alerts on.
    heroFileId = await uploadPng(director);
    const content = (await director.get('/api/site/content')).body;
    expect((await director.put('/api/site/content', { ...content, heroFileId, published: true })).status).toBe(200);
    expect((await t.anon.post('/api/auth/login', { username: 'director', password: 'not-the-password' })).status).toBe(401);
    // The cafeteria's settings as a school stores them once someone has touched them: a place of their own, the switch saved on.
    expect((await director.put('/api/cafe/places', { places: [...DEFAULT_CAFE_PLACES, { en: 'Roof', ar: 'السطح' }] })).status).toBe(200);
    expect((await director.patch('/api/settings', { cafeteriaEnabled: true })).status).toBe(200);
    const session = t.db.select().from(authSessions).limit(1).get()!;
    t.db.insert(pushSubscriptions).values({ userId: session.userId, sessionId: session.id, endpoint: 'https://fcm.googleapis.com/fcm/send/demo', p256dh: 'key', auth: 'secret' }).run();
  }, 120_000);

  afterAll(() => t?.cleanup());

  it('starts with rows in every table, so "emptied" below means something', () => {
    const empty = Object.entries(rowCounts(t)).filter(([, n]) => n === 0);
    expect(empty).toEqual([]);
  });

  it('a dry run is the default, changes nothing, and gives the plan and a confirm code', async () => {
    const before = snapshot(t);
    const res = await admin<DryRun>(t, 'clear-demo', REAL_REQUEST);
    expect(res.status).toBe(200);
    dry = res.body;
    expect(snapshot(t)).toBe(before);
    expect(dry.dryRun).toBe(true);
    expect(dry.confirm).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
    expect('deleted' in dry || 'restorePoint' in dry).toBe(false);

    // Saying so explicitly is the same; the same request gives the same code, a different one another code.
    expect((await admin<DryRun>(t, 'clear-demo', { ...REAL_REQUEST, dryRun: true })).body).toEqual(dry);
    expect((await admin<DryRun>(t, 'clear-demo', { ...REAL_REQUEST, keep: [] })).body.confirm).toBe(dry.confirm);
    const other = (await admin<DryRun>(t, 'clear-demo', { ...REAL_REQUEST, create: REAL_TEAM.map((a) => (a.username === 'ali' ? { ...a, password: 'ali7894' } : a)) })).body;
    expect(other.confirm).not.toBe(dry.confirm);
    expect(other.willDelete).toEqual(dry.willDelete);
    // A confirm code sent with a dry run is ignored: still a dry run.
    expect((await admin<DryRun>(t, 'clear-demo', { ...REAL_REQUEST, confirm: dry.confirm })).body.dryRun).toBe(true);
    expect(snapshot(t)).toBe(before);

    // The plan: the nine accounts as they will be…
    expect(dry.accounts.map((a) => [a.username, a.email, a.name, a.positions.map((p) => p.key), a.owner, a.status, a.id, a.active])).toEqual(
      REAL_TEAM.map((a) => [a.username, `${a.username}@turquoisestudio.app`, a.name, a.positions, ['ceo', 'cfo'].includes(a.username), 'created', null, true]),
    );
    // …a count for every table that loses rows — all of them, here…
    const counts = rowCounts(t);
    for (const { table, rows } of CLEAR_DEMO_TABLES) {
      if (rows === 'all') expect(dry.willDelete[nameOf(table)], nameOf(table)).toBe(counts[nameOf(table)]);
    }
    expect(dry.willDelete).toMatchObject({ users: counts.users, user_positions: counts.user_positions, files: counts.files, students: 25, courses: 6, leads: 18, site_coaches: 3 });
    // The cafeteria: its orders go (with their lines and alerts), its menu stays — so the menu is no count here.
    expect(dry.willDelete).toMatchObject({ cafe_orders: 7, cafe_order_items: 11 });
    expect(dry.willDelete).not.toHaveProperty('cafe_items');
    // The video pipeline: every video goes, with who is in it and its history (Part L).
    expect(dry.willDelete).toMatchObject({ videos: 10 });
    expect(dry.willDelete.video_events).toBeGreaterThan(10);
    expect(dry.willDelete.video_students).toBeGreaterThan(10);
    expect(Object.keys(dry.willDelete).sort()).toEqual(CLEAR_DEMO_TABLES.filter((x) => x.rows !== 'stay' && x.rows !== 'bytes').map((x) => nameOf(x.table)).sort());
    // …and what happens to the website's content.
    expect(dry.siteContent).toEqual({
      mode: 'contact',
      published: false,
      castingCallOpen: false,
      kept: ['tagline', 'about', 'address', 'mapUrl', 'whatsappWorkshops', 'whatsappCasting', 'phone', 'instagram'],
      links: { kept: 0, removed: 3 },
      mainPhoto: 'removed',
    });
    // Every account that goes, by name — the operator sees whose accounts these are, not just a count.
    const demo = t.db.select().from(users).all();
    expect(dry.willDeleteAccounts.map((a) => [a.id, a.username, a.email, a.name, a.active])).toEqual(demo.sort((a, b) => a.id - b.id).map((u) => [u.id, u.username, u.email, u.name, u.active]));
    expect(dry.willDeleteAccounts.filter((a) => a.owner).map((a) => a.username)).toEqual(['owner', 'cfo']);
    // What to look at twice: the documented plan gives the CEO (an owner) and the Head of Casting one first password.
    expect(dry.warnings).toEqual([
      {
        code: 'shared_password',
        usernames: ['ceo', 'ahmed'],
        owner: true,
        message: expect.stringContaining('ceo, ahmed would share one temporary password'),
      },
      // The demo's CFO account goes and the real CFO takes its username: said, so it can't happen unnoticed.
      { code: 'replaces_account', username: 'cfo', replaces: { id: expect.any(Number), username: 'cfo', name: expect.any(String) }, message: expect.stringContaining('"cfo" is created new') },
    ]);
    // The passwords are in the request, never in the answer.
    for (const a of REAL_TEAM) expect(JSON.stringify(dry)).not.toContain(a.password);
  });

  it('a real run needs that code: none, a wrong one, or the code of another request change nothing', async () => {
    const before = snapshot(t);
    const run = (extra: Record<string, unknown>, request: Record<string, unknown> = REAL_REQUEST) => admin(t, 'clear-demo', { ...request, dryRun: false, ...extra });

    const none = await run({});
    expect([none.status, none.body.error.code]).toEqual([400, 'confirm_required']);
    for (const confirm of ['yes', dry.confirm.slice(0, -1), `${dry.confirm}0`, dry.confirm.split('-').reverse().join('-'), `ffffffff-${dry.confirm.split('-')[1]}`]) {
      const res = await run({ confirm });
      expect([res.status, res.body.error.code], confirm).toEqual([409, 'confirm_mismatch']);
    }
    // The code belongs to the request it was made for: other accounts, another owner, another website choice, a kept account.
    for (const request of [
      { ...REAL_REQUEST, create: REAL_TEAM.slice(0, 8) },
      { ...REAL_REQUEST, create: REAL_TEAM.map((a) => (a.username === 'ali' ? { ...a, password: 'ali7894' } : a)) },
      { ...REAL_REQUEST, create: REAL_TEAM.map((a) => (a.username === 'ali' ? { ...a, positions: ['ceo'] } : a)) },
      { ...REAL_REQUEST, owner: 'cfo' },
      { ...REAL_REQUEST, keepSiteContent: 'all' },
      { ...REAL_REQUEST, keep: ['director'] },
    ]) {
      const res = await run({ confirm: dry.confirm }, request);
      expect([res.status, res.body.error.code], JSON.stringify(request).slice(0, 80)).toEqual([409, 'confirm_mismatch']);
    }
    // No answer hands out the right code.
    expect(JSON.stringify(none.body)).not.toContain(dry.confirm);
    expect(snapshot(t)).toBe(before);
  });

  it('the code also belongs to the data: after any change to the records the run is refused until a fresh dry run', async () => {
    const run = (confirm: string) => admin(t, 'clear-demo', { ...REAL_REQUEST, dryRun: false, confirm });
    const added = await director.post('/api/students', { firstName: 'Late', lastName: 'Arrival' });
    expect(added.status).toBe(201);
    const before = snapshot(t);
    const changed = await run(dry.confirm);
    expect([changed.status, changed.body.error.code]).toEqual([409, 'plan_changed']);
    expect(JSON.stringify(changed.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{8}/);
    expect(snapshot(t)).toBe(before);

    // The fresh dry run counts the new student and has a new code; its first half (the request) is the same.
    const fresh = (await admin<DryRun>(t, 'clear-demo', REAL_REQUEST)).body;
    expect(fresh.willDelete.students).toBe(dry.willDelete.students! + 1);
    expect(fresh.confirm).not.toBe(dry.confirm);
    expect(fresh.confirm.split('-')[0]).toBe(dry.confirm.split('-')[0]);

    // An edit that changes no count but changes what would be kept — the website's words — is a change too.
    const content = (await director.get('/api/site/content')).body;
    await director.put('/api/site/content', { ...content, tagline: { en: 'A new line', ar: content.tagline.ar } });
    const reworded = await run(fresh.confirm);
    expect([reworded.status, reworded.body.error.code]).toEqual([409, 'plan_changed']);
    await director.put('/api/site/content', content);

    // Back to how it was: the first code is good again (the code is the request and the data, nothing else).
    expect((await director.delete(`/api/students/${added.body.id}`)).status).toBe(204);
    expect((await admin<DryRun>(t, 'clear-demo', REAL_REQUEST)).body.confirm).toBe(dry.confirm);

    // Someone signing in, a failed sign-in, a form counter: counted, but no reason to refuse.
    const again = await t.login('coach', DEMO_PASSWORD);
    expect((await t.anon.post('/api/auth/login', { username: 'coach', password: 'wrong' })).status).toBe(401);
    const busy = (await admin<DryRun>(t, 'clear-demo', REAL_REQUEST)).body;
    expect(busy.willDelete.auth_sessions).toBe(dry.willDelete.auth_sessions! + 1);
    expect(busy.willDelete.login_failures).toBeGreaterThan(dry.willDelete.login_failures!);
    expect(busy.confirm).toBe(dry.confirm);
    expect((await again.get('/api/auth/me')).status).toBe(200);
  });

  it('is one transaction: a failure halfway — after the deletes — leaves everything as it was', async () => {
    const before = snapshot(t);
    // The new accounts are inserted after every delete: make that insert fail.
    t.db.run(sql.raw(`CREATE TRIGGER clear_demo_test_boom BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'boom'); END`));
    const failed = await silently(() => admin(t, 'clear-demo', { ...REAL_REQUEST, dryRun: false, confirm: dry.confirm }));
    t.db.run(sql.raw('DROP TRIGGER clear_demo_test_boom'));
    expect(failed.status).toBe(500);
    expect(snapshot(t)).toBe(before);
    // People are still signed in, their files are still there.
    expect((await director.get('/api/students')).body.items).toHaveLength(25);
    expect((await director.raw(`/api/files/${heroFileId}`, { headers: { cookie: director.cookie! } })).status).toBe(200);
    // And the same code still runs it: nothing was used up.
    expect((await admin<DryRun>(t, 'clear-demo', REAL_REQUEST)).body.confirm).toBe(dry.confirm);
  });

  it('the real run deletes exactly what the dry run said, and nothing of the demo is left in any table', async () => {
    const plan = (await admin<DryRun>(t, 'clear-demo', REAL_REQUEST)).body;
    const before = rowCounts(t);
    const positionsBefore = t.db.select().from(positions).all();
    const menuBefore = t.db.select().from(cafeItems).all();
    const settingsBefore = t.db.select().from(settings).all();
    const siteBefore = getSiteContent(t.db);
    const storedKeys = t.db.select({ key: files.storageKey }).from(files).all();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await admin<RealRun>(t, 'clear-demo', { ...REAL_REQUEST, dryRun: false, confirm: plan.confirm });
    const logged = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(res.status).toBe(200);
    real = res.body;
    expect(real.dryRun).toBe(false);
    expect(real.confirm).toBe(plan.confirm);
    expect(real.restorePoint).toBeNull(); // no restore dependency in this test app
    expect('willDelete' in real).toBe(false);
    // One line in the log: counts, never a password or the token.
    expect(logged).toContain('demo cleared');
    expect(logged).not.toContain(TOKEN);
    for (const a of REAL_TEAM) expect(logged + JSON.stringify(real)).not.toContain(a.password);

    // The counts: what the dry run said, and what really went (rows before − rows after, the new accounts' rows apart).
    expect(real.deleted).toEqual(plan.willDelete);
    const after = rowCounts(t);
    const added: Record<string, number> = { users: REAL_TEAM.length, user_positions: REAL_TEAM.reduce((n, a) => n + a.positions.length, 0) };
    for (const [name, n] of Object.entries(real.deleted)) expect(before[name]! - (after[name]! - (added[name] ?? 0)), name).toBe(n);
    expect(real.siteContent).toEqual(plan.siteContent);

    // Every table of the schema: emptied, or holding only what belongs to the new accounts, the settings and the positions.
    const accounts = t.db.select().from(users).all();
    const accountIds = new Set(accounts.map((u) => u.id));
    for (const table of TABLES) {
      const name = nameOf(table);
      const rows = t.db.select().from(table).all() as Record<string, unknown>[];
      switch (name) {
        case 'users':
          expect(accounts.map((u) => u.username)).toEqual(REAL_TEAM.map((a) => a.username));
          break;
        case 'user_positions':
          expect(rows.every((r) => accountIds.has(r.userId as number))).toBe(true);
          expect(rows).toHaveLength(added.user_positions!);
          break;
        case 'positions':
          expect(rows).toEqual(positionsBefore);
          break;
        case 'cafe_items':
          // The cafeteria's menu stays as it was (no order points at it any more).
          expect(rows).toEqual(menuBefore);
          expect(rows).toHaveLength(10);
          break;
        case 'settings':
          expect(rows.filter((r) => r.key !== 'site')).toEqual(settingsBefore.filter((r) => r.key !== 'site'));
          expect(rows.map((r) => r.key)).toContain('site');
          break;
        default:
          // files and file_chunks too: no kept account had a photo, and the website's main photo went.
          expect(rows, `${name} still has rows`).toEqual([]);
      }
    }
    expect((t.db as NodeDB).$client.pragma('foreign_key_check')).toEqual([]);
    for (const { key } of storedKeys) expect(await t.files.get(key)).toBeNull();
    expect(storedKeys.length).toBe(real.deleted.files);

    // The accounts: as planned, each with a temporary password, their own address, the school's language.
    expect(real.accounts.map(({ id: _id, ...a }) => a)).toEqual(plan.accounts.map(({ id: _id, ...a }) => a));
    expect(real.accounts.map((a) => a.id)).toEqual(accounts.map((u) => u.id));
    for (const u of accounts) {
      expect(u).toMatchObject({ email: `${u.username}@turquoisestudio.app`, mustChangePassword: true, active: true, locale: 'en', phone: null, photoFileId: null, lastLoginAt: null });
      expect(u.passwordHash).toMatch(/^scrypt\$/);
    }
    expect(new Set(accounts.map((u) => u.passwordHash)).size).toBe(accounts.length); // "ahmed789" twice: two salts

    // What stays: the school's settings, the forms' secret, the email domain, the positions…
    const settingsNow = Object.fromEntries(t.db.select().from(settings).all().map((r) => [r.key, r.value]));
    expect(settingsNow[SITE_FORM_SECRET_SETTING]).toBe(settingsBefore.find((r) => r.key === SITE_FORM_SECRET_SETTING)!.value);
    expect(settingsNow.builtInGrantsVersion).toBeGreaterThan(0);
    // …the cafeteria's switch and places…
    expect(settingsNow.cafeteriaEnabled).toBe(true);
    expect(settingsNow.cafePlaces).toEqual([...DEFAULT_CAFE_PLACES, { en: 'Roof', ar: 'السطح' }]);
    // …and of the website, the studio's own words and contact lines.
    const site = getSiteContent(t.db);
    expect(site).toEqual({ ...siteBefore, published: false, heroFileId: null, links: [], castingCall: { open: false, intro: { en: '', ar: '' }, lookingFor: { en: '', ar: '' } } });
    // The demo's made-up casting-call copy is gone, so switching the call on can't publish it.
    expect(siteBefore.castingCall.intro.en).not.toBe('');
    expect(site.tagline.en.length + site.about.en.length).toBeGreaterThan(20);
    expect(site.whatsappWorkshops).toBe('01094635959');
    expect(siteBefore.castingCall.open && siteBefore.published && siteBefore.links.length > 0).toBe(true);

    // Everyone from before is signed out and gone.
    expect((await director.get('/api/auth/me')).body.user).toBeNull();
    expect((await director.get('/api/students')).status).toBe(401);
    for (const name of ['director', 'director@demo.school', 'owner', 'coach']) {
      expect((await t.anon.post('/api/auth/login', { username: name, password: DEMO_PASSWORD })).status, name).toBe(401);
    }
    expect((await t.anon.get('/api/auth/me')).body.needsSetup).toBe(false);
  });

  it('the code is spent: the same request again is refused, and a new dry run plans from the new state', async () => {
    const before = snapshot(t);
    const again = await admin(t, 'clear-demo', { ...REAL_REQUEST, dryRun: false, confirm: real.confirm });
    expect([again.status, again.body.error.code]).toEqual([409, 'plan_changed']);
    expect(snapshot(t)).toBe(before);
    const next = (await admin<DryRun>(t, 'clear-demo', { create: [], keep: REAL_TEAM.map((a) => a.username), owner: 'ceo', keepSiteContent: 'all' })).body;
    expect(next.accounts.map((a) => a.status)).toEqual(REAL_TEAM.map(() => 'kept'));
    // Nothing but the failed sign-ins of the people who tried their old names just now.
    expect(Object.entries(next.willDelete).filter(([name, n]) => n !== 0 && name !== 'login_failures')).toEqual([]);
  });

  it('each person signs in by username with the temporary password and must choose their own first', async () => {
    for (const name of ['ali', ' Ali ', 'ali@turquoisestudio.app']) {
      const res = await t.anon.post('/api/auth/login', { username: name, password: 'ali789' });
      expect(res.status, name).toBe(200);
      expect(res.body.user).toMatchObject({ username: 'ali', mustChangePassword: true, isOwner: false });
    }
    expect((await t.anon.post('/api/auth/login', { username: 'ali', password: 'salma789' })).status).toBe(401);

    const ali = await t.login('ali', 'ali789');
    expect((await ali.get('/api/auth/me')).body.user.positions.map((p: { key: string }) => p.key)).toEqual(['video_editor']);
    for (const url of ['/api/students', '/api/team', '/api/dashboard', '/api/settings']) {
      const gated = await ali.get(url);
      expect([gated.status, gated.body.error.code], url).toEqual([403, 'password_change_required']);
    }
    // Not the temporary one again, not a short one.
    expect((await ali.post('/api/auth/choose-password', { newPassword: 'ali789' })).status).toBe(400);
    expect((await ali.post('/api/auth/choose-password', { newPassword: 'ali78945' })).body.user.mustChangePassword).toBe(false);
    expect((await ali.get('/api/students')).status).toBe(200);
    expect((await ali.get('/api/leads')).status).toBe(403); // a video editor, as asked
    expect((await t.anon.post('/api/auth/login', { username: 'ali', password: 'ali789' })).status).toBe(401);

    // Two positions add up (Moaty: acting coach + finance).
    const moaty = (await t.anon.post('/api/auth/login', { username: 'moaty', password: 'moaty789' })).body.user;
    expect(moaty.positions.map((p: { key: string }) => p.key).sort()).toEqual(['acting_coach', 'finance']);
    expect(moaty.permissions).toEqual(expect.arrayContaining(['attendance.write', 'payments.manage']));
  });

  it('the app works afterwards: the owner adds a student, a workshop and an enquiry; Team lists exactly the nine; the website is a preview, not public', async () => {
    const ceo = await t.login('ceo', 'ahmed789');
    expect((await ceo.get('/api/auth/me')).body.user).toMatchObject({ username: 'ceo', name: 'Ahmed Tamam', isOwner: true, mustChangePassword: true });
    expect((await ceo.post('/api/auth/choose-password', { newPassword: 'a-password-of-my-own' })).status).toBe(200);

    // Empty lists everywhere.
    for (const url of ['/api/students', '/api/courses', '/api/talent', '/api/castings', '/api/leads', '/api/casting-applications', '/api/site/coaches', '/api/site/workshops', '/api/notifications']) {
      const list = await ceo.get(url);
      expect([url, list.status, list.body.items]).toEqual([url, 200, []]);
    }
    expect((await ceo.get('/api/dashboard')).status).toBe(200);
    expect((await ceo.get('/api/schedule?from=' + todayISO() + '&to=' + addDays(todayISO(), 6))).status).toBe(200);

    const student = await ceo.post('/api/students', { firstName: 'First', lastName: 'Real' });
    expect(student.status).toBe(201);
    const workshop = await ceo.post('/api/courses', {
      name: 'First real workshop',
      startDate: todayISO(),
      endDate: addDays(todayISO(), 30),
      schedule: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
    });
    expect(workshop.status).toBe(201);
    const enquiry = await ceo.post('/api/leads', { firstName: 'Mona', lastName: 'Asks', phone: '01001234567', source: 'whatsapp' });
    expect(enquiry.status).toBe(201);
    expect((await ceo.post(`/api/courses/${workshop.body.id}/enrollments`, { studentId: student.body.id })).status).toBe(201);

    // The Team page: exactly the nine, for everyone; with their usernames for a manager.
    const team = (await ceo.get('/api/team')).body.items as { name: string }[];
    expect(team.map((p) => p.name).sort()).toEqual(REAL_TEAM.map((a) => a.name).sort());
    const staff = (await ceo.get('/api/staff')).body.items as { username: string; mustChangePassword: boolean; active: boolean }[];
    expect(staff.map((s) => s.username).sort()).toEqual(REAL_TEAM.map((a) => a.username).sort());
    expect(staff.filter((s) => !s.mustChangePassword).map((s) => s.username).sort()).toEqual(['ali', 'ceo']);
    // The other owner is an owner too, and a manager can still add people.
    expect((await t.anon.post('/api/auth/login', { username: 'cfo', password: 'abdelrahman789' })).body.user.isOwner).toBe(true);
    expect((await ceo.post('/api/staff', { name: 'One More', username: 'onemore', positionIds: [t.positionId('acting_coach')], password: 'onemore123' })).status).toBe(201);

    // The website: the switch is off, the previews render (with their banner), the forms' secret still signs.
    expect((await ceo.get('/api/site/content')).body).toMatchObject({ published: false, heroFileId: null, links: [] });
    for (const lang of ['en', 'ar']) {
      const page = await t.anon.raw(`/site/${lang}`, {});
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain('class="preview"');
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect((await t.anon.raw(`/site/${lang}/workshops`, {})).status).toBe(200);
      expect((await t.anon.raw(`/site/${lang}/casting-call`, {})).status).toBe(200);
    }
    expect((await t.anon.raw(`/site/media/${heroFileId}`, {})).status).toBe(404);

    // The cafeteria: the menu and the places are there, no order is; the first real order goes through.
    const menu = (await ceo.get<CafeMenu>('/api/cafe/menu')).body;
    expect(menu.items).toHaveLength(10);
    expect(menu.places).toEqual([...DEFAULT_CAFE_PLACES, { en: 'Roof', ar: 'السطح' }]);
    expect((await ceo.get('/api/cafe/orders')).body.items).toEqual([]);
    expect((await ceo.get('/api/cafe/orders/mine')).body.items).toEqual([]);
    const tea = menu.items.find((i) => i.nameEn === 'Tea')!;
    expect((await ceo.post('/api/cafe/orders', { place: 'Roof', items: [{ itemId: tea.id, qty: 1 }] })).status).toBe(201);
    expect((t.db as NodeDB).$client.pragma('foreign_key_check')).toEqual([]);
  });
});

// ── Each new account's language ─────────────────────────────────────────────

describe('a new account’s language ("locale" in create)', () => {
  it('is honoured from the first sign-in: an Arabic account is Arabic while it still has to choose its password, and after; without one, the school’s language', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const owner = await t.as('owner');
    const team = [
      { name: 'Ahmed Tamam', username: 'ceo', password: 'first-ceo', positions: ['ceo'] },
      { name: 'Taha', username: 'taha', password: 'first-taha', positions: ['casting_team'], locale: 'ar' },
      { name: 'Ali El Gohary', username: 'ali', password: 'first-ali', positions: ['video_editor'], locale: 'en' },
    ];
    // The school's language is Arabic: an account without "locale" gets it; "en" stays English.
    expect((await owner.patch('/api/settings', { defaultLocale: 'ar' })).status).toBe(200);
    await silently(() => clear(t, { create: team, owner: 'ceo', keepSiteContent: 'contact' }));
    const stored = Object.fromEntries(t.db.select({ username: users.username, locale: users.locale }).from(users).all().map((u) => [u.username, u.locale]));
    expect(stored).toEqual({ ceo: 'ar', taha: 'ar', ali: 'en' });

    // Taha's first sign-in: the answer the app sets its language from says Arabic, on the temporary password,
    // and so does /auth/me — the one place the first-password screen reads (everything else is closed to him).
    const signIn = await t.anon.post('/api/auth/login', { username: 'taha', password: 'first-taha' });
    expect(signIn.status).toBe(200);
    expect(signIn.body.user).toMatchObject({ username: 'taha', locale: 'ar', mustChangePassword: true });
    const taha = await t.login('taha', 'first-taha');
    expect((await taha.get('/api/auth/me')).body.user).toMatchObject({ locale: 'ar', mustChangePassword: true });
    expect((await taha.get('/api/team')).body.error.code).toBe('password_change_required');
    // A refusal on the screen comes back as a message key: the screen shows it in Arabic.
    const again = await taha.post('/api/auth/choose-password', { newPassword: 'first-taha' });
    expect([again.status, again.body.error.issues[0].message]).toEqual([400, 'errors.passwordSameAsTemporary']);
    expect((await taha.post('/api/auth/choose-password', { newPassword: 'taha-own-pass' })).body.user).toMatchObject({ locale: 'ar', mustChangePassword: false });
    expect((await t.login('ali', 'first-ali').then((c) => c.get('/api/auth/me'))).body.user.locale).toBe('en');
  });
});

// ── The cafeteria (Part J): orders go, the menu and its settings stay ───────

describe('the cafeteria', () => {
  const team = [
    { name: 'Ahmed Tamam', username: 'ceo', password: 'first-ceo', positions: ['ceo'] },
    { name: 'Salma', username: 'salma', password: 'first-salma', positions: ['executive_director'] },
    { name: 'Sayed', username: 'sayed', password: 'first-sayed', positions: ['office_helper'], locale: 'ar' },
  ];
  const request = { create: team, owner: 'ceo', keepSiteContent: 'contact' };
  const PLACES = [{ en: 'Office', ar: 'المكتب' }, { en: 'Roof', ar: 'السطح' }];

  it('deletes every order (their lines and their alerts too), keeps the menu, the switch and the places; counted in the dry run and the code', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const owner = await t.as('owner');
    const helper = await t.as('office_helper', { name: 'Old Helper' });
    const coach = await t.as('acting_coach', { name: 'Old Coach' });
    const menu = (await helper.post<{ items: CafeItem[] }>('/api/cafe/menu/defaults')).body.items;
    const tea = menu.find((i) => i.nameEn === 'Tea')!;
    const water = menu.find((i) => i.nameEn === 'Water')!;
    expect((await helper.put('/api/cafe/places', { places: PLACES })).status).toBe(200);
    expect((await owner.patch('/api/settings', { cafeteriaEnabled: true })).status).toBe(200);
    // An order on its way (two lines), one the coach cancelled, one turned down by the helper.
    const order = async (items: { itemId: number; qty: number }[]) => (await coach.post<CafeOrder>('/api/cafe/orders', { place: 'Office', items })).body;
    const onTheWay = await order([{ itemId: tea.id, qty: 2 }, { itemId: water.id, qty: 1 }]);
    expect((await helper.post(`/api/cafe/orders/${onTheWay.id}/status`, { status: 'on_the_way' })).status).toBe(200);
    const cancelled = await order([{ itemId: tea.id, qty: 1 }]);
    expect((await coach.post(`/api/cafe/orders/${cancelled.id}/cancel`)).status).toBe(200);
    const turnedDown = await order([{ itemId: water.id, qty: 1 }]);
    expect((await helper.post(`/api/cafe/orders/${turnedDown.id}/status`, { status: 'cancelled', reason: 'No water today' })).status).toBe(200);
    const cafeAlerts = () => t.db.select().from(notifications).where(sql`${notifications.kind} like 'cafe_%'`).all();
    expect(cafeAlerts().length).toBeGreaterThan(0);
    const menuBefore = t.db.select().from(cafeItems).all();
    const settingsBefore = t.db.select().from(settings).all();

    // The dry run counts the orders and their lines like every emptied table; the menu is not among them.
    const dry = (await admin<DryRun>(t, 'clear-demo', request)).body;
    expect(dry.willDelete).toMatchObject({ cafe_orders: 3, cafe_order_items: 4 });
    expect(dry.willDelete.notifications).toBe(t.db.select({ n: count() }).from(notifications).get()!.n);
    expect(dry.willDelete).not.toHaveProperty('cafe_items');

    // An order placed after the dry run changes the plan: refused, nothing changed.
    const late = await order([{ itemId: tea.id, qty: 1 }]);
    const before = snapshot(t);
    const refused = await admin(t, 'clear-demo', { ...request, dryRun: false, confirm: dry.confirm });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'plan_changed']);
    expect(snapshot(t)).toBe(before);
    // A fresh dry run counts it, with a new code.
    const fresh = (await admin<DryRun>(t, 'clear-demo', request)).body;
    expect(fresh.willDelete).toMatchObject({ cafe_orders: 4, cafe_order_items: 5 });
    expect(fresh.confirm).not.toBe(dry.confirm);

    // The real run.
    const real = await silently(() => admin<RealRun>(t, 'clear-demo', { ...request, dryRun: false, confirm: fresh.confirm }));
    expect(real.status).toBe(200);
    expect(real.body.deleted).toEqual(fresh.willDelete);
    expect(t.db.select().from(cafeOrders).all()).toEqual([]);
    expect(t.db.select().from(cafeOrderItems).all()).toEqual([]);
    expect(cafeAlerts()).toEqual([]);
    expect(t.db.select().from(cafeItems).all()).toEqual(menuBefore);
    expect(t.db.select().from(settings).all().filter((r) => r.key !== 'site')).toEqual(settingsBefore.filter((r) => r.key !== 'site'));
    expect((t.db as NodeDB).$client.pragma('foreign_key_check')).toEqual([]);
    expect(late.id).toBeGreaterThan(turnedDown.id);

    // The new team: the director orders from the kept menu to a kept place; the new helper (in Arabic) sees only that order.
    const salma = await t.login('salma', 'first-salma');
    expect((await salma.post('/api/auth/choose-password', { newPassword: 'salma-own-pass' })).status).toBe(200);
    const kept = (await salma.get<CafeMenu>('/api/cafe/menu')).body;
    expect(kept.items.map((i) => i.id)).toEqual(menu.map((i) => i.id));
    expect(kept.places).toEqual(PLACES);
    expect((await salma.get('/api/cafe/orders/mine')).body.items).toEqual([]);
    const first = await salma.post<CafeOrder>('/api/cafe/orders', { place: 'Roof', items: [{ itemId: tea.id, qty: 1 }] });
    expect(first.status).toBe(201);
    const sayed = await t.login('sayed', 'first-sayed');
    expect((await sayed.post('/api/auth/choose-password', { newPassword: 'sayed-own-pass' })).status).toBe(200);
    expect((await sayed.get('/api/auth/me')).body.user.locale).toBe('ar');
    expect((await sayed.get<{ items: CafeOrder[] }>('/api/cafe/orders')).body.items.map((o) => o.id)).toEqual([first.body.id]);
  });
});

// ── Accounts that are kept, and the owner ───────────────────────────────────

describe('a confirm code works once', () => {
  const team = [
    { name: 'Ahmed Tamam', username: 'ceo', password: 'first-ceo', positions: ['ceo'] },
    { name: 'Abdelrahman Tamam', username: 'cfo', password: 'first-cfo', positions: ['cfo'] },
    { name: 'Salma', username: 'salmaa', password: 'first-salma', positions: ['executive_director'] },
  ];

  it('a second clear, sent again (shell history, a retry), is refused: it would delete the accounts it created and bring their temporary passwords back', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    await t.as('owner');
    await silently(() => clear(t, { create: team, owner: 'ceo', keepSiteContent: 'contact' }));
    // A second clear from the cleared school, to fix a username in the list.
    const fixed = { create: team.map((a) => (a.username === 'salmaa' ? { ...a, username: 'salma' } : a)), owner: 'ceo', keepSiteContent: 'contact' };
    const second = await silently(() => clear(t, fixed));
    // The team signs in and chooses their own passwords; the CEO sets Arabic and a phone.
    for (const a of fixed.create) {
      const c = await t.login(a.username, a.password);
      expect((await c.post('/api/auth/choose-password', { newPassword: `own-${a.username}-pass` })).status).toBe(200);
      if (a.username === 'ceo') expect((await c.patch('/api/auth/profile', { locale: 'ar', phone: '0100 123 4567' })).status).toBe(200);
    }
    const before = snapshot(t);
    // The second run's request and code, sent again: the data looks the same (counts, website), but the accounts are new.
    const replay = await silently(() => admin(t, 'clear-demo', { ...fixed, dryRun: false, confirm: second.real.confirm }));
    expect([replay.status, replay.body.error.code]).toEqual([409, 'plan_changed']);
    expect(snapshot(t)).toBe(before);
    expect((await t.anon.post('/api/auth/login', { username: 'salma', password: 'first-salma' })).status).toBe(401);
    expect((await t.anon.post('/api/auth/login', { username: 'salma', password: 'own-salma-pass' })).status).toBe(200);
    // A fresh dry run names the accounts that would go — the ones the second run created.
    const fresh = (await admin<DryRun>(t, 'clear-demo', fixed)).body;
    expect(fresh.willDeleteAccounts.map((a) => a.id)).toEqual(second.real.accounts.map((a) => a.id));
    expect(fresh.confirm).not.toBe(second.real.confirm);
  });

  it('a record deleted and another added between the dry run and the real run is a change, though every count is the same', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const owner = await t.as('owner');
    const first = await owner.post('/api/students', { firstName: 'First', lastName: 'Student' });
    const request = { create: team, owner: 'ceo', keepSiteContent: 'contact' };
    const dry = (await admin<DryRun>(t, 'clear-demo', request)).body;
    expect((await owner.delete(`/api/students/${first.body.id}`)).status).toBe(204);
    expect((await owner.post('/api/students', { firstName: 'Second', lastName: 'Student' })).status).toBe(201);
    expect((await admin<DryRun>(t, 'clear-demo', request)).body.willDelete).toEqual(dry.willDelete);
    const run = await admin(t, 'clear-demo', { ...request, dryRun: false, confirm: dry.confirm });
    expect([run.status, run.body.error.code]).toEqual([409, 'plan_changed']);
  });
});

describe('what the dry run says about the accounts that go', () => {
  it('names each one; a created account that takes the name of one that goes is a warning (it may belong under keep)', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const owner = await t.as('owner', { username: 'boss', email: 'boss@old.example', name: 'Old Owner' });
    // A real coach who signed in and chose a password: "moaty".
    const added = await owner.post('/api/staff', { name: 'معطي', username: 'moaty', email: 'moaty@example.com', positionIds: [t.positionId('acting_coach'), t.positionId('finance')], password: 'temporary1' });
    expect(added.status).toBe(201);
    const moaty = await t.login('moaty', 'temporary1');
    expect((await moaty.post('/api/auth/choose-password', { newPassword: 'moaty-chose-this' })).status).toBe(200);
    const request = {
      create: [
        { name: 'Ahmed Tamam', username: 'ceo', password: 'first-ceo', positions: ['ceo'] },
        { name: 'Moaty', username: 'moaty', password: 'first-moaty', positions: ['acting_coach', 'finance'] },
        { name: 'Someone', username: 'someone', password: 'first-x', positions: ['casting_team'], email: 'BOSS@old.example' },
      ],
      owner: 'ceo',
      keepSiteContent: 'contact',
    };
    const before = snapshot(t);
    const dry = (await admin<DryRun>(t, 'clear-demo', request)).body;
    expect(snapshot(t)).toBe(before);
    expect(dry.willDeleteAccounts).toEqual([
      { id: owner.user.id, username: 'boss', email: 'boss@old.example', name: 'Old Owner', active: true, owner: true },
      { id: added.body.id, username: 'moaty', email: 'moaty@example.com', name: 'معطي', active: true, owner: false },
    ]);
    expect(dry.warnings.map((w) => [w.code, 'username' in w ? w.username : null, 'replaces' in w ? w.replaces : null])).toEqual([
      ['replaces_account', 'moaty', { id: added.body.id, username: 'moaty', name: 'معطي' }],
      // Matched by the email address too.
      ['replaces_account', 'someone', { id: owner.user.id, username: 'boss', name: 'Old Owner' }],
    ]);
    // Kept instead, it is no warning and no deletion — and its own password stays.
    const keeping = (await admin<DryRun>(t, 'clear-demo', { ...request, create: request.create.filter((a) => a.username !== 'moaty'), keep: ['moaty'] })).body;
    expect(keeping.willDeleteAccounts.map((a) => a.username)).toEqual(['boss']);
    expect(keeping.warnings.map((w) => w.code)).toEqual(['replaces_account']);
    // The real run answers the same list, as it was.
    const { real } = await silently(() => clear(t, request));
    expect(real.deletedAccounts).toEqual(dry.willDeleteAccounts);
    expect(real.warnings).toEqual(dry.warnings);
    expect((await t.anon.post('/api/auth/login', { username: 'moaty', password: 'moaty-chose-this' })).status).toBe(401);
  });

  it('shared temporary passwords are a warning, compared as scrypt sees them; an owner among them is said', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    await t.as('owner');
    const create = [
      { name: 'Ahmed Tamam', username: 'ceo', password: 'ahmed-first', positions: ['ceo'] },
      { name: 'Ahmed Abdellah', username: 'ahmed', password: 'ahmed-first', positions: ['head_of_casting'] },
      { name: 'Taha', username: 'taha', password: 'taha-first', positions: ['casting_team'] },
      { name: 'Ali', username: 'ali', password: 'ｔａｈａ-first', positions: ['video_editor'] },
      { name: 'Salma', username: 'salma', password: 'salma-first', positions: ['executive_director'] },
    ];
    const dry = (await admin<DryRun>(t, 'clear-demo', { create, owner: 'ceo', keepSiteContent: 'none' })).body;
    expect(dry.warnings.filter((w) => w.code === 'shared_password').map((w) => ('usernames' in w ? [w.usernames, w.owner] : null))).toEqual([
      [['ceo', 'ahmed'], true],
      [['taha', 'ali'], false],
    ]);
    for (const a of create) expect(JSON.stringify(dry.warnings)).not.toContain(a.password);
    // Each with a password of its own: nothing to say.
    const own = (await admin<DryRun>(t, 'clear-demo', { create: create.map((a) => ({ ...a, password: `${a.username}-own` })), owner: 'ceo', keepSiteContent: 'none' })).body;
    expect(own.warnings.filter((w) => w.code === 'shared_password')).toEqual([]);
    // A warning doesn't stop the run: the request is the operator's, and the code covers it as it was looked at.
    const real = await silently(() => admin<RealRun>(t, 'clear-demo', { create, owner: 'ceo', keepSiteContent: 'none', dryRun: false, confirm: dry.confirm }));
    expect(real.status).toBe(200);
    expect(real.body.warnings).toEqual(dry.warnings);
  });
});

describe('kept accounts and the owner', () => {
  /** An owner who goes, a director who stays (photo, a position of the school's own, Arabic), a deactivated coach, and records around them. */
  async function school(opts: Parameters<typeof makeTestContext>[0] = {}) {
    const t = await makeTestContext({ ...opts, config: { adminToken: TOKEN, ...opts.config } });
    const goner = await t.as('owner', { username: 'goner', email: 'goner@old.example' });
    const keeper = await t.as('executive_director', { username: 'keeper', email: 'keeper@old.example', name: 'Kept Person', locale: 'ar', phone: '0100 000 0000' });
    const custom = t.db.insert(positions).values({ name: 'Front desk', permissions: ['students.read'], sortOrder: 500 }).returning().get();
    t.db.insert(userPositions).values({ userId: keeper.user.id, positionId: custom.id }).run();
    const sleeper = await t.createUser('acting_coach', { username: 'sleeper', email: 'sleeper@old.example', active: false });
    // The keeper's photo was set by the owner who goes; the owner has one of their own.
    const keeperPhoto = await uploadPng(goner);
    expect((await goner.put(`/api/staff/${keeper.user.id}/photo`, { fileId: keeperPhoto })).status).toBe(200);
    const gonerPhoto = await uploadPng(goner);
    expect((await goner.put('/api/auth/photo', { fileId: gonerPhoto })).status).toBe(200);
    // A student with a photo, a chat between the two with an attachment, an upload never attached.
    const studentPhoto = await uploadPng(keeper);
    expect((await keeper.post('/api/students', { firstName: 'Demo', lastName: 'Student', photoFileId: studentPhoto })).status).toBe(201);
    const attachment = await uploadPng(keeper);
    const conversation = t.db.insert(conversations).values({ pairKey: `${goner.user.id}:${keeper.user.id}` }).returning().get();
    t.db.insert(conversationMembers).values([{ conversationId: conversation.id, userId: goner.user.id }, { conversationId: conversation.id, userId: keeper.user.id }]).run();
    const message = t.db.insert(messages).values({ conversationId: conversation.id, senderId: keeper.user.id, body: 'hello' }).returning().get();
    t.db.insert(messageAttachments).values({ messageId: message.id, fileId: attachment, kind: 'photo' }).run();
    const loose = await uploadPng(keeper);
    return { t, goner, keeper, sleeper, custom, files: { keeperPhoto, gonerPhoto, studentPhoto, attachment, loose } };
  }

  it('a kept account keeps its name, positions, password, language and photo — and is signed out; the rest go', async () => {
    const s = await school();
    const { t } = s;
    const keeperBefore = t.db.select().from(users).where(eq(users.id, s.keeper.user.id)).get()!;
    const keptPhotoKey = t.db.select().from(files).where(eq(files.id, s.files.keeperPhoto)).get()!.storageKey;
    const otherKeys = t.db.select().from(files).all().filter((f) => f.id !== s.files.keeperPhoto).map((f) => f.storageKey);

    // By username and by email address, in any case; naming one account twice is one account.
    const request = {
      create: [{ name: 'New Coach', username: 'newbie', password: 'new123', positions: ['acting_coach'], locale: 'ar', email: 'New.Coach@Example.com' }],
      keep: ['Keeper', 'SLEEPER@old.example', 'keeper@old.example'],
      owner: 'keeper',
      keepSiteContent: 'none',
    };
    const { dry, real } = await silently(() => clear(t, request));
    expect(dry.willDelete).toMatchObject({ users: 1, user_positions: 1, files: 4, students: 1, messages: 1, message_attachments: 1, conversations: 1, conversation_members: 2, auth_sessions: 2 });
    expect(real.deleted).toEqual(dry.willDelete);
    expect(real.accounts).toEqual([
      {
        id: s.keeper.user.id,
        username: 'keeper',
        email: 'keeper@old.example',
        name: 'Kept Person',
        // Not an owner before: given the CEO position, beside the ones they had.
        positions: [{ key: 'executive_director', name: 'Executive Director' }, { key: null, name: 'Front desk' }, { key: 'ceo', name: 'CEO' }],
        owner: true,
        active: true,
        status: 'kept',
      },
      { id: s.sleeper.id, username: 'sleeper', email: 'sleeper@old.example', name: s.sleeper.name, positions: [{ key: 'acting_coach', name: 'Acting coach' }], owner: false, active: false, status: 'kept' },
      { id: expect.any(Number), username: 'newbie', email: 'new.coach@example.com', name: 'New Coach', positions: [{ key: 'acting_coach', name: 'Acting coach' }], owner: false, active: true, status: 'created' },
    ]);
    expect(dry.accounts).toEqual(real.accounts.map((a) => (a.status === 'created' ? { ...a, id: null } : a)));

    // The kept account's row is as it was (only its updated_at may move — it did not: nothing was written to it).
    expect(t.db.select().from(users).where(eq(users.id, s.keeper.user.id)).get()).toEqual(keeperBefore);
    expect(t.db.select().from(users).where(eq(users.id, s.sleeper.id)).get()).toMatchObject({ active: false, mustChangePassword: false });
    expect(t.db.select().from(users).all().map((u) => u.username)).toEqual(['keeper', 'sleeper', 'newbie']);
    expect(t.db.select().from(users).where(eq(users.username, 'newbie')).get()).toMatchObject({ locale: 'ar', email: 'new.coach@example.com', mustChangePassword: true });

    // Signed out everywhere; the old password signs in again, with no password to choose.
    expect((await s.keeper.get('/api/auth/me')).body.user).toBeNull();
    expect((await s.goner.get('/api/auth/me')).body.user).toBeNull();
    const back = await t.login('keeper');
    const me = (await back.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ name: 'Kept Person', locale: 'ar', phone: '0100 000 0000', photoFileId: s.files.keeperPhoto, isOwner: true, mustChangePassword: false });
    expect((await t.anon.post('/api/auth/login', { username: 'sleeper', password: t.password })).status).toBe(401); // still deactivated
    expect((await t.anon.post('/api/auth/login', { username: 'goner', password: t.password })).status).toBe(401);

    // Files: the kept account's photo is the only one left — bytes included — and no longer names the deleted uploader.
    expect(t.db.select().from(files).all()).toEqual([expect.objectContaining({ id: s.files.keeperPhoto, uploadedBy: null })]);
    expect((await back.raw(`/api/files/${s.files.keeperPhoto}`, { headers: { cookie: back.cookie! } })).status).toBe(200);
    expect(t.db.select({ key: fileChunks.storageKey }).from(fileChunks).all()).toEqual([{ key: keptPhotoKey }]);
    for (const key of otherKeys) expect(await t.files.get(key)).toBeNull();
    expect(otherKeys).toHaveLength(4);
    expect((t.db as NodeDB).$client.pragma('foreign_key_check')).toEqual([]);
    // The school's own position is still there, and still the kept account's.
    expect(t.db.select().from(positions).where(eq(positions.id, s.custom.id)).get()).toBeTruthy();
    expect(me.positions.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Front desk', 'CEO', 'Executive Director']));
  });

  it('the owner named is an active owner afterwards: a deactivated coach is switched on and given CEO; an owner already is left alone', async () => {
    const s = await school();
    const { real } = await silently(() => clear(s.t, { create: [], keep: ['sleeper', 'goner'], owner: 'sleeper@old.example', keepSiteContent: 'all' }));
    expect(real.accounts.map((a) => [a.username, a.positions.map((p) => p.key), a.owner, a.active])).toEqual([
      ['goner', ['ceo'], true, true],
      ['sleeper', ['acting_coach', 'ceo'], true, true],
    ]);
    const sleeper = await s.t.login('sleeper');
    expect((await sleeper.get('/api/auth/me')).body.user).toMatchObject({ isOwner: true, mustChangePassword: false });
    expect((await sleeper.get('/api/positions')).status).toBe(200);
    // The other owner kept exactly one CEO link.
    expect(s.t.db.select().from(userPositions).where(eq(userPositions.userId, s.goner.user.id)).all()).toHaveLength(1);
  });

  it('gives the owner position the school still has: CFO when CEO is no longer one — and says so when there is none at all', async () => {
    const s = await school();
    const { t } = s;
    t.db.update(positions).set({ isOwner: false }).where(eq(positions.key, 'ceo')).run();
    const request = { create: [{ name: 'Salma', username: 'salma', password: 'salma789', positions: ['ceo', 'acting_coach'] }], owner: 'salma', keepSiteContent: 'contact' };
    const plan = (await admin<DryRun>(t, 'clear-demo', request)).body;
    expect(plan.accounts[0]).toMatchObject({ positions: [{ key: 'ceo', name: 'CEO' }, { key: 'acting_coach', name: 'Acting coach' }, { key: 'cfo', name: 'CFO' }], owner: true });

    t.db.update(positions).set({ isOwner: false }).where(eq(positions.key, 'cfo')).run();
    const before = snapshot(t);
    const none = await admin(t, 'clear-demo', request);
    expect([none.status, none.body.error.code]).toEqual([409, 'no_owner_position']);
    expect(snapshot(t)).toBe(before);
    // The recovery endpoint makes CEO an owner position again; then the plan needs nothing extra.
    expect((await silently(() => admin(t, 'grant-owner', { username: 'goner' }))).status).toBe(200);
    const { real } = await silently(() => clear(t, request));
    expect(real.accounts[0]).toMatchObject({ positions: [{ key: 'ceo', name: 'CEO' }, { key: 'acting_coach', name: 'Acting coach' }], owner: true });
    expect((await t.anon.post('/api/auth/login', { username: 'salma', password: 'salma789' })).body.user).toMatchObject({ isOwner: true, mustChangePassword: true });
  });

  it('stays within the Durable Object limits with many accounts: 131 deleted, 50 kept', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const hash = (await t.createUser('acting_coach')).passwordHash;
    const coach = t.positionId('acting_coach');
    const many = Array.from({ length: 180 }, (_, i) => ({ email: `person${i}@old.example`, username: `person${i}`, name: `Person ${i}`, passwordHash: hash }));
    for (const part of insertBatches(users, many)) {
      const made = t.db.insert(users).values(part).returning({ id: users.id }).all();
      t.db.insert(userPositions).values(made.map((u) => ({ userId: u.id, positionId: coach }))).run();
    }
    const keep = Array.from({ length: 50 }, (_, i) => `person${i * 3}`);
    const { real } = await silently(() => clear(t, { create: [], keep, owner: 'person0', keepSiteContent: 'all' }));
    expect(real.deleted.users).toBe(131); // the 130 others and the account made for its password hash
    expect(real.deleted.user_positions).toBe(131);
    expect(real.accounts).toHaveLength(50);
    expect(t.db.select().from(users).all().map((u) => u.username).sort()).toEqual([...keep].sort());
  });
});

// ── The website's content ───────────────────────────────────────────────────

describe('keepSiteContent', () => {
  const FULL = {
    published: true,
    tagline: { en: 'Acting in Giza', ar: 'التمثيل في الجيزة' },
    about: { en: 'About us.', ar: 'عن الاستوديو.' },
    address: { en: 'Mohandessin, Giza', ar: 'المهندسين، الجيزة' },
    mapUrl: 'https://maps.google.com/?q=Mohandessin',
    instagram: 'turquoisecastingstudio',
    whatsappWorkshops: '01094635959',
    whatsappCasting: '01119003100',
    phone: '0233000000',
    email: 'hello@example.com',
    castingCall: { open: true, intro: { en: 'Join us', ar: 'انضم إلينا' }, lookingFor: { en: 'Everyone', ar: 'الجميع' } },
    links: [
      { label: { en: 'Showreel', ar: 'فيديو' }, url: 'https://vimeo.com/x', visible: true },
      { label: { en: 'Hidden', ar: '' }, url: 'https://example.com/y', visible: false },
    ],
  };

  /** A website with everything on it: texts, contact lines, links, a main photo, an open casting call, a coach and a workshop with pictures — and public. */
  async function website() {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const director = await t.as('executive_director', { username: 'director' });
    const hero = await uploadPng(director);
    const coachPhoto = await uploadPng(director);
    const cover = await uploadPng(director);
    const saved = await director.put('/api/site/content', { ...FULL, heroFileId: hero });
    expect(saved.status).toBe(200);
    const course = t.db.insert(courses).values({ name: 'Demo workshop', startDate: addDays(todayISO(), -5), endDate: addDays(todayISO(), 50) }).returning().get();
    t.db.insert(siteWorkshops).values({ courseId: course.id, visible: true, coverFileId: cover }).run();
    t.db.insert(siteCoaches).values({ nameEn: 'Demo Coach', photoFileId: coachPhoto, userId: director.user.id }).run();
    for (const id of [hero, coachPhoto, cover]) expect((await t.anon.raw(`/site/media/${id}`, {})).status).toBe(200);
    return { t, hero, coachPhoto, cover, before: getSiteContent(t.db) };
  }
  const request = (keepSiteContent: string) => ({ create: [], keep: ['director'], owner: 'director', keepSiteContent });

  it("'contact': the studio's words and contact lines stay; links, main photo, coaches and workshops go; the casting call closes; not public", async () => {
    const w = await website();
    const { dry, real } = await silently(() => clear(w.t, request('contact')));
    const summary = {
      mode: 'contact',
      published: false,
      castingCallOpen: false,
      kept: ['tagline', 'about', 'address', 'mapUrl', 'whatsappWorkshops', 'whatsappCasting', 'phone', 'email', 'instagram'],
      links: { kept: 0, removed: 2 },
      mainPhoto: 'removed',
    };
    expect(dry.siteContent).toEqual(summary);
    expect(real.siteContent).toEqual(summary);
    expect(real.deleted).toMatchObject({ site_coaches: 1, site_workshops: 1, courses: 1, files: 3 });

    const after = getSiteContent(w.t.db);
    // The casting call's texts go too: they are not on the 'contact' list, and switching the call on would publish them.
    expect(after).toEqual({ ...w.before, published: false, heroFileId: null, links: [], castingCall: { open: false, intro: { en: '', ar: '' }, lookingFor: { en: '', ar: '' } } });
    for (const key of ['tagline', 'about', 'address', 'mapUrl', 'instagram', 'whatsappWorkshops', 'whatsappCasting', 'phone', 'email'] as const) expect(after[key]).toEqual(FULL[key]);
    expect(w.t.db.select().from(files).all()).toEqual([]);
    expect(w.t.db.select().from(fileChunks).all()).toEqual([]);
    for (const id of [w.hero, w.coachPhoto, w.cover]) expect((await w.t.anon.raw(`/site/media/${id}`, {})).status).toBe(404);
    // The preview shows the kept words, and the casting form is closed.
    const home = await (await w.t.anon.raw('/site/en', {})).text();
    expect(home).toContain('Acting in Giza');
    expect(home).toContain('class="preview"');
  });

  it("'all': the content object is untouched — links, main photo (the file too), the open casting call, the public switch; coaches and workshops still go with their records", async () => {
    const w = await website();
    const { dry, real } = await silently(() => clear(w.t, request('all')));
    expect(real.siteContent).toEqual({
      mode: 'all',
      published: true,
      castingCallOpen: true,
      kept: ['tagline', 'about', 'address', 'mapUrl', 'whatsappWorkshops', 'whatsappCasting', 'phone', 'email', 'instagram', 'castingCall.intro', 'castingCall.lookingFor'],
      links: { kept: 2, removed: 0 },
      mainPhoto: 'kept',
    });
    expect(dry.siteContent).toEqual(real.siteContent);
    expect(real.deleted).toMatchObject({ site_coaches: 1, site_workshops: 1, files: 2 });
    expect(getSiteContent(w.t.db)).toEqual(w.before);
    expect(w.t.db.select().from(siteCoaches).all()).toEqual([]);
    expect(w.t.db.select().from(siteWorkshops).all()).toEqual([]);
    // The main photo is the one file left, and the public site still serves it.
    expect(w.t.db.select({ id: files.id }).from(files).all()).toEqual([{ id: w.hero }]);
    expect(await fileBytes(w.t, w.hero)).not.toBeNull();
    expect((await w.t.anon.raw(`/site/media/${w.hero}`, {})).status).toBe(200);
    for (const id of [w.coachPhoto, w.cover]) expect((await w.t.anon.raw(`/site/media/${id}`, {})).status).toBe(404);
    const home = await (await w.t.anon.raw('/site/en', {})).text();
    expect(home).not.toContain('class="preview"');
  });

  it("'none': the content object is removed — empty texts, nothing public, as before the website was ever edited", async () => {
    const w = await website();
    const { real } = await silently(() => clear(w.t, request('none')));
    expect(real.siteContent).toEqual({ mode: 'none', published: false, castingCallOpen: false, kept: [], links: { kept: 0, removed: 2 }, mainPhoto: 'removed' });
    expect(hasSiteContent(w.t.db)).toBe(false);
    expect(getSiteContent(w.t.db)).toEqual(DEFAULT_SITE_CONTENT);
    expect(w.t.db.select().from(files).all()).toEqual([]);
    // The other settings are still there (the forms' secret among them).
    expect(w.t.db.select().from(settings).all().map((r) => r.key)).toContain(SITE_FORM_SECRET_SETTING);
    expect((await w.t.anon.raw('/site/en', {})).status).toBe(200);
  });

  it('a website that was never edited stays that way in every mode', async () => {
    for (const mode of ['contact', 'all', 'none']) {
      const t = await makeTestContext({ config: { adminToken: TOKEN } });
      await t.as('owner', { username: 'boss' });
      const { real } = await silently(() => clear(t, { create: [], keep: ['boss'], owner: 'boss', keepSiteContent: mode }));
      expect(real.siteContent).toEqual({ mode, published: false, castingCallOpen: false, kept: [], links: { kept: 0, removed: 0 }, mainPhoto: 'none' });
      expect(hasSiteContent(t.db)).toBe(false);
    }
  });
});

// ── Restore points ──────────────────────────────────────────────────────────

describe('restore points', () => {
  const BOOKMARK = '0000007b-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b';
  const UNDO = '0000007c-00000001-00001538-11111111111111111111111111111111';
  const request = { create: [{ name: 'Salma', username: 'salma', password: 'salma789', positions: ['ceo'] }], owner: 'salma', keepSiteContent: 'contact' };

  /** A runtime with point-in-time recovery, as the Durable Object gives it; `calls` records what was asked and what the database held then. */
  function fakeRecovery(t: () => Ctx) {
    const calls: { what: string; students?: number; target?: unknown }[] = [];
    const restore: Required<RestoreDeps> = {
      async record() {
        calls.push({ what: 'record', students: t().db.select({ n: count() }).from(students).get()!.n });
        return { kind: 'bookmark', bookmark: BOOKMARK, at: 1_800_000_000_000 };
      },
      async current() {
        calls.push({ what: 'current' });
        return { bookmark: BOOKMARK, at: 1_800_000_000_000 };
      },
      async restoreTo(target) {
        calls.push({ what: 'restoreTo', target });
        if ('bookmark' in target && target.bookmark.startsWith('ffff')) throw new Error('Invalid bookmark');
        return { restoringTo: 'bookmark' in target ? target.bookmark : BOOKMARK, undoBookmark: UNDO };
      },
    };
    return { calls, restore };
  }

  it('without them (tests, local wrangler dev, and the two endpoints on Node): 501 not_supported, and a real run has no restore point', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    await t.as('owner');
    const point = await admin(t, 'restore-point');
    expect([point.status, point.body.error.code]).toEqual([501, 'not_supported']);
    for (const body of [{ minutesAgo: 5 }, { bookmark: BOOKMARK }, { nonsense: true }]) {
      const res = await admin(t, 'restore', body);
      expect([res.status, res.body.error.code]).toEqual([501, 'not_supported']);
    }
    // Only GET for one and POST for the other.
    expect((await admin(t, 'restore-point', {})).status).toBe(404);
    expect((await admin(t, 'restore', undefined)).status).toBe(404);
    const { real } = await silently(() => clear(t, request));
    expect(real.restorePoint).toBeNull();
  });

  it('a real run records the restore point before it changes anything, and returns it; a dry run or a refused run records nothing', async () => {
    let ctx!: Ctx;
    const { calls, restore } = fakeRecovery(() => ctx);
    ctx = await makeTestContext({ config: { adminToken: TOKEN }, restore });
    const owner = await ctx.as('owner');
    await owner.post('/api/students', { firstName: 'Still', lastName: 'Here' });

    const dry = (await admin<DryRun>(ctx, 'clear-demo', request)).body;
    expect((await admin(ctx, 'clear-demo', { ...request, dryRun: false })).status).toBe(400);
    expect((await admin(ctx, 'clear-demo', { ...request, dryRun: false, confirm: 'aaaaaaaa-bbbbbbbb' })).status).toBe(409);
    expect(calls).toEqual([]);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const real = await admin<RealRun>(ctx, 'clear-demo', { ...request, dryRun: false, confirm: dry.confirm });
    const logged = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(real.status).toBe(200);
    expect(real.body.restorePoint).toEqual({ kind: 'bookmark', bookmark: BOOKMARK, at: 1_800_000_000_000 });
    // Recorded once, while the student was still there.
    expect(calls).toEqual([{ what: 'record', students: 1 }]);
    expect(ctx.db.select().from(students).all()).toEqual([]);
    expect(logged).toContain(BOOKMARK); // in the log too, should the answer get lost
  });

  it('when the restore point cannot be recorded the run stops: 503, nothing changed', async () => {
    const t = await makeTestContext({
      config: { adminToken: TOKEN },
      restore: {
        record: async () => {
          throw new Error('storage is not answering');
        },
      },
    });
    const owner = await t.as('owner');
    const dry = (await admin<DryRun>(t, 'clear-demo', request)).body;
    const before = snapshot(t);
    const res = await silently(() => admin(t, 'clear-demo', { ...request, dryRun: false, confirm: dry.confirm }));
    expect([res.status, res.body.error.code]).toEqual([503, 'restore_point_failed']);
    expect(JSON.stringify(res.body)).not.toContain('storage is not answering');
    expect(snapshot(t)).toBe(before);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
  });

  it('the plan is checked again inside the transaction: a record that slips in while the run prepares stops it', async () => {
    let ctx!: Ctx;
    ctx = await makeTestContext({
      config: { adminToken: TOKEN },
      restore: {
        // Between the first check of the code and the transaction (where the passwords are hashed and the restore point taken).
        record: async () => {
          ctx.db.insert(students).values({ firstName: 'Slipped', lastName: 'In' }).run();
          return null;
        },
      },
    });
    const owner = await ctx.as('owner');
    const dry = (await admin<DryRun>(ctx, 'clear-demo', request)).body;
    const res = await admin(ctx, 'clear-demo', { ...request, dryRun: false, confirm: dry.confirm });
    expect([res.status, res.body.error.code]).toEqual([409, 'plan_changed']);
    expect(ctx.db.select().from(students).all()).toHaveLength(1);
    expect(ctx.db.select().from(users).all().map((u) => u.id)).toEqual([owner.user.id]);
    expect((await owner.get('/api/auth/me')).status).toBe(200);
  });

  it('GET restore-point → the bookmark for now; POST restore → 202 with the bookmark it goes to and the one that undoes it', async () => {
    let ctx!: Ctx;
    const { calls, restore } = fakeRecovery(() => ctx);
    ctx = await makeTestContext({ config: { adminToken: TOKEN }, restore });
    const point = await admin(ctx, 'restore-point');
    expect([point.status, point.body]).toEqual([200, { bookmark: BOOKMARK, at: 1_800_000_000_000 }]);
    expect(point.headers.get('cache-control')).toBe('no-store');

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const toBookmark = await admin(ctx, 'restore', { bookmark: ` ${BOOKMARK} ` });
    expect([toBookmark.status, toBookmark.body]).toEqual([202, { restoringTo: BOOKMARK, undoBookmark: UNDO }]);
    const now = Date.now();
    const toTime = await admin(ctx, 'restore', { minutesAgo: 90 });
    expect(toTime.status).toBe(202);
    expect(log.mock.calls.flat().join(' ')).toContain(UNDO);
    log.mockRestore();
    const asked = calls.filter((c) => c.what === 'restoreTo').map((c) => c.target as { bookmark?: string; time?: number });
    expect(asked[0]).toEqual({ bookmark: BOOKMARK });
    expect(Math.abs(asked[1]!.time! - (now - 90 * 60_000))).toBeLessThan(5000);

    // One of the two, within 30 days; nothing else.
    for (const body of [{}, { bookmark: BOOKMARK, minutesAgo: 5 }, { minutesAgo: 0 }, { minutesAgo: 43201 }, { minutesAgo: 1.5 }, { minutesAgo: '5' }, { bookmark: 'no spaces; or "quotes"' }, { bookmark: 'short' }, { minutesAgo: 5, force: true }]) {
      const res = await admin(ctx, 'restore', body);
      expect([res.status, res.body.error.code], JSON.stringify(body)).toEqual([400, 'validation']);
    }
    expect((await admin(ctx, 'restore', { minutesAgo: 43200 })).status).toBe(202);
    expect(calls.filter((c) => c.what === 'restoreTo')).toHaveLength(3);

    // The runtime refusing (a bookmark it doesn't know): 409 with its words.
    const refused = await admin(ctx, 'restore', { bookmark: 'ffff0000-0000b26e-00001538-0c3e87bb37b3db5cc52eedb93cd3b96b' });
    expect([refused.status, refused.body.error.code, refused.body.error.details]).toEqual([409, 'restore_refused', { reason: 'Invalid bookmark' }]);
  });

  it('a runtime whose recovery turns out not to be there (local workerd) answers null: 501, and the run goes on without a restore point', async () => {
    const asked: string[] = [];
    const t = await makeTestContext({
      config: { adminToken: TOKEN },
      restore: {
        record: async () => null,
        current: async () => null,
        restoreTo: async () => {
          asked.push('restoreTo');
          return null;
        },
      },
    });
    await t.as('owner');
    expect((await admin(t, 'restore-point')).status).toBe(501);
    // 501 whatever the body — well-formed or not — as on Node: the runtime is asked first, the body isn't read.
    for (const body of [{ minutesAgo: 5 }, { bookmark: BOOKMARK }, {}, { minutesAgo: 0 }, { minutesAgo: 5, bookmark: 'abcdefgh' }, { nonsense: true }]) {
      const res = await admin(t, 'restore', body);
      expect([res.status, res.body.error.code], JSON.stringify(body)).toEqual([501, 'not_supported']);
    }
    expect(asked).toEqual([]);
    expect((await silently(() => clear(t, request))).real.restorePoint).toBeNull();
  });

  it('Node: the database is copied aside before the run — a whole, readable copy of how it was — and its path is the restore point', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-clear-'));
    try {
      const db = createDb(path.join(dir, 'app.db'));
      const t = await makeTestContext({ config: { adminToken: TOKEN } });
      // The same app, on the database file: the helper's own database is not used below.
      const { createApp } = await import('../../src/server/app');
      const { sqliteFileStore } = await import('../../src/server/lib/fileStore');
      const app = createApp({ db, config: t.config, files: sqliteFileStore(db), restore: nodeRestorePoints(db, dir) });
      const call = async (body: unknown) => {
        const res = await app.request('/api/admin/clear-demo', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
      };
      const hash = (await t.createUser('owner')).passwordHash;
      const old = db.insert(users).values({ email: 'old@old.example', username: 'old', name: 'Old Owner', passwordHash: hash }).returning().get();
      db.insert(students).values({ firstName: 'Written', lastName: 'Before' }).run();

      const dry = await call(request);
      expect(dry.status).toBe(200);
      expect(fs.readdirSync(dir).filter((f) => f.includes('before-clear-demo'))).toEqual([]);
      const real = await silently(() => call({ ...request, dryRun: false, confirm: dry.body.confirm }));
      expect(real.status).toBe(200);
      const point = real.body.restorePoint;
      expect(point).toMatchObject({ kind: 'file', at: expect.any(Number) });
      expect(path.dirname(point.file)).toBe(dir);
      expect(path.basename(point.file)).toMatch(/^app\.before-clear-demo\.\d{8}T\d{6}Z\.db$/);

      // The live database is cleared; the copy still has the student and the old account.
      expect(db.select().from(students).all()).toEqual([]);
      expect(db.select().from(users).all().map((u) => u.username)).toEqual(['salma']);
      const copy = new Database(point.file, { readonly: true });
      expect(copy.prepare('select first_name from students').all()).toEqual([{ first_name: 'Written' }]);
      expect(copy.prepare('select id, username from users').all()).toEqual([{ id: old.id, username: 'old' }]);
      expect(copy.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      copy.close();

      // A second copy in the same second never overwrites the first.
      const again = nodeRestorePoints(db, dir);
      const [a, b] = [await again.record(), await again.record()];
      expect(new Set([point.file, (a as { file: string }).file, (b as { file: string }).file]).size).toBe(3);
      // No bookmarks here: the two restore endpoints stay 501.
      expect((await app.request('/api/admin/restore-point', { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(501);
      expect((await app.request('/api/admin/restore', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: '{"minutesAgo":5}' })).status).toBe(501);
      db.$client.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── The plan and its code, directly ─────────────────────────────────────────

describe('planClearDemo and the confirm code', () => {
  it('reads only, is the same for the same data, and the code needs the token', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    await t.as('owner', { username: 'boss' });
    const input = clearDemoInput.parse({ create: [{ name: 'Salma', username: 'salma', password: 'salma789', positions: ['executive_director'] }], keep: ['boss'], owner: 'boss', keepSiteContent: 'contact' });
    const before = snapshot(t);
    const plan = planClearDemo(t.db, input);
    expect(snapshot(t)).toBe(before);
    expect(planClearDemo(t.db, input)).toEqual(plan);
    const code = clearDemoConfirmCode(TOKEN, input, plan);
    expect(code).toBe((await admin<DryRun>(t, 'clear-demo', input)).body.confirm);
    // Keyed with the token: without it the code can't be worked out from the request (which holds passwords).
    expect(clearDemoConfirmCode('another-token-another-token-123', input, plan)).not.toBe(code);
    // The order of `keep` and of an account's positions doesn't matter; the order of the accounts does (their ids follow it).
    const shuffled = clearDemoInput.parse({ ...input, keep: ['BOSS', 'boss'] });
    expect(clearDemoConfirmCode(TOKEN, shuffled, planClearDemo(t.db, shuffled))).toBe(code);
    // Failed sign-ins don't touch it; a new record does.
    t.db.insert(loginFailures).values({ key: 'school', email: null, count: 3, firstAt: Date.now() }).run();
    expect(clearDemoConfirmCode(TOKEN, input, planClearDemo(t.db, input))).toBe(code);
    t.db.insert(students).values({ firstName: 'New', lastName: 'Row' }).run();
    const changed = clearDemoConfirmCode(TOKEN, input, planClearDemo(t.db, input));
    expect(changed).not.toBe(code);
    expect(changed.split('-')[0]).toBe(code.split('-')[0]);
  });
});
