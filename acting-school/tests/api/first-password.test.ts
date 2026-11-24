import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authSessions, pushSubscriptions, users } from '../../src/server/db/schema';
import { hashPassword, verifyPassword } from '../../src/server/lib/password';
import { fakeBrowser } from '../pushHelpers';
import { makeTestContext, type Client } from '../helpers';

/**
 * Part I2 — a first password is temporary. Whenever someone else sets a
 * person's password (a manager adding them, a manager's reset, the operator's
 * tool) the account is marked must_change_password: the person can sign in,
 * but every API route outside /api/auth answers 403 `password_change_required`
 * until they have chosen their own password (POST /api/auth/choose-password).
 */
type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const TEMP = 'temporary1';

/** A member added by the director, with the temporary password above. Returns their id and username. */
async function addMember(t: Ctx, director: Client, username = 'ahmed', over: Record<string, unknown> = {}) {
  const res = await director.post('/api/staff', { name: 'Ahmed Abdellah', username, positionIds: [t.positionId('head_of_casting')], password: TEMP, ...over });
  expect(res.status).toBe(201);
  return res.body as { id: number; username: string; email: string; mustChangePassword: boolean };
}

const flag = (t: Ctx, id: number) => t.db.select({ f: users.mustChangePassword }).from(users).where(eq(users.id, id)).get()!.f;
const sessionsOf = (t: Ctx, id: number) => t.db.select().from(authSessions).where(eq(authSessions.userId, id)).all().length;
const isGateRefusal = (res: { status: number; body: any }) => res.status === 403 && res.body?.error?.code === 'password_change_required';

