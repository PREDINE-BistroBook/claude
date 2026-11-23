import { eq, inArray, sql } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import type { AppConfig } from '../../src/server/config';
import { createDb } from '../../src/server/db/client';
import { castingRoles, castings, courseSlots, courses, fileChunks, files, leads, loginFailures, positions, students, userPositions, users } from '../../src/server/db/schema';
import { findDuplicates, findStudentMatches } from '../../src/server/lib/admissions';
import { sqliteConstraint } from '../../src/server/lib/errors';
import { FILE_CHUNK_BYTES, fallbackFileStore, memoryFileStore, sqliteFileStore } from '../../src/server/lib/fileStore';
import { getSiteContent } from '../../src/server/lib/siteContent';
import { insertBatches, MAX_BOUND_PARAMS, rowsPerInsert } from '../../src/server/lib/sqlLimits';
import { MAX_JSON_BODY_BYTES } from '../../src/server/middleware/bodyLimit';
import { folderFileStore } from '../../src/server/nodeFileStore';
import { addDays } from '../../src/shared/dates';
import type { CourseDetail } from '../../src/shared/schemas/courses';
import { makeTestContext, PNG_1PX, testDb, todayISO } from '../helpers';

/**
 * What changed so the same code runs on Cloudflare (a Durable Object's SQLite)
 * and on the Node server: SQLite limits enforced in shared code, the stored
 * phone digits, files behind a FileStore, the persisted sign-in brake, and the
 * operator endpoints under /api/admin.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-cf-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TOKEN = 'test-admin-token-0123456789abcdef';

describe('Durable Object limits in the test database', () => {
  it('a query binding more than 100 parameters fails the test (better-sqlite3 alone would allow it)', () => {
    const db = testDb();
    const ids = Array.from({ length: MAX_BOUND_PARAMS + 1 }, (_, i) => i + 1);
    expect(() => db.select().from(users).where(inArray(users.id, ids)).all()).toThrow(/101 parameters/);
    expect(() => db.select().from(users).where(sql`${users.name} like ${`%${'ب'.repeat(30)}%`}`).all()).toThrow(/LIKE\/GLOB pattern/);
    expect(db.select().from(users).where(inArray(users.id, ids.slice(0, 100))).all()).toEqual([]);
    // Every database opened under Vitest has the check, not only testDb()'s (startup steps, CLI paths).
    expect(process.env.ACTING_SCHOOL_DO_LIMITS).toBe('1');
    const plain = createDb(':memory:');
    expect(() => plain.select().from(users).where(inArray(users.id, ids)).all()).toThrow(/101 parameters/);
    plain.$client.close();
  });

  it('multi-row inserts are split by the table width', () => {
    expect(rowsPerInsert(users)).toBe(Math.floor(100 / 11));
    const batches = insertBatches(fileChunks, Array.from({ length: 70 }, (_, i) => i));
    expect(batches.map((b) => b.length)).toEqual([33, 33, 4]);
  });
});

describe('100-parameter limit: long schedules and long lists', () => {
  it('a class with hundreds of sessions is created, regenerated and shortened in statements under the limit', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const today = todayISO();
    const slots = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { weekday, startTime: '09:00', endTime: '10:00' },
      { weekday, startTime: '18:00', endTime: '19:00' },
    ]);
    const created = await owner.post<CourseDetail>('/api/courses', { name: 'Daily', startDate: today, endDate: addDays(today, 365), schedule: slots });
    expect(created.status).toBe(201);
    expect(created.body.sessions.length).toBe(366 * 2);
    // Every generated session moves: 732 deletes and 732 inserts, all chunked.
    const moved = await owner.patch<CourseDetail>(`/api/courses/${created.body.id}`, { schedule: slots.map((s) => ({ ...s, startTime: s.startTime === '09:00' ? '08:00' : '17:00' })) });
    expect(moved.status).toBe(200);
    expect(moved.body.sessions.length).toBe(732);
    expect(moved.body.sessions.every((s) => s.startTime === '08:00' || s.startTime === '17:00')).toBe(true);
    const shorter = await owner.patch<CourseDetail>(`/api/courses/${created.body.id}`, { endDate: addDays(today, 6) });
    expect(shorter.body.sessions.length).toBe(14);
  });

  it('lists with more ids than one IN (…) may hold: staff, classes, casting roles', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const coachPosition = t.positionId('acting_coach');
    const hash = t.db.select({ h: users.passwordHash }).from(users).limit(1).get()!.h;
    const many = Array.from({ length: 130 }, (_, i) => ({ email: `staff${i}@test.local`, name: `Staff ${i}`, passwordHash: hash }));
    t.db.transaction((tx) => {
      for (const batch of insertBatches(users, many)) {
        const ids = tx.insert(users).values(batch).returning({ id: users.id }).all();
        tx.insert(userPositions).values(ids.map(({ id }) => ({ userId: id, positionId: coachPosition }))).run();
      }
    });
    const staff = await owner.get('/api/staff');
    expect(staff.status).toBe(200);
    expect(staff.body.items.length).toBeGreaterThanOrEqual(131);
    expect(staff.body.items.every((s: { positions: unknown[] }) => s.positions.length > 0)).toBe(true);

    for (let i = 0; i < 120; i++) {
      const c = t.db.insert(courses).values({ name: `Class ${i}`, startDate: '2026-01-01', endDate: '2026-06-30' }).returning({ id: courses.id }).get();
      t.db.insert(courseSlots).values({ courseId: c.id, weekday: i % 7, startTime: '10:00', endTime: '11:00' }).run();
    }
    const list = await owner.get('/api/courses');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(120);
    expect(list.body.items.every((c: { schedule: unknown[] }) => c.schedule.length === 1)).toBe(true);

    const casting = t.db.insert(castings).values({ title: 'Big crowd' }).returning({ id: castings.id }).get();
    for (const batch of insertBatches(castingRoles, Array.from({ length: 110 }, (_, i) => ({ castingId: casting.id, name: `Extra ${i}` })))) {
      t.db.insert(castingRoles).values(batch).run();
    }
    const detail = await owner.get(`/api/castings/${casting.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.roles).toHaveLength(110);
  });
});

describe('search without LIKE (50-byte pattern limit on Durable Objects)', () => {
  const longArabic = 'عبد الرحمن بن محمد الإسكندراني'; // 30 characters, 55 bytes
  it('a long Arabic search finds its match in students, talent, castings and leads', async () => {
    expect(Buffer.byteLength(longArabic)).toBeGreaterThan(50);
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const student = (await owner.post('/api/students', { firstName: 'يوسف', lastName: longArabic })).body;
    await owner.post('/api/students', { firstName: 'Other', lastName: 'Student' });
    const talent = (await owner.post('/api/talent', { firstName: 'نور', lastName: longArabic })).body;
    const casting = (await owner.post('/api/castings', { title: `فيلم ${longArabic}` })).body;
    const lead = (await owner.post('/api/leads', { firstName: 'سامي', lastName: longArabic, phone: '0100 333 4444' })).body;
    const q = encodeURIComponent(`يوسف ${longArabic}`);
    expect((await owner.get(`/api/students?q=${q}`)).body.items.map((s: { id: number }) => s.id)).toEqual([student.id]);
    expect((await owner.get(`/api/talent?q=${encodeURIComponent(longArabic)}`)).body.items.map((s: { id: number }) => s.id)).toEqual([talent.id]);
    expect((await owner.get(`/api/castings?q=${encodeURIComponent(longArabic)}`)).body.items.map((s: { id: number }) => s.id)).toEqual([casting.id]);
    expect((await owner.get(`/api/leads?q=${encodeURIComponent(longArabic)}`)).body.items.map((s: { id: number }) => s.id)).toEqual([lead.id]);
    // 100 characters (the longest a search may be) of nothing: no match, no error.
    const res = await owner.get(`/api/students?q=${encodeURIComponent('ابحث'.repeat(25))}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('still case-insensitive for Latin letters, and % or _ are plain characters', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const maya = (await owner.post('/api/students', { firstName: 'Maya', lastName: 'Collins' })).body;
    await owner.post('/api/students', { firstName: 'Bob', lastName: 'Smith' });
    expect((await owner.get('/api/students?q=MAYA%20coll')).body.items.map((s: { id: number }) => s.id)).toEqual([maya.id]);
    expect((await owner.get('/api/students?q=collins%20maya')).body.items.map((s: { id: number }) => s.id)).toEqual([maya.id]);
    expect((await owner.get(`/api/students?q=${encodeURIComponent('%')}`)).body.items).toEqual([]);
    expect((await owner.get(`/api/students?q=${encodeURIComponent('_')}`)).body.items).toEqual([]);
  });
});

describe('phone_digits: a stored column instead of a SQL function', () => {
  const digitsOf = (t: Awaited<ReturnType<typeof makeTestContext>>, table: typeof students | typeof leads, id: number) =>
    t.db.select({ d: table.phoneDigits }).from(table).where(eq(table.id, id)).get()!.d;

  it('is written with every phone: student create and edit, lead create and edit, enrolment', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const s = (await owner.post('/api/students', { firstName: 'A', lastName: 'B', phone: '+20 (10) ١٢٣-4567' })).body;
    expect(digitsOf(t, students, s.id)).toBe('20101234567');
    await owner.patch(`/api/students/${s.id}`, { phone: '0111 222 3333' });
    expect(digitsOf(t, students, s.id)).toBe('01112223333');
    await owner.patch(`/api/students/${s.id}`, { notes: 'phone untouched' });
    expect(digitsOf(t, students, s.id)).toBe('01112223333');
    await owner.patch(`/api/students/${s.id}`, { phone: null });
    expect(digitsOf(t, students, s.id)).toBeNull();

    const lead = (await owner.post('/api/leads', { firstName: 'C', lastName: 'D', phone: '٠١٠٠٥٥٥٦٦٦٧' })).body;
    expect(digitsOf(t, leads, lead.id)).toBe('01005556667');
    await owner.patch(`/api/leads/${lead.id}`, { phone: '+20 100 555 0000' });
    expect(digitsOf(t, leads, lead.id)).toBe('201005550000');
    const course = t.db.insert(courses).values({ name: 'Class', startDate: todayISO(), endDate: addDays(todayISO(), 30) }).returning().get();
    const enrol = await owner.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id });
    expect(enrol.status).toBe(201);
    expect(digitsOf(t, students, enrol.body.studentId)).toBe('201005550000');
    expect(enrol.body.lead).not.toHaveProperty('phoneDigits');
  });

  it('older rows get it at startup (initDb), and then match', async () => {
    const file = path.join(tmp, 'backfill.db');
    const first = createDb(file);
    first.$client.prepare(`insert into students (first_name, last_name, phone, status, media_consent, created_at, updated_at) values ('Old', 'Row', '٠١٠١٢٣٤٥٦٧٨', 'active', 0, 0, 0)`).run();
    first.$client.prepare(`insert into leads (first_name, last_name, phone, source, status, created_at, updated_at) values ('Old', 'Lead', '‪+20 122 555 6677‬', 'other', 'new', 0, 0)`).run();
    first.$client.close();
    const db = createDb(file);
    try {
      expect(db.select({ d: students.phoneDigits }).from(students).all()).toEqual([{ d: '01012345678' }]);
      expect(db.select({ d: leads.phoneDigits }).from(leads).all()).toEqual([{ d: '201225556677' }]);
      expect(findStudentMatches(db, '+20 101 234 5678', null, '20')).toEqual([{ id: 1, name: 'Old Row' }]);
      expect(findDuplicates(db, { phone: '0122 555 6677', countryCode: '20' }).map((d) => d.name)).toEqual(['Old Lead']);
    } finally {
      db.$client.close();
    }
  });
});

describe('FileStore', () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);

  it('sqliteFileStore splits a file into chunks, reads it back whole, replaces and deletes in one go', async () => {
    const db = testDb();
    const store = sqliteFileStore(db, 1000);
    const data = bytes(3 * 1000 + 17);
    await store.put('a.png', data, 'image/png');
    expect(db.select({ seq: fileChunks.seq }).from(fileChunks).where(eq(fileChunks.storageKey, 'a.png')).all()).toHaveLength(4);
    expect(await store.get('a.png')).toEqual(data);
    await store.put('a.png', bytes(10), 'image/png');
    expect(await store.get('a.png')).toEqual(bytes(10));
    expect(db.select().from(fileChunks).all()).toHaveLength(1);
    await store.put('empty.png', new Uint8Array(0), 'image/png');
    expect(await store.get('empty.png')).toEqual(new Uint8Array(0));
    await store.delete('a.png');
    expect(await store.get('a.png')).toBeNull();
    expect(await store.get('never.png')).toBeNull();
    expect(FILE_CHUNK_BYTES).toBeLessThan(2 * 1024 * 1024);
  });

  it('an upload bigger than a chunk round-trips through the API', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const big = new Uint8Array(FILE_CHUNK_BYTES * 2 + 12345);
    big.set(PNG_1PX.subarray(0, 8));
    for (let i = 8; i < big.length; i++) big[i] = (i * 7) % 251;
    const form = new FormData();
    form.append('file', new Blob([big], { type: 'image/png' }), 'big.png');
    const up = await owner.post('/api/files', form);
    expect(up.status).toBe(201);
    const key = t.db.select({ k: files.storageKey }).from(files).where(eq(files.id, up.body.id)).get()!.k;
    expect(t.db.select().from(fileChunks).where(eq(fileChunks.storageKey, key)).all()).toHaveLength(3);
    const res = await owner.raw(`/api/files/${up.body.id}`, { headers: { cookie: owner.cookie! } });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(big);
    expect((await t.anon.get(`/api/files/${up.body.id}`)).status).toBe(401);
  });

  it('folderFileStore (Node) keeps one file per key and refuses keys that leave the folder', async () => {
    const dir = path.join(tmp, 'uploads');
    const store = folderFileStore(dir);
    await store.put('x.png', bytes(5000), 'image/png');
    expect(fs.readdirSync(dir)).toEqual(['x.png']);
    expect(await store.get('x.png')).toEqual(bytes(5000));
    await store.delete('x.png');
    expect(await store.get('x.png')).toBeNull();
    await expect(store.put('../escape.png', bytes(1), 'image/png')).rejects.toThrow(/Invalid storage key/);
  });

  it('fallbackFileStore (R2 bound later) still reads files from before', async () => {
    const old = memoryFileStore();
    const fresh = memoryFileStore();
    await old.put('old.png', bytes(3), 'image/png');
    const store = fallbackFileStore(fresh, old);
    await store.put('new.png', bytes(4), 'image/png');
    expect(fresh.keys()).toEqual(['new.png']);
    expect(await store.get('old.png')).toEqual(bytes(3));
    expect(await store.get('new.png')).toEqual(bytes(4));
    await store.delete('old.png');
    expect(old.keys()).toEqual([]);
  });
});

describe('SQLite constraint errors on either driver', () => {
  it('maps better-sqlite3 codes and Durable Object messages, through wrapped causes', () => {
    const db = testDb();
    db.insert(positions).values({ name: 'X', key: 'dup' }).run();
    let thrown: unknown;
    try {
      db.insert(positions).values({ name: 'Y', key: 'dup' }).run();
    } catch (err) {
      thrown = err;
    }
    expect(sqliteConstraint(thrown)).toBe('unique');
    // What a Durable Object throws (a plain Error, no code).
    expect(sqliteConstraint(new Error('UNIQUE constraint failed: submissions.role_id, submissions.talent_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)'))).toBe('unique');
    expect(sqliteConstraint(new Error('FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)'))).toBe('foreign_key');
    expect(sqliteConstraint(new Error('wrapped', { cause: new Error('UNIQUE constraint failed: x') }))).toBe('unique');
    expect(sqliteConstraint(new Error('no such table: x'))).toBeNull();
    expect(sqliteConstraint('nope')).toBeNull();
  });
});

describe('sign-in brakes (in the database, checked before any password hashing)', () => {
  const brakeRow = (t: Awaited<ReturnType<typeof makeTestContext>>, key: string) =>
    t.db.select().from(loginFailures).where(eq(loginFailures.key, key)).get();

  /** A context whose requests say where they come from (X-Test-IP), like CF-Connecting-IP on Cloudflare. */
  async function withAddresses(config: Partial<AppConfig> = {}) {
    const t = await makeTestContext({ config, clientIp: (c) => c.req.header('x-test-ip') });
    const loginFrom = async (ip: string, email: string, password: string) =>
      (
        await t.app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', 'x-test-ip': ip },
          body: JSON.stringify({ email, password }),
        })
      ).status;
    return { t, loginFrom };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('per account: survives a restart, expires after 15 minutes, and clears on success', async () => {
    const t = await makeTestContext();
    const user = await t.createUser('admin', { email: 'brake@example.com' });
    for (let i = 0; i < 10; i++) expect((await t.anon.post('/api/auth/login', { email: user.email, password: 'wrong-wrong' })).status).toBe(401);
    expect((await t.anon.post('/api/auth/login', { email: user.email, password: t.password })).status).toBe(429);
    // No address known (the Node default in tests): the account brake is per email.
    expect(brakeRow(t, 'account:brake@example.com|')).toMatchObject({ email: 'brake@example.com', count: 10 });

    // A restart (or the Durable Object being evicted) keeps the count.
    const restarted = createApp({ db: t.db, config: t.config, files: t.files });
    const login = (password: string) =>
      restarted.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ email: user.email, password }),
      });
    expect((await login(t.password)).status).toBe(429);

    // 15 minutes after the first failure the window is over.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000);
    expect((await login('wrong-again')).status).toBe(401);
    expect(brakeRow(t, 'account:brake@example.com|')).toMatchObject({ count: 1 });
    expect((await login(t.password)).status).toBe(200);
    expect(brakeRow(t, 'account:brake@example.com|')).toBeUndefined();
  });

  it("an address that fails 10 times for an account doesn't lock the person out from elsewhere", async () => {
    const { t, loginFrom } = await withAddresses();
    const owner = await t.createUser('owner', { email: 'ceo@example.com' });
    for (let i = 0; i < 10; i++) expect(await loginFrom('203.0.113.9', owner.email, 'wrong-wrong')).toBe(401);
    expect(await loginFrom('203.0.113.9', owner.email, t.password)).toBe(429);
    expect(await loginFrom('198.51.100.7', owner.email, t.password)).toBe(200);
    expect(await loginFrom('203.0.113.9', owner.email, t.password)).toBe(429);
  });

  it('an account guessed at from many addresses stops at 100 failures', async () => {
    const { t, loginFrom } = await withAddresses();
    const owner = await t.createUser('owner', { email: 'ceo@example.com' });
    // 99 failures already counted from elsewhere this quarter hour; one more trips it.
    t.db.insert(loginFailures).values({ key: 'account:ceo@example.com', email: 'ceo@example.com', count: 99, firstAt: Date.now() }).run();
    expect(await loginFrom('203.0.113.1', owner.email, t.password)).toBe(200);
    expect(await loginFrom('203.0.113.2', owner.email, 'wrong-wrong')).toBe(401);
    expect(await loginFrom('203.0.113.3', owner.email, t.password)).toBe(429);
    expect(await loginFrom('203.0.113.4', 'someone.else@example.com', 'wrong-wrong')).toBe(401);
  });

  it('one address trying many accounts stops at 30 failures, and a stopped sign-in costs no hashing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { t, loginFrom } = await withAddresses();
    const owner = await t.createUser('owner', { email: 'ceo@example.com' });
    let hashed = 0;
    for (let i = 0; i < 30; i++) {
      // Half now, half after a minute: the school-wide brake (30 a minute) stays open.
      if (i === 15) vi.setSystemTime(Date.now() + 61_000);
      const started = performance.now();
      expect(await loginFrom('192.0.2.50', `random${i}@example.com`, 'wrong-wrong')).toBe(401);
      hashed += performance.now() - started;
    }
    expect(brakeRow(t, 'address:192.0.2.50')).toMatchObject({ email: null, count: 30 });
    const started = performance.now();
    for (let i = 0; i < 30; i++) expect(await loginFrom('192.0.2.50', `more${i}@example.com`, 'wrong-wrong')).toBe(429);
    const stopped = performance.now() - started;
    // 30 refusals take a fraction of the time of the 30 sign-ins that ran scrypt.
    expect(stopped).toBeLessThan(hashed / 4);
    expect(await loginFrom('192.0.2.50', owner.email, t.password)).toBe(429);
    expect(await loginFrom('192.0.2.51', owner.email, t.password)).toBe(200);
  });

  it('30 failures a minute across the whole school stop every sign-in until the minute is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { t, loginFrom } = await withAddresses();
    const owner = await t.createUser('owner', { email: 'ceo@example.com' });
    const signedIn = await t.login(owner.email);
    for (let i = 0; i < 30; i++) expect(await loginFrom(`10.1.0.${i}`, `bot${i}@example.com`, 'wrong-wrong')).toBe(401);
    expect(await loginFrom('10.2.0.1', owner.email, t.password)).toBe(429);
    // Staff already signed in carry on.
    expect((await signedIn.get('/api/auth/me')).body.user.email).toBe(owner.email);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await loginFrom('10.2.0.1', owner.email, t.password)).toBe(200);
  });

  it('grant-owner (lockout recovery) lifts every brake on that email', async () => {
    const { t, loginFrom } = await withAddresses({ adminToken: TOKEN });
    const owner = await t.createUser('owner', { email: 'ceo@example.com' });
    for (let i = 0; i < 10; i++) expect(await loginFrom('203.0.113.9', owner.email, 'wrong-wrong')).toBe(401);
    expect(await loginFrom('203.0.113.9', owner.email, t.password)).toBe(429);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await t.anon.raw('/api/admin/grant-owner', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ email: 'CEO@example.com' }),
    });
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(t.db.select().from(loginFailures).where(eq(loginFailures.email, 'ceo@example.com')).all()).toEqual([]);
    expect(await loginFrom('203.0.113.9', owner.email, t.password)).toBe(200);
  });
});

