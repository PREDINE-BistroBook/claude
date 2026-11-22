import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authSessions, userPositions, users } from '../../src/server/db/schema';
import { verifyPassword } from '../../src/server/lib/password';
import { makeTestContext, type LegacyRole } from '../helpers';

const ROLES: LegacyRole[] = ['owner', 'admin', 'teacher', 'agent'];
type Ctx = Awaited<ReturnType<typeof makeTestContext>>;
const newStaff = (t: Ctx, over: Record<string, unknown> = {}) => ({
  name: 'Nadia Haddad',
  email: 'Nadia@Example.com',
  positionIds: [t.positionId('acting_coach')],
  password: 'temporary1',
  ...over,
});
const keysOf = (u: { positions: { key: string | null }[] }) => u.positions.map((p) => p.key);
const positionKeys = (t: Ctx, userId: number) =>
  t.db
    .select({ id: userPositions.positionId })
    .from(userPositions)
    .where(eq(userPositions.userId, userId))
    .all()
    .map((r) => r.id)
    .sort();

describe('GET /api/staff', () => {
  it('lists staff without password hashes, active first then by name, with their positions', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner', { name: 'Mona' });
    await t.createUser('teacher', { name: 'zara' });
    await t.createUser('agent', { name: 'Adam', active: false });
    await t.createUser(['acting_coach', 'finance'], { name: 'basil' });

    const res = await owner.get('/api/staff');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: any) => s.name)).toEqual(['basil', 'Mona', 'zara', 'Adam']);
    for (const s of res.body.items) {
      expect(s.passwordHash).toBeUndefined();
      expect(Object.keys(s).sort()).toEqual(
        ['active', 'createdAt', 'email', 'id', 'isOwner', 'lastLoginAt', 'locale', 'manageable', 'name', 'phone', 'positions'].sort(),
      );
    }
    const me = res.body.items.find((s: any) => s.id === owner.user.id);
    expect(me).toMatchObject({ isOwner: true, manageable: true, active: true, locale: 'en', phone: null });
    expect(keysOf(me)).toEqual(['ceo']);
    expect(typeof me.lastLoginAt).toBe('number');
    expect(res.body.items.find((s: any) => s.name === 'Adam')).toMatchObject({ active: false, lastLoginAt: null, isOwner: false });
    // Several positions, in the positions list order.
    expect(keysOf(res.body.items.find((s: any) => s.name === 'basil'))).toEqual(['acting_coach', 'finance']);
  });

  it('is open to staff.manage (the director), 403 for coaches and casting, 401 signed out', async () => {
    const t = await makeTestContext();
    expect((await (await t.as('admin')).get('/api/staff')).status).toBe(200);
    expect((await (await t.as('teacher')).get('/api/staff')).status).toBe(403);
    expect((await (await t.as('agent')).get('/api/staff')).status).toBe(403);
    expect((await t.anon.get('/api/staff')).status).toBe(401);
  });
});

describe('GET /api/staff/directory', () => {
  it.each(['admin', 'teacher', 'agent'] as const)('answers minimal fields sorted by name, without owner accounts, for %s', async (role) => {
    const t = await makeTestContext();
    const me = await t.as(role, { name: 'Mid' });
    await t.createUser('teacher', { name: 'zed', active: false });
    await t.createUser('agent', { name: 'Amal' });
    await t.createUser('owner', { name: 'Boss' });
    await t.createUser(['cfo', 'acting_coach'], { name: 'Coach Boss' });
    const res = await me.get('/api/staff/directory');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: any) => s.name)).toEqual(['Amal', 'Mid', 'zed']);
    for (const s of res.body.items) expect(Object.keys(s).sort()).toEqual(['active', 'coach', 'id', 'name', 'positions']);
    expect(res.body.items[2]).toMatchObject({ active: false, coach: true });
    expect(keysOf(res.body.items[2])).toEqual(['acting_coach']);
    expect(res.body.items[0]).toMatchObject({ coach: false });
  });

  it('owners see everyone, owners included', async () => {
    const t = await makeTestContext();
    const me = await t.as('owner', { name: 'Mid' });
    await t.createUser('cfo', { name: 'Boss' });
    await t.createUser(['acting_coach', 'finance'], { name: 'Moaty' });
    const res = await me.get('/api/staff/directory');
    expect(res.body.items.map((s: any) => s.name)).toEqual(['Boss', 'Mid', 'Moaty']);
    // Coach + finance still counts as a coach for teacher pickers.
    expect(res.body.items[2].coach).toBe(true);
    expect(res.body.items[0].coach).toBe(false);
  });

  it('401 when signed out', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/staff/directory')).status).toBe(401);
  });
});

