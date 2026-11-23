import { createApp, type AppDeps } from '../src/server/app';
import { testConfig, type AppConfig } from '../src/server/config';
import { PHASE_ONE_ROLE_POSITIONS, createDb, type DB } from '../src/server/db/client';
import { eq, inArray } from 'drizzle-orm';
import { positions, userPositions, users } from '../src/server/db/schema';
import { sqliteFileStore, type FileStore } from '../src/server/lib/fileStore';
import { hashPassword } from '../src/server/lib/password';
import { durableObjectLimits } from '../src/server/lib/sqlLimits';
import { DEFAULT_TIME_ZONE, epochAt, nowTimeIn, todayIn } from '../src/server/lib/clock';
import type { BuiltInPositionKey, Permission } from '../src/shared/permissions';

/**
 * Fails any query a Cloudflare Durable Object would refuse but better-sqlite3
 * accepts (lib/sqlLimits.ts). createDb attaches it to every database opened
 * under Vitest (ACTING_SCHOOL_DO_LIMITS=1 in vitest.config.ts).
 */
export { durableObjectLimits };

/**
 * The server's clock, for expectations: the school's time zone (Africa/Cairo by
 * default), like the API — not the test runner's (vitest runs in UTC, like
 * Cloudflare Workers).
 */
export const SCHOOL_TZ = DEFAULT_TIME_ZONE;
export const todayISO = (instant: Date = new Date()) => todayIn(SCHOOL_TZ, instant);
export const nowTime = (instant: Date = new Date()) => nowTimeIn(SCHOOL_TZ, instant);
/** Epoch ms of `time` today at the school (for vi.setSystemTime). */
export const schoolTimeToday = (time: string) => epochAt(SCHOOL_TZ, todayISO(), time);

/** An in-memory database with the Durable Object limits enforced (see durableObjectLimits). */
export function testDb() {
  return createDb(':memory:', { logger: durableObjectLimits });
}

/** Fails the run when Vitest isn't enforcing the Durable Object limits on every database (vitest.config.ts). */
if (process.env.VITEST && process.env.ACTING_SCHOOL_DO_LIMITS !== '1') {
  throw new Error('Run the tests with ACTING_SCHOOL_DO_LIMITS=1 (vitest.config.ts sets it)');
}

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
export async function makeTestContext(
  opts: { config?: Partial<AppConfig>; files?: FileStore; clientIp?: AppDeps['clientIp']; outboundFetch?: typeof fetch } = {},
) {
  const config: AppConfig = testConfig(opts.config);
  const db: DB = testDb();
  // Files go into the database itself, as on Cloudflare without R2 (lib/fileStore.ts).
  const files = opts.files ?? sqliteFileStore(db);
  // Background work (push notifications) is collected so a test can wait for it: await t.settle().
  const background: Promise<unknown>[] = [];
  // Outbound calls never leave the test: a fake unless the test passes its own.
  const outboundFetch: typeof fetch = opts.outboundFetch ?? (async () => new Response(null, { status: 201 }));
  const app = createApp({ db, config, files, clientIp: opts.clientIp, waitUntil: (task) => void background.push(task), outboundFetch });
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
    files,
    anon: makeClient(app),
    createUser,
    setPositions,
    positionId,
    login,
    as,
    password: PASSWORD,
    /** Wait for the background work queued so far (push notifications sent after a response). */
    settle: async () => {
      while (background.length) await Promise.allSettled(background.splice(0));
    },
    cleanup: () => {},
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

/** Upload any bytes as a file (POST /api/files); returns the whole response. */
export async function uploadBytes(client: Client, bytes: Uint8Array | string, name: string, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type }), name);
  return client.post('/api/files', form);
}

/** A small valid PDF (one empty page). */
export const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/**
 * A ZIP (stored, no compression) holding these files — enough for the
 * Office-file check, which reads the names in the central directory.
 */
export function makeZip(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A minimal Word file (.docx) for upload tests. */
export const DOCX_BYTES = makeZip({ '[Content_Types].xml': '<Types/>', '_rels/.rels': '<Relationships/>', 'word/document.xml': '<w:document/>' });
