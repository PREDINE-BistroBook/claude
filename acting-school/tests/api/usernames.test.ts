import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginFailures, users } from '../../src/server/db/schema';
import { makeTestContext } from '../helpers';

/**
 * Part I1 — usernames: signing in with a username or an email address (one
 * field), the brakes staying per account, adding a team member by username,
 * changing a username (a manager's and your own), the email address that goes
 * with it, and what a "taken" answer may give away (nothing about whose).
 */
type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const signIn = (t: Ctx, body: Record<string, unknown>) => t.anon.post('/api/auth/login', body);
const newMember = (t: Ctx, over: Record<string, unknown> = {}) => ({
  name: 'Ahmed Abdellah',
  username: 'ahmed',
  positionIds: [t.positionId('casting_team')],
  password: 'temporary1',
  ...over,
});
const row = (t: Ctx, id: number) => t.db.select().from(users).where(eq(users.id, id)).get()!;

afterEach(() => {
  vi.useRealTimers();
});

describe('sign in with a username or an email address', () => {
  it('one field takes either, trimmed and in any letter case; the old `email` field still works', async () => {
    const t = await makeTestContext();
    const u = await t.createUser('executive_director', { email: 'salma@turquoisestudio.app', username: 'salma', name: 'Salma' });
    for (const body of [
      { username: 'salma' },
      { username: '  SALMA ' },
      { username: 'salma@turquoisestudio.app' },
      { username: ' Salma@TurquoiseStudio.App' },
      // An installed app that hasn't updated yet sends the field under its old name — with either kind of name.
      { email: 'salma@turquoisestudio.app' },
      { email: 'Salma' },
    ]) {
      const res = await signIn(t, { ...body, password: t.password });
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(res.body.user).toMatchObject({ id: u.id, username: 'salma', email: 'salma@turquoisestudio.app', mustChangePassword: false });
      expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    }
    // t.login (what every other test signs in with) takes a username too.
    expect((await (await t.login('salma')).get('/api/auth/me')).body.user.id).toBe(u.id);
  });

  it('answers a wrong password, an unknown username, an unknown email and a deactivated account exactly alike', async () => {
    const t = await makeTestContext();
    await t.createUser('admin', { email: 'salma@example.com', username: 'salma' });
    await t.createUser('agent', { email: 'gone@example.com', username: 'gone', active: false });
    const answers = [];
    for (const body of [
      { username: 'salma', password: 'nope-nope' },
      { username: 'salma@example.com', password: 'nope-nope' },
      { username: 'nobody', password: 'nope-nope' },
      { username: 'nobody@example.com', password: 'nope-nope' },
      { username: 'gone', password: t.password },
      { username: 'not a username at all — سلمى', password: 'nope-nope' },
    ]) {
      const res = await signIn(t, body);
      answers.push([res.status, res.body, res.headers.get('set-cookie')]);
    }
    for (const a of answers) expect(a).toEqual([401, { error: { code: 'invalid_credentials', message: 'Username or password is incorrect' } }, null]);
  });

  it('a name nobody has costs a password hash too (the time doesn’t say which names exist)', async () => {
    const t = await makeTestContext({ clientIp: (c) => c.req.header('x-test-ip') });
    await t.createUser('admin', { email: 'salma@example.com', username: 'salma' });
    const timed = async (username: string, ip: string) => {
      const started = performance.now();
      const res = await t.app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', 'x-test-ip': ip },
        body: JSON.stringify({ username, password: 'wrong-wrong' }),
      });
      expect(res.status).toBe(401);
      return performance.now() - started;
    };
    await timed('warm-up', '10.0.0.1'); // the dummy hash is made once
    let known = 0;
    let unknown = 0;
    for (let i = 0; i < 4; i++) {
      known += await timed('salma', `10.0.1.${i}`);
      unknown += await timed(`nobody${i}`, `10.0.2.${i}`);
    }
    expect(unknown).toBeGreaterThan(known / 3);
    expect(known).toBeGreaterThan(unknown / 3);
  });

  it('needs a name: 400 on `username` when neither field is sent', async () => {
    const t = await makeTestContext();
    const res = await signIn(t, { password: 'whatever1' });
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toEqual([{ path: ['username'], code: 'custom', message: 'errors.required' }]);
    expect((await signIn(t, { username: '   ', password: 'whatever1' })).status).toBe(400);
  });
});