/** Every API route of the app as [method, path with its params filled in] — from the app's own route table. */
function apiRoutes(t: Ctx): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const r of t.app.routes) {
    if (r.method === 'ALL' || r.path.includes('*') || !r.path.startsWith('/api/')) continue;
    const path = r.path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, '1');
    const key = `${r.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([r.method, path]);
  }
  return out;
}

const send = (client: Client, method: string, path: string) =>
  method === 'GET' ? client.get(path) : method === 'DELETE' ? client.delete(path) : client[method.toLowerCase() as 'post' | 'put' | 'patch'](path, {});

describe('who gets a temporary password', () => {
  it('a member a manager adds; not the owner who set the school up, not an account that already had its own', async () => {
    const t = await makeTestContext();
    const setup = await t.anon.post('/api/auth/setup', { schoolName: 'Turquoise', name: 'Owner', email: 'owner@example.com', password: 'owner-password' });
    expect(setup.body.user.mustChangePassword).toBe(false);
    const owner = await t.login('owner', 'owner-password');
    const member = await addMember(t, owner);
    expect(member.mustChangePassword).toBe(true);
    expect(flag(t, member.id)).toBe(true);
    expect((await owner.get(`/api/staff/${member.id}`)).body.mustChangePassword).toBe(true);

    // The sign-in answer itself says so, and so does /auth/me: the session exists.
    const signedIn = await t.anon.post('/api/auth/login', { username: 'ahmed', password: TEMP });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user).toMatchObject({ id: member.id, username: 'ahmed', mustChangePassword: true });
    const ahmed = await t.login('ahmed', TEMP);
    expect((await ahmed.get('/api/auth/me')).body.user).toMatchObject({ id: member.id, mustChangePassword: true, permissions: expect.arrayContaining(['castings.read']) });
    expect((await owner.get('/api/auth/me')).body.user.mustChangePassword).toBe(false);
    // test users made directly in the database (t.as) have their own password.
    expect((await (await t.as('acting_coach')).get('/api/auth/me')).body.user.mustChangePassword).toBe(false);
  });

  it('a manager’s reset makes the password temporary again and keeps the normal policy; your own reset doesn’t', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const coach = await t.as('acting_coach');
    expect(flag(t, coach.user.id)).toBe(false);

    // The policy for a manager's reset is the normal one (at least 8 characters).
    const short = await director.patch(`/api/staff/${coach.user.id}`, { password: 'layla12' });
    expect([short.status, short.body.error.issues[0]]).toEqual([400, expect.objectContaining({ path: ['password'], message: 'errors.passwordTooShort' })]);
    expect(flag(t, coach.user.id)).toBe(false);

    const reset = await director.patch(`/api/staff/${coach.user.id}`, { password: 'layla12345' });
    expect(reset.status).toBe(200);
    expect(reset.body.mustChangePassword).toBe(true);
    // Signed out everywhere; the next sign-in is with the temporary password and opens only the password screen.
    expect((await coach.get('/api/auth/me')).body.user).toBeNull();
    const again = await t.login(coach.user.email, 'layla12345');
    expect((await again.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
    expect(isGateRefusal(await again.get('/api/courses'))).toBe(true);

    // A change that isn't a password leaves the mark alone, both ways.
    expect((await director.patch(`/api/staff/${coach.user.id}`, { name: 'Layla H.' })).body.mustChangePassword).toBe(true);
    expect((await director.patch(`/api/staff/${director.user.id}`, { name: 'Dalia' })).body.mustChangePassword).toBe(false);
    // Setting your own password through the same route is your own choice: no mark, this device stays signed in.
    const own = await director.patch(`/api/staff/${director.user.id}`, { password: 'my-own-choice-1' });
    expect([own.status, own.body.mustChangePassword]).toEqual([200, false]);
    expect((await director.get('/api/staff')).status).toBe(200);
  });
});

describe('the gate: with a temporary password only the auth routes answer', () => {
  it('every other API route is a 403 password_change_required — walked from the app’s own route table', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    await addMember(t, owner, 'ahmed', { positionIds: [t.positionId('ceo')] }); // an owner position: nothing but the gate could refuse
    const ahmed = await t.login('ahmed', TEMP);

    const routes = apiRoutes(t);
    const gated = routes.filter(([, p]) => !p.startsWith('/api/auth/') && p !== '/api/health');
    // The whole API is in the walk: every module's router, not a hand-kept list.
    expect(gated.length).toBeGreaterThan(100);
    for (const prefix of ['files', 'staff', 'positions', 'settings', 'students', 'courses', 'sessions', 'talent', 'castings', 'submissions', 'leads', 'schedule', 'dashboard', 'site', 'casting-applications', 'team', 'chat', 'summons', 'notifications', 'push']) {
      expect(gated.some(([, p]) => p === `/api/${prefix}` || p.startsWith(`/api/${prefix}/`)), prefix).toBe(true);
    }

    const open: string[] = [];
    for (const [method, path] of gated) {
      const res = await send(ahmed, method, path);
      if (!isGateRefusal(res)) open.push(`${method} ${path} → ${res.status}`);
      // Nothing but the refusal comes back.
      else expect(res.body).toEqual({ error: { code: 'password_change_required', message: 'Choose your own password first' } });
    }
    expect(open).toEqual([]);

    // The same requests from someone with their own password are never refused that way…
    const wrongly: string[] = [];
    for (const [method, path] of gated.filter(([m]) => m === 'GET')) {
      const res = await send(owner, method, path);
      if (isGateRefusal(res)) wrongly.push(`${method} ${path}`);
    }
    expect(wrongly).toEqual([]);
    // …and signed-out ones get the usual 401, not the gate's answer.
    expect((await t.anon.get('/api/students')).status).toBe(401);
    // A route that doesn't exist is refused too (nothing to probe), instead of the 404.
    expect(isGateRefusal(await ahmed.get('/api/no-such-route'))).toBe(true);
    expect((await owner.get('/api/no-such-route')).status).toBe(404);
  }, 60_000);

  it('uploads, file downloads and writes are refused before anything is read or stored', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'x.png');
    expect(isGateRefusal(await ahmed.post('/api/files', form))).toBe(true);
    expect(isGateRefusal(await ahmed.post('/api/castings', { title: 'A casting', type: 'film' }))).toBe(true);
    expect(isGateRefusal(await ahmed.post('/api/chat/conversations', { userId: director.user.id }))).toBe(true);
    expect(isGateRefusal(await ahmed.post('/api/push/subscribe', (await fakeBrowser()).subscription))).toBe(true);
    expect(t.db.select().from(pushSubscriptions).all()).toEqual([]);
    expect((await director.get('/api/castings')).body.items).toEqual([]);
    expect(flag(t, member.id)).toBe(true);
  });

  it('the auth routes still answer: me, sign-out, and the public parts of the app are not behind the gate', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);
    expect((await ahmed.get('/api/auth/me')).body).toMatchObject({ needsSetup: false, user: { username: 'ahmed', mustChangePassword: true } });
    expect((await ahmed.get('/api/health')).status).toBe(200);
    // The public website has no session at all.
    expect((await ahmed.raw('/site/en', { headers: { cookie: ahmed.cookie! } })).status).toBe(200);
    // The language can be switched on the password screen (the profile is an auth route).
    expect((await ahmed.patch('/api/auth/profile', { locale: 'ar' })).body.user).toMatchObject({ locale: 'ar', mustChangePassword: true });
    expect((await ahmed.post('/api/auth/logout')).status).toBe(200);
    expect((await ahmed.get('/api/auth/me')).body.user).toBeNull();
    expect((await ahmed.get('/api/students')).status).toBe(401);
  });

  it('the operator endpoints (bearer token, no session) are not affected', async () => {
    const TOKEN = 'test-admin-token-0123456789abcdef';
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const director = await t.as('executive_director');
    await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);
    const res = await ahmed.raw('/api/admin/grant-owner', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, cookie: ahmed.cookie! },
      body: JSON.stringify({ username: 'nobody.here' }),
    });
    expect(res.status).toBe(404);
    // Without the token it is the usual 401, with or without the session.
    expect((await ahmed.post('/api/admin/grant-owner', { username: 'ahmed' })).status).toBe(401);
  });
});

describe('choosing your own password lifts the gate', () => {
  it('the new password meets the policy and differs from the temporary one; then everything opens', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);

    const short = await ahmed.post('/api/auth/choose-password', { newPassword: 'ahmed12' });
    expect([short.status, short.body.error.issues]).toEqual([400, [expect.objectContaining({ path: ['newPassword'], message: 'errors.passwordTooShort' })]]);
    const same = await ahmed.post('/api/auth/choose-password', { newPassword: TEMP });
    expect([same.status, same.body.error.issues]).toEqual([400, [{ path: ['newPassword'], code: 'custom', message: 'errors.passwordSameAsTemporary' }]]);
    expect((await ahmed.post('/api/auth/choose-password', {})).status).toBe(400);
    expect(flag(t, member.id)).toBe(true);
    expect(isGateRefusal(await ahmed.get('/api/castings'))).toBe(true);

    const ok = await ahmed.post('/api/auth/choose-password', { newPassword: 'chosen-by-ahmed' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: member.id, username: 'ahmed', mustChangePassword: false });
    expect(ok.body.user.passwordHash).toBeUndefined();
    expect(flag(t, member.id)).toBe(false);
    expect(await verifyPassword('chosen-by-ahmed', t.db.select().from(users).where(eq(users.id, member.id)).get()!.passwordHash)).toBe(true);

    // The same session carries on, into the app.
    expect((await ahmed.get('/api/auth/me')).body.user.mustChangePassword).toBe(false);
    expect((await ahmed.get('/api/castings')).status).toBe(200);
    expect((await ahmed.get('/api/team')).status).toBe(200);
    // The temporary password is dead; the chosen one signs in, with no gate.
    expect((await t.anon.post('/api/auth/login', { username: 'ahmed', password: TEMP })).status).toBe(401);
    const later = await t.anon.post('/api/auth/login', { username: 'ahmed', password: 'chosen-by-ahmed' });
    expect(later.body.user.mustChangePassword).toBe(false);
    expect((await director.get(`/api/staff/${member.id}`)).body.mustChangePassword).toBe(false);

    // Once chosen there is nothing left to choose: 409, and the password stays.
    const again = await ahmed.post('/api/auth/choose-password', { newPassword: 'another-one-12' });
    expect([again.status, again.body.error.code]).toEqual([409, 'password_change_not_required']);
    expect((await t.anon.post('/api/auth/login', { username: 'ahmed', password: 'another-one-12' })).status).toBe(401);
  });

  it('ends the person’s other sessions (and their phone alerts), keeps this one', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director);
    const phone = await t.login('ahmed', TEMP);
    const laptop = await t.login('ahmed', TEMP);
    const tablet = await t.login('ahmed@turquoisestudio.app', TEMP);
    expect(sessionsOf(t, member.id)).toBe(3);
    // (A subscription can't be made behind the gate; one left from before a reset would be tied to an ended session.)
    expect((await phone.post('/api/auth/choose-password', { newPassword: 'chosen-by-ahmed' })).status).toBe(200);
    expect(sessionsOf(t, member.id)).toBe(1);
    expect((await phone.get('/api/auth/me')).body.user.id).toBe(member.id);
    expect((await laptop.get('/api/auth/me')).body.user).toBeNull();
    expect((await tablet.get('/api/auth/me')).body.user).toBeNull();
    // Nobody else's session is touched.
    expect((await director.get('/api/auth/me')).body.user.id).toBe(director.user.id);
  });

  it('needs a session, and only an account with a temporary password may use it', async () => {
    const t = await makeTestContext();
    expect((await t.anon.post('/api/auth/choose-password', { newPassword: 'whatever-123' })).status).toBe(401);
    const coach = await t.as('acting_coach');
    const res = await coach.post('/api/auth/choose-password', { newPassword: 'whatever-123' });
    expect([res.status, res.body.error.code]).toEqual([409, 'password_change_not_required']);
    // Their password is untouched: changing it takes the current one (POST /api/auth/password).
    await t.login(coach.user.email);
  });

  it('a temporary password shorter than the policy (the operator’s tool: "ali789") signs in, and is replaced by one that meets it', async () => {
    const t = await makeTestContext();
    const row = t.db
      .insert(users)
      .values({ username: 'ali', email: 'ali@turquoisestudio.app', name: 'Ali El Gohary', passwordHash: await hashPassword('ali789'), mustChangePassword: true })
      .returning()
      .get();
    const ali = await t.login('ali', 'ali789');
    expect((await ali.get('/api/auth/me')).body.user).toMatchObject({ id: row.id, mustChangePassword: true });
    expect(isGateRefusal(await ali.get('/api/team'))).toBe(true);
    expect((await ali.post('/api/auth/choose-password', { newPassword: 'ali7894' })).status).toBe(400);
    expect((await ali.post('/api/auth/choose-password', { newPassword: 'ali789' })).status).toBe(400);
    expect((await ali.post('/api/auth/choose-password', { newPassword: 'ali-chose-this' })).status).toBe(200);
    expect((await ali.get('/api/team')).status).toBe(200);
    expect((await t.anon.post('/api/auth/login', { username: 'ali', password: 'ali789' })).status).toBe(401);
  });

  it('"Change password" in My profile (current + new) lifts it too, with the same "not the temporary one again" rule', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);
    const other = await t.login('ahmed', TEMP);
    const same = await ahmed.post('/api/auth/password', { currentPassword: TEMP, newPassword: TEMP });
    expect([same.status, same.body.error.issues]).toEqual([400, [{ path: ['newPassword'], code: 'custom', message: 'errors.passwordSameAsTemporary' }]]);
    expect((await ahmed.post('/api/auth/password', { currentPassword: 'not-it-at-all', newPassword: 'chosen-by-ahmed' })).status).toBe(400);
    expect(flag(t, member.id)).toBe(true);
    expect((await ahmed.post('/api/auth/password', { currentPassword: TEMP, newPassword: 'chosen-by-ahmed' })).status).toBe(200);
    expect(flag(t, member.id)).toBe(false);
    expect((await ahmed.get('/api/castings')).status).toBe(200);
    expect((await other.get('/api/auth/me')).body.user).toBeNull();
    // With a password of their own, "the same again" is not this rule's business (as before).
    expect((await ahmed.post('/api/auth/password', { currentPassword: 'chosen-by-ahmed', newPassword: 'chosen-by-ahmed' })).status).toBe(200);
  });

  it('"Change password" can’t keep the temporary password by spelling it another way (scrypt reads "ｓalma789" as "salma789")', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director, 'salmat', { password: 'salma789' });
    const salma = await t.login('salmat', 'salma789');
    for (const lookAlike of ['ｓalma789', 'salma７８９', 'ｓａｌｍａ７８９']) {
      expect(lookAlike).not.toBe('salma789');
      const res = await salma.post('/api/auth/password', { currentPassword: 'salma789', newPassword: lookAlike });
      expect([res.status, res.body.error?.issues], lookAlike).toEqual([400, [{ path: ['newPassword'], code: 'custom', message: 'errors.passwordSameAsTemporary' }]]);
      // choose-password refuses it the same way.
      expect((await salma.post('/api/auth/choose-password', { newPassword: lookAlike })).status, lookAlike).toBe(400);
    }
    expect(flag(t, member.id)).toBe(true);
    expect(isGateRefusal(await salma.get('/api/team'))).toBe(true);
    // The temporary password still signs in, and still opens nothing else.
    expect((await t.anon.post('/api/auth/login', { username: 'salmat', password: 'salma789' })).body.user.mustChangePassword).toBe(true);
  });

  it('a reset while the person is choosing: the choice made against the old temporary password is refused', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);
    // The manager resets it again; Ahmed's session ends with it.
    expect((await director.patch(`/api/staff/${member.id}`, { password: 'second-temp-1' })).status).toBe(200);
    expect((await ahmed.post('/api/auth/choose-password', { newPassword: 'chosen-by-ahmed' })).status).toBe(401);
    expect(flag(t, member.id)).toBe(true);
    const fresh = await t.login('ahmed', 'second-temp-1');
    expect((await fresh.post('/api/auth/choose-password', { newPassword: 'second-temp-1' })).status).toBe(400);
    expect((await fresh.post('/api/auth/choose-password', { newPassword: 'chosen-by-ahmed' })).status).toBe(200);
  });

  it('a deactivated account can’t use a temporary password at all', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const member = await addMember(t, director);
    const ahmed = await t.login('ahmed', TEMP);
    expect((await director.patch(`/api/staff/${member.id}`, { active: false })).status).toBe(200);
    expect((await ahmed.post('/api/auth/choose-password', { newPassword: 'chosen-by-ahmed' })).status).toBe(401);
    expect((await t.anon.post('/api/auth/login', { username: 'ahmed', password: TEMP })).status).toBe(401);
  });
});