describe('POST /api/staff', () => {
  it('creates an account whose temporary password works', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.post('/api/staff', newStaff(t, { phone: ' 050 123 4567 ', locale: 'ar' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Nadia Haddad',
      email: 'nadia@example.com',
      phone: '050 123 4567',
      locale: 'ar',
      active: true,
      lastLoginAt: null,
      isOwner: false,
      manageable: true,
    });
    expect(keysOf(res.body)).toEqual(['acting_coach']);
    expect(res.body.passwordHash).toBeUndefined();
    const row = t.db.select().from(users).where(eq(users.id, res.body.id)).get()!;
    expect(row.passwordHash).not.toContain('temporary1');
    expect(await verifyPassword('temporary1', row.passwordHash)).toBe(true);

    const nadia = await t.login('nadia@example.com', 'temporary1');
    expect((await nadia.get('/api/auth/me')).body.user).toMatchObject({ id: res.body.id, permissions: ['students.read', 'courses.read', 'attendance.write'] });
  });

  it('gives several positions at once (duplicates ignored)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const coach = t.positionId('acting_coach');
    const finance = t.positionId('finance');
    const res = await owner.post('/api/staff', newStaff(t, { positionIds: [finance, coach, coach] }));
    expect(res.status).toBe(201);
    expect(keysOf(res.body)).toEqual(['acting_coach', 'finance']);
    expect(positionKeys(t, res.body.id)).toEqual([coach, finance].sort());
  });

  it('uses the school default language when none is given', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    await owner.patch('/api/settings', { defaultLocale: 'ar' });
    const res = await owner.post('/api/staff', newStaff(t, { phone: '' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ locale: 'ar', phone: null });
  });

  it('409 email_taken with a field issue for a duplicate email (any case)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    await t.createUser('agent', { email: 'nadia@example.com' });
    const res = await owner.post('/api/staff', newStaff(t, { email: 'NADIA@example.com' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
    expect(res.body.error.issues).toEqual([expect.objectContaining({ path: ['email'], message: 'staff:errors.emailTaken' })]);
  });

  it('only an owner may give an owner position; the director may give positions within her own access', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const owner = await t.as('owner');
    const denied = await admin.post('/api/staff', newStaff(t, { positionIds: [t.positionId('cfo')] }));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('owner_only');
    expect(t.db.select().from(users).where(eq(users.email, 'nadia@example.com')).get()).toBeUndefined();
    const ok = await owner.post('/api/staff', newStaff(t, { positionIds: [t.positionId('cfo')] }));
    expect(ok.status).toBe(201);
    expect(ok.body.isOwner).toBe(true);
    // The director may create another director (same access as hers)…
    expect((await admin.post('/api/staff', newStaff(t, { email: 'a2@example.com', positionIds: [t.positionId('executive_director')] }))).status).toBe(201);
    // …but not Finance, which allows payments.manage she doesn't hold.
    const finance = await admin.post('/api/staff', newStaff(t, { email: 'a3@example.com', positionIds: [t.positionId('finance')] }));
    expect(finance.status).toBe(403);
    expect(finance.body.error.code).toBe('exceeds_your_access');
    // Owners may.
    expect((await owner.post('/api/staff', newStaff(t, { email: 'a3@example.com', positionIds: [t.positionId('finance')] }))).status).toBe(201);
  });

  it('validates input: at least one existing position', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const res = await owner.post('/api/staff', { name: '', email: 'nope', positionIds: 'boss', password: 'short', locale: 'fr' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    const paths = res.body.error.issues.map((i: any) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'positionIds', 'password', 'locale']));
    expect(res.body.error.issues.find((i: any) => i.path[0] === 'password').message).toBe('errors.passwordTooShort');
    expect((await owner.post('/api/staff', {})).status).toBe(400);

    const none = await owner.post('/api/staff', newStaff(t, { positionIds: [] }));
    expect(none.status).toBe(400);
    expect(none.body.error.issues[0]).toMatchObject({ path: ['positionIds'], message: 'staff:errors.positionRequired' });
    const unknown = await owner.post('/api/staff', newStaff(t, { positionIds: [9999] }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.issues[0]).toMatchObject({ path: ['positionIds'], message: 'staff:errors.positionNotFound' });
    expect(t.db.select().from(users).where(eq(users.email, 'nadia@example.com')).get()).toBeUndefined();
  });

  it('403 without staff.manage, 401 signed out', async () => {
    const t = await makeTestContext();
    expect((await (await t.as('teacher')).post('/api/staff', newStaff(t))).status).toBe(403);
    expect((await (await t.as('agent')).post('/api/staff', newStaff(t))).status).toBe(403);
    expect((await (await t.as({ permissions: ['positions.manage'] })).post('/api/staff', newStaff(t))).status).toBe(403);
    expect((await t.anon.post('/api/staff', newStaff(t))).status).toBe(401);
  });
});