describe('the sign-in brakes stay per account', () => {
  it('failures by username and by email count together, and stop both names before any hashing', async () => {
    const t = await makeTestContext();
    const u = await t.createUser('admin', { email: 'salma@example.com', username: 'salma' });
    let hashed = 0;
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      // Alternating the two names of the one account: no extra guesses that way.
      expect((await signIn(t, { username: i % 2 ? 'salma' : 'salma@example.com', password: 'wrong-wrong' })).status).toBe(401);
      hashed += performance.now() - started;
    }
    const brake = t.db.select().from(loginFailures).where(eq(loginFailures.key, 'account:salma@example.com|')).get();
    expect(brake).toMatchObject({ email: 'salma@example.com', count: 10 });
    // No second count under the username.
    expect(t.db.select().from(loginFailures).all().map((r) => r.key).sort()).toEqual(['account:salma@example.com', 'account:salma@example.com|', 'school']);

    const started = performance.now();
    for (const body of [{ username: 'salma' }, { username: 'salma@example.com' }, { email: 'salma@example.com' }, { username: 'SALMA' }, { username: 'salma' }]) {
      const res = await signIn(t, { ...body, password: t.password });
      expect([res.status, res.body.error.code]).toEqual([429, 'too_many_attempts']);
    }
    const stopped = performance.now() - started;
    // Five refusals (no scrypt) take a fraction of the ten sign-ins that hashed.
    expect(stopped).toBeLessThan(hashed / 4);
    expect(row(t, u.id).lastLoginAt).toBeNull();

    // The window passes: the next good sign-in works and clears the count from this address.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000);
    expect((await signIn(t, { username: 'salma', password: t.password })).status).toBe(200);
    expect(t.db.select().from(loginFailures).where(eq(loginFailures.key, 'account:salma@example.com|')).get()).toBeUndefined();
  });

  it('a name that is nobody’s is braked the same way, in its email form — so it tells nothing apart', async () => {
    const t = await makeTestContext();
    // An account whose address is the automatic one, and nobody called "ghost".
    await t.createUser('admin', { email: 'salma@turquoisestudio.app', username: 'salma' });
    for (const name of ['salma', 'ghost']) {
      for (let i = 0; i < 10; i++) expect((await signIn(t, { username: name, password: 'wrong-wrong' })).status).toBe(401);
    }
    // Stopped by its bare name and by the address that goes with it — whether or not the account exists.
    for (const name of ['salma', 'ghost']) {
      expect((await signIn(t, { username: name, password: 'wrong-wrong' })).status, name).toBe(429);
      expect((await signIn(t, { username: `${name}@turquoisestudio.app`, password: 'wrong-wrong' })).status, name).toBe(429);
    }
    const keys = t.db.select().from(loginFailures).all().map((r) => r.key);
    expect(keys).toContain('account:ghost@turquoisestudio.app|');
    expect(keys).toContain('account:salma@turquoisestudio.app|');
    // Someone else is not caught up in it (the school-wide brake is 30 a minute; 20 were counted).
    const other = await t.createUser('agent', { email: 'ali@turquoisestudio.app', username: 'ali' });
    expect((await signIn(t, { username: 'ali', password: t.password })).body.user.id).toBe(other.id);
  });

  it('the email-domain setting decides that email form', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    expect((await owner.patch('/api/settings', { emailDomain: 'studio.example' })).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await signIn(t, { username: 'ghost', password: 'wrong-wrong' })).status).toBe(401);
    expect(t.db.select().from(loginFailures).all().map((r) => r.key)).toContain('account:ghost@studio.example|');
    expect((await signIn(t, { username: 'ghost@studio.example', password: 'wrong-wrong' })).status).toBe(429);
  });

  it('from one address 10 failures stop that address only; lockout recovery by username lifts the brakes', async () => {
    const TOKEN = 'test-admin-token-0123456789abcdef';
    const t = await makeTestContext({ config: { adminToken: TOKEN }, clientIp: (c) => c.req.header('x-test-ip') });
    const ceo = await t.createUser('owner', { email: 'ceo@turquoisestudio.app', username: 'ceo' });
    const from = async (ip: string, username: string, password: string) =>
      (
        await t.app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', 'x-test-ip': ip },
          body: JSON.stringify({ username, password }),
        })
      ).status;
    for (let i = 0; i < 10; i++) expect(await from('203.0.113.9', 'ceo', 'wrong-wrong')).toBe(401);
    expect(await from('203.0.113.9', 'ceo', t.password)).toBe(429);
    expect(await from('203.0.113.9', 'ceo@turquoisestudio.app', t.password)).toBe(429);
    expect(await from('198.51.100.7', 'ceo', t.password)).toBe(200);

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await t.anon.raw('/api/admin/grant-owner', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ username: 'CEO' }),
    });
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, username: 'ceo', email: 'ceo@turquoisestudio.app' });
    expect(t.db.select().from(loginFailures).where(eq(loginFailures.email, ceo.email)).all()).toEqual([]);
    expect(await from('203.0.113.9', 'ceo', t.password)).toBe(200);
    // Neither name sent: 400. Nobody by that name: 404.
    const call = (body: unknown) =>
      t.anon.raw('/api/admin/grant-owner', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
    expect((await call({})).status).toBe(400);
    expect((await call({ username: 'nobody' })).status).toBe(404);
  });
});