describe('first-run setup needs the setup code on Cloudflare', () => {
  const setup = { schoolName: 'Turquoise', name: 'Owner', email: 'owner@example.com', password: 'owner-password' };

  it('asks for ADMIN_TOKEN as the setup code before creating the owner', async () => {
    const t = await makeTestContext({ config: { requireSetupCode: true, adminToken: TOKEN } });
    expect((await t.anon.get('/api/auth/me')).body).toMatchObject({ user: null, needsSetup: true, setupCodeRequired: true });
    const missing = await t.anon.post('/api/auth/setup', setup);
    expect(missing.status).toBe(403);
    expect(missing.body.error).toMatchObject({ code: 'setup_code_required', issues: [{ path: ['setupCode'], message: 'errors.required' }] });
    const wrong = await t.anon.post('/api/auth/setup', { ...setup, setupCode: 'not-the-token-not-the-token' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatchObject({ code: 'invalid_setup_code', issues: [{ path: ['setupCode'], message: 'errors.wrongSetupCode' }] });
    expect(t.db.select().from(users).all()).toEqual([]);

    const ok = await t.anon.post('/api/auth/setup', { ...setup, setupCode: ` ${TOKEN} ` });
    expect(ok.status).toBe(201);
    expect(ok.body.user).toMatchObject({ email: 'owner@example.com', isOwner: true });
    expect((await t.anon.get('/api/auth/me')).body).toMatchObject({ needsSetup: false, setupCodeRequired: false });
    expect((await t.anon.post('/api/auth/setup', { ...setup, email: 'second@example.com', setupCode: TOKEN })).status).toBe(409);
  });

  it('without an ADMIN_TOKEN nobody can set the school up', async () => {
    const t = await makeTestContext({ config: { requireSetupCode: true } });
    const res = await t.anon.post('/api/auth/setup', { ...setup, setupCode: 'anything-at-all-anything' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('setup_locked');
    expect(t.db.select().from(users).all()).toEqual([]);
  });

  it('after a demo reset the empty school is still locked', async () => {
    const t = await makeTestContext({ config: { requireSetupCode: true, adminToken: TOKEN, allowDemoReset: true } });
    await t.as('owner');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await t.anon.raw('/api/admin/reset', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    log.mockRestore();
    expect((await t.anon.get('/api/auth/me')).body).toMatchObject({ needsSetup: true, setupCodeRequired: true });
    expect((await t.anon.post('/api/auth/setup', setup)).status).toBe(403);
  });

  it('the Node server keeps open first-run setup unless REQUIRE_SETUP_CODE=true', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/auth/me')).body).toMatchObject({ needsSetup: true, setupCodeRequired: false });
    expect((await t.anon.post('/api/auth/setup', setup)).status).toBe(201);
  });
});

describe('request bodies over 1 MB are refused before they are read', () => {
  const loginRequest = (body: BodyInit, headers: Record<string, string> = {}) =>
    ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', ...headers }, body, duplex: 'half' }) as RequestInit;
  const streamOf = (text: string, chunkSize = 64 * 1024) => {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      },
    });
  };

  it('by Content-Length, and while streaming one without a length; smaller bodies work as before', async () => {
    expect(MAX_JSON_BODY_BYTES).toBe(1024 * 1024);
    const t = await makeTestContext();
    const user = await t.createUser('admin', { email: 'big@example.com' });
    const huge = JSON.stringify({ email: user.email, password: 'A'.repeat(MAX_JSON_BODY_BYTES) });

    const declared = await t.app.request('/api/auth/login', loginRequest(huge, { 'content-length': String(huge.length) }));
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: { code: 'payload_too_large', message: 'The request is too large' } });
    expect(declared.headers.get('cache-control')).toBe('no-store');

    const streamed = await t.app.request('/api/auth/login', loginRequest(streamOf(huge)));
    expect(streamed.status).toBe(413);

    // A streamed body under the limit is read normally.
    const ok = await t.app.request('/api/auth/login', loginRequest(streamOf(JSON.stringify({ email: user.email, password: t.password }), 7)));
    expect(ok.status).toBe(200);
    // Just under the limit: validated as usual (the password is too long), not refused unread.
    const nearly = JSON.stringify({ email: user.email, password: 'A'.repeat(MAX_JSON_BODY_BYTES - 100) });
    expect((await t.app.request('/api/auth/login', loginRequest(nearly))).status).toBe(400);
  });
});

