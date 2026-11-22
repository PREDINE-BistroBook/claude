import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/app';
import type { AppConfig } from '../src/server/config';
import { createDb, type DB } from '../src/server/db/client';
import { users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/lib/password';
import type { Role } from '../src/shared/roles';

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
 *   const admin = await t.as('admin');
 *   const res = await admin.post('/api/students', { firstName: 'A', lastName: 'B' });
 */
export async function makeTestContext() {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-school-test-'));
  const config: AppConfig = { dataDir: uploadsDir, uploadsDir, cookieSecure: false, sessionDays: 30, isProduction: false };
  const db: DB = createDb(':memory:');
  const app = createApp({ db, config });
  hashed ??= hashPassword(PASSWORD);
  let n = 0;

  /** Create a staff account directly in the database. */
  async function createUser(role: Role, overrides: Partial<typeof users.$inferInsert> = {}) {
    n++;
    return db
      .insert(users)
      .values({ email: `${role}${n}@test.local`, name: `${role} ${n}`, role, passwordHash: await hashed!, ...overrides })
      .returning()
      .get()!;
  }

  /** Sign in as an existing user and return a client carrying their cookie. */
  async function login(emailAddr: string, password = PASSWORD): Promise<Client> {
    const res = await makeClient(app).post('/api/auth/login', { email: emailAddr, password });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    return makeClient(app, setCookie.split(';')[0]);
  }

  /** Create a user with this role and return a signed-in client (with .user). */
  async function as(role: Role, overrides: Partial<typeof users.$inferInsert> = {}) {
    const user = await createUser(role, overrides);
    const client = await login(user.email);
    return Object.assign(client, { user });
  }

  return {
    app,
    db,
    config,
    anon: makeClient(app),
    createUser,
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