describe('first-run setup', () => {
  it('takes the owner’s username, or makes one from the email address', async () => {
    const typed = await makeTestContext();
    const res = await typed.anon.post('/api/auth/setup', { schoolName: 'Turquoise', name: 'Ahmed Tamam', username: 'CEO', email: 'ahmed@example.com', password: 'longenough' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'ceo', email: 'ahmed@example.com', mustChangePassword: false, isOwner: true });
    expect((await signIn(typed, { username: 'ceo', password: 'longenough' })).status).toBe(200);

    const derived = await makeTestContext();
    const made = await derived.anon.post('/api/auth/setup', { schoolName: 'Turquoise', name: 'Ahmed Tamam', email: 'Owner@Example.com', password: 'longenough' });
    expect(made.body.user).toMatchObject({ username: 'owner', email: 'owner@example.com' });

    const bad = await makeTestContext();
    const refused = await bad.anon.post('/api/auth/setup', { schoolName: 'Turquoise', name: 'A', username: 'x', email: 'a@example.com', password: 'longenough' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.issues[0]).toMatchObject({ path: ['username'], message: 'errors.usernameInvalid' });
  });
});

describe('adding a team member (POST /api/staff)', () => {
  it('asks for a username; the email address is filled in as <username>@<emailDomain>', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const res = await director.post('/api/staff', newMember(t, { username: ' Ahmed ' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Ahmed Abdellah', username: 'ahmed', email: 'ahmed@turquoisestudio.app', mustChangePassword: true, active: true });
    expect(row(t, res.body.id)).toMatchObject({ username: 'ahmed', email: 'ahmed@turquoisestudio.app' });
    // They sign in with the username (or that address) and the first password.
    for (const name of ['ahmed', 'ahmed@turquoisestudio.app']) expect((await signIn(t, { username: name, password: 'temporary1' })).status).toBe(200);

    // The domain is a setting.
    expect((await (await t.as('owner')).patch('/api/settings', { emailDomain: 'Studio.Example' })).body.emailDomain).toBe('studio.example');
    const next = await director.post('/api/staff', newMember(t, { name: 'Taha', username: 'taha' }));
    expect(next.body.email).toBe('taha@studio.example');
    // Accounts that exist keep their address.
    expect(row(t, res.body.id).email).toBe('ahmed@turquoisestudio.app');
  });

  it('an email typed by the manager overrides the automatic one', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const res = await director.post('/api/staff', newMember(t, { email: ' Ahmed.A@Gmail.com ' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ username: 'ahmed', email: 'ahmed.a@gmail.com' });
    // Left empty: the automatic one.
    const blank = await director.post('/api/staff', newMember(t, { name: 'Ali', username: 'ali', email: '' }));
    expect(blank.body.email).toBe('ali@turquoisestudio.app');
    expect((await director.post('/api/staff', newMember(t, { username: 'ayman', email: 'not-an-email' }))).status).toBe(400);
  });

  it('refuses a username that breaks the rules, with the rules as the message', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    for (const bad of ['ab', '2fast', 'has space', 'سلمى', 'way.too.long.for.a.username', 'semi;colon']) {
      const res = await director.post('/api/staff', newMember(t, { username: bad }));
      expect(res.status, bad).toBe(400);
      expect(res.body.error.issues[0], bad).toMatchObject({ path: ['username'], message: 'errors.usernameInvalid' });
    }
    // Neither a username nor an email: the username is what's missing.
    const none = await director.post('/api/staff', { name: 'X', positionIds: [t.positionId('casting_team')], password: 'temporary1' });
    expect(none.status).toBe(400);
    expect(none.body.error.issues).toEqual([{ path: ['username'], code: 'custom', message: 'errors.required' }]);
    expect(t.db.select().from(users).all()).toHaveLength(1);
  });

  it('a taken username is a 409 on `username` — in any letter case, and for an inactive account’s too', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    await t.createUser('agent', { username: 'ahmed', email: 'someone@example.com', active: false });
    for (const username of ['ahmed', 'AHMED', ' Ahmed ']) {
      const res = await director.post('/api/staff', newMember(t, { username }));
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: 'username_taken',
        message: 'Another account already uses this username',
        issues: [{ path: ['username'], code: 'custom', message: 'errors.usernameTaken' }],
      });
    }
    // The suggestion for the same person: first.last.
    const check = await director.get('/api/staff/username-check?name=Ahmed%20Abdellah&username=ahmed');
    expect(check.body).toEqual({ username: 'ahmed', status: 'taken', suggestion: 'ahmed.abdellah', automaticEmail: 'ahmed@turquoisestudio.app' });
    expect((await director.post('/api/staff', newMember(t, { username: check.body.suggestion }))).status).toBe(201);
  });

  it('a username whose automatic address is someone’s email reads as taken; a typed email that is taken is a 409 on `email`', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    await t.createUser('agent', { username: 'moaty', email: 'ahmed@turquoisestudio.app' });
    const clash = await director.post('/api/staff', newMember(t));
    expect([clash.status, clash.body.error.code, clash.body.error.issues[0].path]).toEqual([409, 'username_taken', ['username']]);
    // With another address of their own, the username is fine.
    expect((await director.post('/api/staff', newMember(t, { email: 'ahmed@elsewhere.example' }))).status).toBe(201);
    const email = await director.post('/api/staff', newMember(t, { username: 'ayman', email: 'AHMED@turquoisestudio.app' }));
    expect([email.status, email.body.error.code, email.body.error.issues[0]]).toEqual([409, 'email_taken', { path: ['email'], code: 'custom', message: 'staff:errors.emailTaken' }]);
  });

  it('an older copy of the app (an email, no username) still adds people: the username comes from the address', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const base = { positionIds: [t.positionId('casting_team')], password: 'temporary1' };
    expect((await director.post('/api/staff', { ...base, name: 'Nadia Haddad', email: 'Nadia@Example.com' })).body).toMatchObject({ username: 'nadia', email: 'nadia@example.com' });
    // The same first part again: the name's first.last, then a number. Nothing usable before the "@": from the name; else "user".
    expect((await director.post('/api/staff', { ...base, name: 'Nadia Two', email: 'nadia@elsewhere.example' })).body.username).toBe('nadia.two');
    expect((await director.post('/api/staff', { ...base, name: 'Nadia Two', email: 'nadia@third.example' })).body.username).toBe('nadia2');
    expect((await director.post('/api/staff', { ...base, name: 'Omar Sharif', email: '1@example.com' })).body.username).toBe('omar');
    expect((await director.post('/api/staff', { ...base, name: 'عمر', email: '2@example.com' })).body.username).toBe('user');
    expect((await director.post('/api/staff', { ...base, name: 'علي', email: '3@example.com' })).body.username).toBe('user2');
  });
});