describe('the session cookie', () => {
  it('over HTTPS is __Host-as_session (Secure, Path=/, no Domain), and a plain as_session is ignored', async () => {
    const t = await makeTestContext({ config: { cookieSecure: true } });
    const user = await t.createUser('admin', { email: 'cookie@example.com' });
    const res = await t.anon.post('/api/auth/login', { email: user.email, password: t.password });
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^__Host-as_session=[^;]+; /);
    expect(setCookie).toMatch(/; Path=\/;/);
    expect(setCookie).toMatch(/; Secure/);
    expect(setCookie).not.toMatch(/Domain=/i);
    const token = /^__Host-as_session=([^;]+)/.exec(setCookie)![1]!;
    const me = async (cookie: string) => (await t.anon.raw('/api/auth/me', { headers: { cookie } })).json();
    expect((await me(`__Host-as_session=${token}`)).user.email).toBe(user.email);
    // What a sibling subdomain could plant (Domain=<parent>) has no prefix: never read over HTTPS.
    expect((await me(`as_session=${token}`)).user).toBeNull();
    const out = await t.anon.raw('/api/auth/logout', { method: 'POST', headers: { cookie: `__Host-as_session=${token}`, 'x-requested-with': 'fetch' } });
    expect(out.headers.get('set-cookie')).toMatch(/^__Host-as_session=; Max-Age=0; Path=\/; Secure/);
  });

  it('over plain http (local development) keeps the plain name', async () => {
    const t = await makeTestContext();
    const user = await t.createUser('admin', { email: 'dev@example.com' });
    const res = await t.anon.post('/api/auth/login', { email: user.email, password: t.password });
    expect(res.headers.get('set-cookie')).toMatch(/^as_session=[^;]+; /);
  });
});