describe('PATCH /api/staff/:id', () => {
  it('updates details and positions', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const u = await t.createUser('teacher');
    const res = await admin.patch(`/api/staff/${u.id}`, {
      name: 'Renamed',
      email: 'New@Example.com',
      phone: '0551',
      locale: 'ar',
      positionIds: [t.positionId('head_of_casting')],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: u.id, name: 'Renamed', email: 'new@example.com', phone: '0551', locale: 'ar', active: true });
    expect(keysOf(res.body)).toEqual(['head_of_casting']);
    expect(res.body.passwordHash).toBeUndefined();

    const cleared = await admin.patch(`/api/staff/${u.id}`, { phone: '' });
    expect(cleared.body.phone).toBeNull();
    const noop = await admin.patch(`/api/staff/${u.id}`, {});
    expect(noop.status).toBe(200);
    expect(noop.body.name).toBe('Renamed');
    expect(keysOf(noop.body)).toEqual(['head_of_casting']);
  });

  it('400 for an empty or unknown position list', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const u = await t.createUser('teacher');
    const empty = await owner.patch(`/api/staff/${u.id}`, { positionIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.issues[0]).toMatchObject({ path: ['positionIds'], message: 'staff:errors.positionRequired' });
    expect((await owner.patch(`/api/staff/${u.id}`, { positionIds: [12345] })).status).toBe(400);
    expect(positionKeys(t, u.id)).toEqual([t.positionId('acting_coach')]);
  });

  it('keeps the email unique; re-saving your own email is fine', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const a = await t.createUser('agent', { email: 'a@example.com' });
    await t.createUser('agent', { email: 'b@example.com' });
    const dup = await owner.patch(`/api/staff/${a.id}`, { email: 'B@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_taken');
    expect(dup.body.error.issues[0]).toMatchObject({ path: ['email'], message: 'staff:errors.emailTaken' });
    expect((await owner.patch(`/api/staff/${a.id}`, { email: 'a@example.com', name: 'A' })).status).toBe(200);
  });

  it('non-owners cannot see or touch owner accounts (404) or give owner positions; owners can', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const owner = await t.as('owner');
    const otherOwner = await t.createUser('cfo');
    const teacher = await t.createUser('teacher');

    expect((await admin.patch(`/api/staff/${owner.user.id}`, { name: 'Hijack' })).status).toBe(404);
    expect((await admin.patch(`/api/staff/${otherOwner.id}`, { active: false })).status).toBe(404);
    expect((await admin.patch(`/api/staff/${otherOwner.id}`, { password: 'takeover123' })).status).toBe(404);
    const grant = await admin.patch(`/api/staff/${teacher.id}`, { positionIds: [t.positionId('ceo')] });
    expect(grant.status).toBe(403);
    expect(grant.body.error.code).toBe('owner_only');
    expect((await admin.patch(`/api/staff/${admin.user.id}`, { positionIds: [t.positionId('ceo')] })).status).toBe(403);
    expect(t.db.select().from(users).where(eq(users.id, owner.user.id)).get()!.name).not.toBe('Hijack');

    const made = await owner.patch(`/api/staff/${teacher.id}`, { positionIds: [t.positionId('ceo')] });
    expect(made.body).toMatchObject({ isOwner: true });
    const unmade = await owner.patch(`/api/staff/${otherOwner.id}`, { positionIds: [t.positionId('executive_director')] });
    expect(keysOf(unmade.body)).toEqual(['executive_director']);
    // Directors may manage other directors (same access).
    const admin2 = await t.createUser('admin');
    expect(keysOf((await admin.patch(`/api/staff/${admin2.id}`, { positionIds: [t.positionId('acting_coach')] })).body)).toEqual(['acting_coach']);
  });

  it('you cannot change your own positions or deactivate yourself', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const owner = await t.as('owner');
    await t.createUser('owner');

    for (const [client, patch] of [
      [admin, { positionIds: [t.positionId('acting_coach')] }],
      [admin, { positionIds: [t.positionId('executive_director'), t.positionId('acting_coach')] }],
      [admin, { active: false }],
      [owner, { positionIds: [t.positionId('executive_director')] }],
      [owner, { positionIds: [t.positionId('ceo'), t.positionId('finance')] }],
      [owner, { active: false }],
    ] as const) {
      const res = await client.patch(`/api/staff/${client.user.id}`, patch);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('cannot_change_self');
    }
    // Sending your current positions/active state back unchanged is fine, as are other fields.
    const ok = await admin.patch(`/api/staff/${admin.user.id}`, { positionIds: [t.positionId('executive_director')], active: true, name: 'Still Director' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ active: true, name: 'Still Director' });
    expect(keysOf(ok.body)).toEqual(['executive_director']);
  });

  it('the last active account holding an owner position cannot lose it or be deactivated', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = t.positionId('executive_director');
    const res = await owner.patch(`/api/staff/${owner.user.id}`, { positionIds: [director] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_owner');
    const res2 = await owner.patch(`/api/staff/${owner.user.id}`, { active: false });
    expect(res2.body.error.code).toBe('last_owner');

    // An inactive second owner doesn't count…
    const dormant = await t.createUser('owner', { active: false });
    expect((await owner.patch(`/api/staff/${owner.user.id}`, { positionIds: [director] })).body.error.code).toBe('last_owner');
    // …and changing that inactive owner doesn't trip the rule.
    expect((await owner.patch(`/api/staff/${dormant.id}`, { positionIds: [t.positionId('head_of_casting')] })).status).toBe(200);

    // The rule holds even when the request comes from someone else (e.g. a race left one owner).
    const second = await t.as('cfo');
    t.db.update(users).set({ active: false }).where(eq(users.id, owner.user.id)).run();
    const demote = await second.patch(`/api/staff/${second.user.id}`, { positionIds: [director] });
    expect(demote.body.error.code).toBe('last_owner');
    expect(positionKeys(t, second.user.id)).toEqual([t.positionId('cfo')]);

    // With another active owner (CFO holder), the CEO may hand over: swapping CEO for CFO keeps an owner.
    const third = await t.as('ceo');
    expect((await third.patch(`/api/staff/${second.user.id}`, { positionIds: [director] })).status).toBe(200);
  });

  it('deactivating signs the person out everywhere and blocks sign-in; reactivating restores it', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const u = await t.createUser('teacher', { email: 'leaving@example.com' });
    const phone = await t.login('leaving@example.com');
    const laptop = await t.login('leaving@example.com');
    expect((await phone.get('/api/auth/me')).body.user.id).toBe(u.id);

    const res = await admin.patch(`/api/staff/${u.id}`, { active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(t.db.select().from(authSessions).where(eq(authSessions.userId, u.id)).all()).toHaveLength(0);
    expect((await phone.get('/api/auth/me')).body.user).toBeNull();
    expect((await laptop.get('/api/auth/me')).body.user).toBeNull();
    expect((await t.anon.post('/api/auth/login', { email: 'leaving@example.com', password: t.password })).status).toBe(401);

    expect((await admin.patch(`/api/staff/${u.id}`, { active: true })).body.active).toBe(true);
    await t.login('leaving@example.com');
  });

  it('a password reset re-hashes and signs the person out everywhere', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const u = await t.createUser('agent', { email: 'forgot@example.com' });
    const old = await t.login('forgot@example.com');

    const res = await owner.patch(`/api/staff/${u.id}`, { password: 'brand-new-pass' });
    expect(res.status).toBe(200);
    expect(res.body.passwordHash).toBeUndefined();
    expect((await old.get('/api/auth/me')).body.user).toBeNull();
    expect((await t.anon.post('/api/auth/login', { email: 'forgot@example.com', password: t.password })).status).toBe(401);
    const fresh = await t.login('forgot@example.com', 'brand-new-pass');
    expect((await fresh.get('/api/auth/me')).body.user.id).toBe(u.id);
  });

  it('resetting your own password here keeps this device signed in but ends other sessions', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const otherDevice = await t.login(admin.user.email);
    const res = await admin.patch(`/api/staff/${admin.user.id}`, { password: 'my-new-password' });
    expect(res.status).toBe(200);
    expect((await admin.get('/api/auth/me')).body.user.id).toBe(admin.user.id);
    expect((await otherDevice.get('/api/auth/me')).body.user).toBeNull();
  });

  it('other edits leave sessions alone; new positions apply on the next request', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const u = await t.createUser('teacher', { email: 'stays@example.com' });
    const client = await t.login('stays@example.com');
    expect((await client.get('/api/talent')).status).toBe(403);
    await admin.patch(`/api/staff/${u.id}`, { name: 'Stays', positionIds: [t.positionId('head_of_casting')] });
    const me = (await client.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ name: 'Stays' });
    expect(keysOf(me)).toEqual(['head_of_casting']);
    expect((await client.get('/api/talent')).status).toBe(200);
  });

  it('validates input', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const u = await t.createUser('teacher');
    const res = await owner.patch(`/api/staff/${u.id}`, { name: '', email: 'x', positionIds: ['boss'], active: 'yes', password: '123', locale: 'fr' });
    expect(res.status).toBe(400);
    const paths = res.body.error.issues.map((i: any) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'positionIds', 'active', 'password', 'locale']));
  });

  it('404 for unknown or malformed ids', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    expect((await owner.patch('/api/staff/9999', { name: 'X' })).status).toBe(404);
    expect((await owner.patch('/api/staff/abc', { name: 'X' })).status).toBe(404);
  });

  it('403 without staff.manage, 401 signed out; there is no DELETE', async () => {
    const t = await makeTestContext();
    const u = await t.createUser('teacher');
    const teacher = await t.as('teacher');
    expect((await teacher.patch(`/api/staff/${u.id}`, { name: 'X' })).status).toBe(403);
    expect((await teacher.patch(`/api/staff/${teacher.user.id}`, { positionIds: [t.positionId('executive_director')] })).status).toBe(403);
    expect((await (await t.as('agent')).patch(`/api/staff/${u.id}`, { name: 'X' })).status).toBe(403);
    expect((await t.anon.patch(`/api/staff/${u.id}`, { name: 'X' })).status).toBe(401);
    const owner = await t.as('owner');
    expect((await owner.delete(`/api/staff/${u.id}`)).status).toBe(404);
    expect(t.db.select().from(users).where(eq(users.id, u.id)).get()).toBeTruthy();
  });
});