describe('GET /api/staff/username-check', () => {
  it('says whether a username is valid and free, and what to offer for a name', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { username: 'salma', email: 'salma@turquoisestudio.app', name: 'Salma' });
    await t.createUser('agent', { username: 'ahmed', email: 'ahmed@turquoisestudio.app', name: 'Ahmed Abdellah' });
    await t.createUser('agent', { username: 'ahmed.tamam', email: 'ahmed.tamam@turquoisestudio.app', name: 'Ahmed Tamam' });
    const check = async (q: string) => (await director.get(`/api/staff/username-check?${q}`)).body;

    expect(await check('username=Taha')).toEqual({ username: 'taha', status: 'ok', suggestion: null, automaticEmail: 'taha@turquoisestudio.app' });
    expect(await check('username=ahmed')).toMatchObject({ status: 'taken' });
    expect(await check('username=%20AHMED%20')).toMatchObject({ username: 'ahmed', status: 'taken' });
    expect(await check('username=ab')).toEqual({ username: 'ab', status: 'invalid', suggestion: null, automaticEmail: null });
    expect(await check('username=has%20space')).toMatchObject({ status: 'invalid' });
    // The first name; taken → first.last; that too → a number.
    expect(await check('name=Taha')).toEqual({ username: null, status: null, suggestion: 'taha', automaticEmail: null });
    expect(await check('name=Ahmed%20Farouk')).toMatchObject({ suggestion: 'ahmed.farouk' });
    expect(await check('name=Ahmed%20Tamam')).toMatchObject({ suggestion: 'ahmed2' });
    expect(await check('name=Ahmed')).toMatchObject({ suggestion: 'ahmed2' });
    // A name only in Arabic: nothing to offer.
    expect(await check(`name=${encodeURIComponent('أحمد تمام')}`)).toMatchObject({ suggestion: null });
    // Editing an account: its own username is free for it.
    const ahmed = t.db.select().from(users).where(eq(users.username, 'ahmed')).get()!;
    expect(await check(`username=ahmed&exceptId=${ahmed.id}`)).toMatchObject({ status: 'ok' });
    expect(await check(`username=salma&exceptId=${ahmed.id}`)).toMatchObject({ status: 'taken' });
    expect(await check('')).toEqual({ username: null, status: null, suggestion: null, automaticEmail: null });
  });

  it('needs staff.manage', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/staff/username-check?username=x')).status).toBe(401);
    expect((await (await t.as('acting_coach')).get('/api/staff/username-check?username=salma')).status).toBe(403);
    expect((await (await t.as({ permissions: ['staff.manage'] })).get('/api/staff/username-check?username=salma')).status).toBe(200);
  });
});

