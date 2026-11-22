import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { PHASE_ONE_ROLE_POSITIONS, createDb, type DB } from '../src/server/db/client';
import { eq, inArray } from 'drizzle-orm';
import { positions, userPositions, users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/lib/password';
import type { BuiltInPositionKey, Permission } from '../src/shared/permissions';

/** Old role names from phase 1, kept so tests read naturally: each maps to the position an upgrade gives (db/client.ts). */
export const LEGACY_ROLES = PHASE_ONE_ROLE_POSITIONS;
export type LegacyRole = keyof typeof LEGACY_ROLES;

/**
 * Who a test user is:
 * - a built-in position key ('executive_director') or a legacy role ('admin');
 * - several of them (['acting_coach', 'finance']) — their permissions add up;
 * - { permissions: [...] } — a custom position made just for this user (isOwner optional).
 */
export type PositionSpec =
  | BuiltInPositionKey
  | LegacyRole
  | readonly (BuiltInPositionKey | LegacyRole)[]
  | { permissions: readonly Permission[]; isOwner?: boolean; name?: string };

function specLabel(spec: PositionSpec): string {
  if (typeof spec === 'string') return spec;
  if (Array.isArray(spec)) return spec.join('+');
  return 'custom';
}

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export type Client = ReturnType<typeof makeClient>;

function makeClient(app: ReturnType<typeof createApp>, cookie?: string) {
  const call = async <T = any>(method: string, url: string, body?: unknown): Promise<TestResponse<T>> => {
    const headers: Record<string, string> = { 'x-requested-with': 'fetch' };
    if (cookie) headers.cookie = cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await app.request(url, { method, headers, body: payload });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  };
  return {
    cookie,
    get: <T = any>(url: string) => call<T>('GET', url),
    post: <T = any>(url: string, body?: unknown) => call<T>('POST', url, body),
    put: <T = any>(url: string, body?: unknown) => call<T>('PUT', url, body),
    patch: <T = any>(url: string, body?: unknown) => call<T>('PATCH', url, body),
    delete: <T = any>(url: string) => call<T>('DELETE', url),
    /** Raw request (e.g. to omit the X-Requested-With header). */
    raw: (url: string, init: RequestInit) => app.request(url, init),
  };
}

// One password hash shared by every test user: scrypt is deliberately slow.
const PASSWORD = 'password123';
let hashed: Promise<string> | null = null;

/**
 * A fresh app on an in-memory database. Typical use:
 *   const t = await makeTestContext();
 *   const admin = await t.as('admin');            // legacy alias of 'executive_director'
 *   const moaty = await t.as(['acting_coach', 'finance']);
 *   const custom = await t.as({ permissions: ['students.read'] });
 *   const res = await admin.post('/api/students', { firstName: 'A', lastName: 'B' });
 */
export async function makeTestContext() {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-test-'));
  const config: AppConfig = { dataDir: uploadsDir, uploadsDir, cookieSecure: false, sessionDays: 30, isProduction: false };
  const db: DB = createDb(':memory:');
  const app = createApp({ db, config });
  hashed ??= hashPassword(PASSWORD);
  let n = 0;

  /** The position ids a spec stands for (a custom spec creates its position). */
  function positionIdsFor(spec: PositionSpec): number[] {
    if (typeof spec === 'object' && !Array.isArray(spec)) {
      const custom = spec as Exclude<PositionSpec, string | readonly unknown[]>;
      const row = db
        .insert(positions)
        .values({ name: custom.name ?? `Custom ${++n}`, isOwner: custom.isOwner ?? false, permissions: [...custom.permissions], sortOrder: 1000 })
        .returning({ id: positions.id })
        .get();
      return [row.id];
    }
    const keys = (Array.isArray(spec) ? spec : [spec]).map((k) => (k in LEGACY_ROLES ? LEGACY_ROLES[k as LegacyRole] : k) as string);
    const rows = db.select({ id: positions.id, key: positions.key }).from(positions).where(inArray(positions.key, keys)).all();
    if (rows.length !== new Set(keys).size) throw new Error(`unknown position key in ${JSON.stringify(spec)}`);
    return rows.map((r) => r.id);
  }

  /** The id of a built-in position (or legacy role name). */
  function positionId(key: BuiltInPositionKey | LegacyRole): number {
    const k = key in LEGACY_ROLES ? LEGACY_ROLES[key as LegacyRole] : key;
    return db.select({ id: positions.id }).from(positions).where(eq(positions.key, k)).get()!.id;
  }

  /** Create a staff account directly in the database, holding the given position(s). */
  async function createUser(spec: PositionSpec, overrides: Partial<typeof users.$inferInsert> = {}) {
    n++;
    const label = specLabel(spec);
    const user = db
      .insert(users)
      .values({ email: `${label.replace(/[^a-z0-9_]/gi, '_')}${n}@test.local`, name: `${label} ${n}`, passwordHash: await hashed!, ...overrides })
      .returning()
      .get()!;
    const ids = positionIdsFor(spec);
    db.insert(userPositions)
      .values(ids.map((positionId) => ({ userId: user.id, positionId })))
      .run();
    return user;
  }

  /** Replace a user's positions directly in the database. */
  function setPositions(userId: number, spec: PositionSpec) {
    const ids = positionIdsFor(spec);
    db.delete(userPositions).where(eq(userPositions.userId, userId)).run();
    db.insert(userPositions)
      .values(ids.map((positionId) => ({ userId, positionId })))
      .run();
  }

  /** Sign in as an existing user and return a client carrying their cookie. */
  async function login(emailAddr: string, password = PASSWORD): Promise<Client> {
    const res = await makeClient(app).post('/api/auth/login', { email: emailAddr, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    return makeClient(app, setCookie.split(';')[0]);
  }

  /** Create a user holding these position(s) and return a signed-in client (with .user). */
  async function as(spec: PositionSpec, overrides: Partial<typeof users.$inferInsert> = {}) {
    const user = await createUser(spec, overrides);
    const client = await login(user.email);
    return Object.assign(client, { user });
  }

  return {
    app,
    db,
    config,
    anon: makeClient(app),
    createUser,
    setPositions,
    positionId,
    login,
    as,
    password: PASSWORD,
    cleanup: () => fs.rmSync(uploadsDir, { recursive: true, force: true }),
  };
}

/** A tiny valid PNG (1×1) for upload tests. */
export const PNG_1PX = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);

export async function uploadPng(client: Client): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'pic.png');
  const res = await client.post('/api/files', form);
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}