describe('/api/admin (operator endpoints)', () => {
  it("don't exist without ADMIN_TOKEN: the same answers as any unknown route", async () => {
    const t = await makeTestContext();
    for (const action of ['seed-demo', 'reset', 'grant-owner']) {
      const admin = await t.anon.post(`/api/admin/${action}`, { password: 'long-enough-password' });
      const unknown = await t.anon.post('/api/no-such-route', { password: 'long-enough-password' });
      expect([admin.status, admin.body]).toEqual([unknown.status, unknown.body]);
      expect(admin.status).toBe(404);
      const noHeader = await t.anon.raw(`/api/admin/${action}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
      const unknownNoHeader = await t.anon.raw('/api/no-such-route', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
      expect([noHeader.status, await noHeader.text()]).toEqual([unknownNoHeader.status, await unknownNoHeader.text()]);
    }
  });

  it('need the bearer token; seed-demo fills an empty database once, with the password sent', async () => {
    // As on Cloudflare: setup needs the setup code, which seed-demo has (it's the token).
    const t = await makeTestContext({ config: { adminToken: TOKEN, requireSetupCode: true } });
    const call = (action: string, body: unknown, token: string | null = TOKEN) =>
      t.anon.raw(`/api/admin/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    expect((await call('seed-demo', { password: 'long-enough-password' }, null)).status).toBe(401);
    expect((await call('seed-demo', { password: 'long-enough-password' }, 'wrong-token-wrong-token-wrong')).status).toBe(401);
    expect((await call('seed-demo', { password: 'short' })).status).toBe(400);
    expect((await call('nothing-here', {})).status).toBe(404);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const seeded = await call('seed-demo', { password: 'deployed-demo-password' });
    expect(seeded.status).toBe(201);
    const result = await seeded.json();
    expect(result.counts).toMatchObject({ classes: 6, enquiries: 16 });
    expect(result.logins.map((l: { email: string }) => l.email)).toContain('owner@demo.school');
    expect(log.mock.calls.flat().join(' ')).not.toContain(TOKEN);
    log.mockRestore();

    // The demo accounts use the password sent, never demo1234.
    expect((await t.anon.post('/api/auth/login', { email: 'director@demo.school', password: 'demo1234' })).status).toBe(401);
    expect((await t.anon.post('/api/auth/login', { email: 'director@demo.school', password: 'deployed-demo-password' })).status).toBe(200);
    expect(t.db.select().from(files).all().length).toBeGreaterThan(5);
    // The demo website is there, and not public: its content is made up.
    const site = getSiteContent(t.db);
    expect(site.whatsappWorkshops).toBe('01094635959');
    expect(site.published).toBe(false);
    expect((await call('seed-demo', { password: 'deployed-demo-password' })).status).toBe(409);

    // Reset is off unless ALLOW_DEMO_RESET=true.
    expect((await call('reset', {})).status).toBe(403);
  }, 60_000);

  it('reset (ALLOW_DEMO_RESET=true) wipes every row and file and leaves a school that asks for setup', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN, allowDemoReset: true } });
    const owner = await t.as('owner');
    await owner.post('/api/students', { firstName: 'Gone', lastName: 'Soon' });
    const form = new FormData();
    form.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'x.png');
    expect((await owner.post('/api/files', form)).status).toBe(201);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await t.anon.raw('/api/admin/reset', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deletedFiles: 1 });
    expect(t.db.select().from(students).all()).toEqual([]);
    expect(t.db.select().from(users).all()).toEqual([]);
    expect(t.db.select().from(fileChunks).all()).toEqual([]);
    expect(t.db.select().from(positions).all().length).toBe(10);
    expect((await t.anon.get('/api/auth/me')).body.needsSetup).toBe(true);
    expect((await owner.get('/api/students')).status).toBe(401);
  });

  it('grant-owner: the npm run owner recovery over HTTP', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const coach = await t.createUser('acting_coach', { email: 'locked@example.com', active: false });
    const call = (email: string) =>
      t.anon.raw('/api/admin/grant-owner', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ email }) });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await call(' Locked@Example.com ');
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      email: 'locked@example.com',
      name: coach.name,
      position: 'CEO',
      reactivated: true,
      restoredOwnerPosition: false,
      ceoNotOwner: false,
    });
    expect(t.db.select({ active: users.active }).from(users).where(eq(users.id, coach.id)).get()).toEqual({ active: true });
    expect((await (await t.login('locked@example.com')).get('/api/positions')).status).toBe(200);
    expect((await call('nobody@example.com')).status).toBe(404);
  });
});