describe('owner accounts stay hidden behind "taken"', () => {
  it('a non-owner manager learns that a username is taken, never whose — the same answer as any other clash', async () => {
    const t = await makeTestContext();
    const owner = await t.createUser('ceo', { username: 'ceo', email: 'ceo@turquoisestudio.app', name: 'Ahmed Tamam' });
    const coach = await t.createUser('acting_coach', { username: 'moaty', email: 'moaty@turquoisestudio.app', name: 'Moaty' });
    const director = await t.as('executive_director', { username: 'salma' });

    // The director can't see the owner's account at all…
    const list = await director.get('/api/staff');
    expect(list.body.items.map((s: { username: string }) => s.username).sort()).toEqual(['moaty', 'salma']);
    expect((await director.get(`/api/staff/${owner.id}`)).status).toBe(404);

    // …and a clash with it reads exactly like a clash with anyone else's.
    const withOwner = await director.post('/api/staff', newMember(t, { username: 'ceo' }));
    const withCoach = await director.post('/api/staff', newMember(t, { username: 'moaty' }));
    expect(withOwner.status).toBe(409);
    expect(withOwner.body).toEqual(withCoach.body);
    expect(JSON.stringify(withOwner.body)).not.toMatch(/Ahmed|Tamam|owner|"id"/i);

    const checkOwner = (await director.get('/api/staff/username-check?username=ceo')).body;
    const checkCoach = (await director.get('/api/staff/username-check?username=moaty')).body;
    expect(checkOwner).toEqual({ ...checkCoach, username: 'ceo', automaticEmail: 'ceo@turquoisestudio.app' });
    expect(Object.keys(checkOwner).sort()).toEqual(['automaticEmail', 'status', 'suggestion', 'username']);

    // Renaming someone, or yourself, into it: the same 409.
    const rename = await director.patch(`/api/staff/${coach.id}`, { username: 'ceo' });
    const renameOther = await director.patch(`/api/staff/${coach.id}`, { username: 'salma' });
    expect(rename.status).toBe(409);
    expect(rename.body).toEqual(renameOther.body);
    const mine = await director.patch('/api/auth/profile', { username: 'ceo' });
    expect(mine.body).toEqual(rename.body);
    // And a PATCH aimed at the owner's account is still a 404, before any username is looked at.
    expect((await director.patch(`/api/staff/${owner.id}`, { username: 'anything' })).status).toBe(404);
    expect(row(t, owner.id).username).toBe('ceo');
  });
});