describe('settings', () => {
  it.each(ROLES)('GET answers the defaults to %s', async (role) => {
    const t = await makeTestContext();
    const me = await t.as(role);
    const res = await me.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schoolName: 'Acting School', defaultLocale: 'en', weekStartsOn: 1 });
  });

  it('PATCH saves (partially) and the school name shows in /api/auth/me', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.patch('/api/settings', { schoolName: '  Stage Left  ', weekStartsOn: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ schoolName: 'Stage Left', defaultLocale: 'en', weekStartsOn: 6 });

    const res2 = await admin.patch('/api/settings', { defaultLocale: 'ar' });
    expect(res2.body).toEqual({ schoolName: 'Stage Left', defaultLocale: 'ar', weekStartsOn: 6 });
    expect((await admin.patch('/api/settings', { weekStartsOn: 0 })).body.weekStartsOn).toBe(0);

    const teacher = await t.as('teacher');
    // Everyone signed in reads the settings (classes and the schedule need the week start).
    expect((await teacher.get('/api/settings')).body).toEqual({ schoolName: 'Stage Left', defaultLocale: 'ar', weekStartsOn: 0 });
    expect((await teacher.get('/api/auth/me')).body.schoolName).toBe('Stage Left');
    expect((await admin.patch('/api/settings', {})).status).toBe(200);
  });

  it('PATCH validates: week starts on Sat/Sun/Mon only, name required, known language', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    for (const weekStartsOn of [2, 3, 5, 7, -1, '1', 1.5, null]) {
      const res = await owner.patch('/api/settings', { weekStartsOn });
      expect(res.status).toBe(400);
      expect(res.body.error.issues[0].path).toEqual(['weekStartsOn']);
    }
    const res = await owner.patch('/api/settings', { schoolName: '   ', defaultLocale: 'fr' });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['schoolName', 'defaultLocale']));
    expect((await owner.get('/api/settings')).body.weekStartsOn).toBe(1);
  });

  it('PATCH needs settings.manage: 403 for coaches and casting; 401 signed out', async () => {
    const t = await makeTestContext();
    expect((await (await t.as('teacher')).patch('/api/settings', { schoolName: 'X' })).status).toBe(403);
    expect((await (await t.as('agent')).patch('/api/settings', { schoolName: 'X' })).status).toBe(403);
    expect((await t.anon.patch('/api/settings', { schoolName: 'X' })).status).toBe(401);
    expect((await t.anon.get('/api/settings')).status).toBe(401);
    const owner = await t.as('owner');
    expect((await owner.get('/api/settings')).body.schoolName).toBe('Acting School');
  });
});