describe('changing a username', () => {
  it('a manager changes a member’s: the automatic address follows, sessions stay, the old name stops working', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const created = await director.post('/api/staff', newMember(t, { name: 'Mohamed Hamzawy', username: 'mohamed' }));
    expect(created.body.email).toBe('mohamed@turquoisestudio.app');
    const res = await director.patch(`/api/staff/${created.body.id}`, { username: 'Hamzawy' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'hamzawy', email: 'hamzawy@turquoisestudio.app' });
    expect((await signIn(t, { username: 'hamzawy', password: 'temporary1' })).status).toBe(200);
    expect((await signIn(t, { username: 'hamzawy@turquoisestudio.app', password: 'temporary1' })).status).toBe(200);
    expect((await signIn(t, { username: 'mohamed', password: 'temporary1' })).status).toBe(401);
    // The same username again: nothing to do.
    expect((await director.patch(`/api/staff/${created.body.id}`, { username: 'hamzawy' })).body.username).toBe('hamzawy');
  });

  it('an address of the person’s own stays; an address sent with the username wins over following', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const own = await director.post('/api/staff', newMember(t, { username: 'ahmed', email: 'ahmed@gmail.com' }));
    expect((await director.patch(`/api/staff/${own.body.id}`, { username: 'ahmed.a' })).body).toMatchObject({ username: 'ahmed.a', email: 'ahmed@gmail.com' });

    const auto = await director.post('/api/staff', newMember(t, { name: 'Taha', username: 'taha' }));
    const both = await director.patch(`/api/staff/${auto.body.id}`, { username: 'taha2', email: 'taha@turquoisestudio.app' });
    expect(both.body).toMatchObject({ username: 'taha2', email: 'taha@turquoisestudio.app' });
    // From now on that address is no longer "the automatic one" for taha2, so it stays put.
    expect((await director.patch(`/api/staff/${auto.body.id}`, { username: 'taha3' })).body).toMatchObject({ username: 'taha3', email: 'taha@turquoisestudio.app' });
  });

  it('the address a new username would bring must be free as well', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    await t.createUser('agent', { username: 'other', email: 'ayman@turquoisestudio.app' });
    const member = await director.post('/api/staff', newMember(t, { name: 'Ayman Farouk', username: 'aymanf' }));
    const res = await director.patch(`/api/staff/${member.body.id}`, { username: 'ayman' });
    expect([res.status, res.body.error.code]).toEqual([409, 'username_taken']);
    expect(row(t, member.body.id)).toMatchObject({ username: 'aymanf', email: 'aymanf@turquoisestudio.app' });
    expect((await director.get(`/api/staff/username-check?username=ayman&exceptId=${member.body.id}`)).body.status).toBe('taken');
  });

  it('follows the reach rules of every other change to an account', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await t.as({ permissions: ['staff.manage'] });
    const coach = await t.as('acting_coach');
    // Someone who can do more than you is out of reach; no staff.manage, no change; signed out, 401.
    expect((await lead.patch(`/api/staff/${director.user.id}`, { username: 'taken.over' })).status).toBe(403);
    expect((await coach.patch(`/api/staff/${lead.user.id}`, { username: 'nope' })).status).toBe(403);
    expect((await t.anon.patch(`/api/staff/${coach.user.id}`, { username: 'nope' })).status).toBe(401);
    expect((await director.patch(`/api/staff/${coach.user.id}`, { username: 'x' })).status).toBe(400);
    expect((await director.patch(`/api/staff/${coach.user.id}`, { username: 'layla' })).body.username).toBe('layla');
  });

  it('anyone changes their own in My profile, under the same rules', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const created = await director.post('/api/staff', newMember(t, { name: 'Ali El Gohary', username: 'ali' }));
    await t.createUser('agent', { username: 'taha', email: 'taha@turquoisestudio.app' });
    const ali = await t.login('ali', 'temporary1');
    // (Ali chooses his own password first: until then only the auth routes answer — the profile is one of them.)
    const res = await ali.patch('/api/auth/profile', { username: ' Ali.Gohary ' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: created.body.id, username: 'ali.gohary', email: 'ali.gohary@turquoisestudio.app' });
    // Still signed in; the new name is what signs in from now on.
    expect((await ali.get('/api/auth/me')).body.user.username).toBe('ali.gohary');
    expect((await signIn(t, { username: 'ali.gohary', password: 'temporary1' })).status).toBe(200);
    expect((await signIn(t, { username: 'ali', password: 'temporary1' })).status).toBe(401);

    const taken = await ali.patch('/api/auth/profile', { username: 'TAHA' });
    expect([taken.status, taken.body.error.code, taken.body.error.issues]).toEqual([409, 'username_taken', [{ path: ['username'], code: 'custom', message: 'errors.usernameTaken' }]]);
    const invalid = await ali.patch('/api/auth/profile', { username: 'a b' });
    expect([invalid.status, invalid.body.error.issues[0].message]).toEqual([400, 'errors.usernameInvalid']);
    // A name change alone leaves the username alone; an empty patch changes nothing.
    expect((await ali.patch('/api/auth/profile', { name: 'Ali G' })).body.user).toMatchObject({ name: 'Ali G', username: 'ali.gohary' });
    expect((await ali.patch('/api/auth/profile', {})).body.user.username).toBe('ali.gohary');
    expect((await t.anon.patch('/api/auth/profile', { username: 'nobody' })).status).toBe(401);
    // Nobody changes someone else's this way: the profile is always your own.
    expect(row(t, director.user.id).username).toBe(director.user.username);
  });
});

describe('where the username shows', () => {
  it('in /api/auth/me and the staff payloads — not in the Team list everyone sees', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { username: 'salma', email: 'salma@turquoisestudio.app' });
    const coach = await t.as('acting_coach', { username: 'moaty', email: 'moaty@turquoisestudio.app' });
    expect((await coach.get('/api/auth/me')).body.user).toMatchObject({ username: 'moaty', mustChangePassword: false });
    const list = await director.get('/api/staff');
    expect(list.body.items.map((s: { username: string }) => s.username).sort()).toEqual(['moaty', 'salma']);
    expect((await director.get(`/api/staff/${coach.user.id}`)).body).toMatchObject({ username: 'moaty', mustChangePassword: false });
    // GET /api/team is for everyone: names, photos and positions only.
    const team = await coach.get('/api/team');
    expect(team.status).toBe(200);
    for (const m of team.body.items) expect(Object.keys(m)).not.toContain('username');
    expect(JSON.stringify(team.body)).not.toContain('salma@');
    const directory = await coach.get('/api/staff/directory');
    for (const m of directory.body.items) expect(Object.keys(m)).not.toContain('username');
  });
});

describe('the emailDomain setting', () => {
  it('is turquoisestudio.app until someone with settings.manage changes it', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    expect((await coach.get('/api/settings')).body.emailDomain).toBe('turquoisestudio.app');
    expect((await coach.patch('/api/settings', { emailDomain: 'x.example' })).status).toBe(403);
    const owner = await t.as('owner');
    const bad = await owner.patch('/api/settings', { emailDomain: 'not a domain' });
    expect([bad.status, bad.body.error.issues[0]]).toEqual([400, { path: ['emailDomain'], code: 'invalid_format', message: 'settings:errors.emailDomain' }]);
    expect((await owner.patch('/api/settings', { emailDomain: '@Studio.Example' })).body.emailDomain).toBe('studio.example');
    expect((await coach.get('/api/settings')).body.emailDomain).toBe('studio.example');
  });
});
