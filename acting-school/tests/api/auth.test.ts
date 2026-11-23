import { describe, expect, it } from 'vitest';
import { users } from '../../src/server/db/schema';
import { PERMISSIONS } from '../../src/shared/permissions';
import { makeTestContext, uploadPng, PNG_1PX } from '../helpers';

describe('setup', () => {
  it('creates the first account with the CEO position on first run, then refuses', async () => {
    const t = await makeTestContext();
    let me = await t.anon.get('/api/auth/me');
    expect(me.body).toMatchObject({ user: null, needsSetup: true });

    const res = await t.anon.post('/api/auth/setup', {
      schoolName: 'Stage Left Academy',
      name: 'Ash',
      email: 'Owner@Example.com',
      password: 'longenough',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'owner@example.com', isOwner: true, permissions: [...PERMISSIONS] });
    expect(res.body.user.positions).toEqual([{ id: expect.any(Number), key: 'ceo', name: 'CEO', nameAr: 'الرئيس التنفيذي', isOwner: true }]);
    expect((await t.login('owner@example.com', 'longenough').then((c) => c.get('/api/auth/me'))).body.user.positions[0].key).toBe('ceo');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
    // Setting up signs the owner in, so the staff list mustn't say "Never signed in".
    const owner = t.db.select().from(users).get()!;
    expect(typeof owner.lastLoginAt).toBe('number');

    me = await t.anon.get('/api/auth/me');
    expect(me.body).toMatchObject({ user: null, needsSetup: false, schoolName: 'Stage Left Academy' });

    const again = await t.anon.post('/api/auth/setup', { schoolName: 'X', name: 'Y', email: 'y@example.com', password: 'longenough' });
    expect(again.status).toBe(409);
  });

  it('validates input', async () => {
    const t = await makeTestContext();
    const res = await t.anon.post('/api/auth/setup', { schoolName: '', name: 'A', email: 'bad', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    const paths = res.body.error.issues.map((i: any) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['schoolName', 'email', 'password']));
  });
});

describe('login / logout / me', () => {
  it('signs in, reports the user, signs out', async () => {
    const t = await makeTestContext();
    const u = await t.createUser('teacher', { email: 'teach@example.com' });
    const client = await t.login('teach@example.com');
    const me = await client.get('/api/auth/me');
    expect(me.body.user).toMatchObject({
      id: u.id,
      isOwner: false,
      permissions: ['students.read', 'courses.read', 'attendance.write', 'videos.add'],
      positions: [expect.objectContaining({ key: 'acting_coach', name: 'Acting coach', nameAr: 'مدرب تمثيل', isOwner: false })],
    });
    expect(Object.keys(me.body.user).sort()).toEqual([
      'email',
      'id',
      'isOwner',
      'locale',
      'mustChangePassword',
      'name',
      'permissions',
      'phone',
      'photoFileId',
      'positions',
      'username',
    ]);
    expect(me.body.user).toMatchObject({ username: 'teach', email: 'teach@example.com', mustChangePassword: false });
    expect(me.body.user.passwordHash).toBeUndefined();

    await client.post('/api/auth/logout');
    const after = await client.get('/api/auth/me');
    expect(after.body.user).toBeNull();
  });

  it('rejects a wrong password and unknown emails the same way', async () => {
    const t = await makeTestContext();
    await t.createUser('admin', { email: 'a@example.com' });
    const wrong = await t.anon.post('/api/auth/login', { email: 'a@example.com', password: 'nope-nope' });
    const unknown = await t.anon.post('/api/auth/login', { email: 'zz@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
  });

  it('rejects deactivated staff, and their existing sessions stop working', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const u = await t.createUser('agent', { email: 'gone@example.com' });
    const client = await t.login('gone@example.com');
    const { users } = await import('../../src/server/db/schema');
    const { eq } = await import('drizzle-orm');
    t.db.update(users).set({ active: false }).where(eq(users.id, u.id)).run();
    expect((await client.get('/api/auth/me')).body.user).toBeNull();
    expect((await t.anon.post('/api/auth/login', { email: 'gone@example.com', password: t.password })).status).toBe(401);
    expect(owner).toBeTruthy();
  });

  it('locks an email after repeated failures', async () => {
    const t = await makeTestContext();
    await t.createUser('admin', { email: 'lock@example.com' });
    for (let i = 0; i < 10; i++) await t.anon.post('/api/auth/login', { email: 'lock@example.com', password: 'wrong-wrong' });
    const res = await t.anon.post('/api/auth/login', { email: 'lock@example.com', password: t.password });
    expect(res.status).toBe(429);
  });

  it('requires the X-Requested-With header on writes', async () => {
    const t = await makeTestContext();
    const res = await t.anon.raw('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('profile & password', () => {
  it('updates own profile and changes password', async () => {
    const t = await makeTestContext();
    const me = await t.as('teacher');
    const p = await me.patch('/api/auth/profile', { name: 'New Name', locale: 'ar' });
    expect(p.body.user).toMatchObject({ name: 'New Name', locale: 'ar' });

    const bad = await me.post('/api/auth/password', { currentPassword: 'wrong', newPassword: 'newpassword1' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0].path).toEqual(['currentPassword']);

    const ok = await me.post('/api/auth/password', { currentPassword: t.password, newPassword: 'newpassword1' });
    expect(ok.status).toBe(200);
    await t.login(me.user.email, 'newpassword1');
  });

  it('cannot change own positions or permissions through the profile', async () => {
    const t = await makeTestContext();
    const me = await t.as('teacher');
    await me.patch('/api/auth/profile', { positionIds: [t.positionId('ceo')], permissions: ['staff.manage'], isOwner: true });
    const after = (await me.get('/api/auth/me')).body.user;
    expect(after.positions.map((p: any) => p.key)).toEqual(['acting_coach']);
    expect(after.isOwner).toBe(false);
    expect(after.permissions).not.toContain('staff.manage');
  });

  it('a change to someone’s positions applies on their next request', async () => {
    const t = await makeTestContext();
    const me = await t.as('teacher');
    expect((await me.get('/api/staff')).status).toBe(403);
    t.setPositions(me.user.id, ['acting_coach', 'executive_director']);
    expect((await me.get('/api/staff')).status).toBe(200);
    const user = (await me.get('/api/auth/me')).body.user;
    // Sorted like the positions list; permissions add up.
    expect(user.positions.map((p: any) => p.key)).toEqual(['executive_director', 'acting_coach']);
    expect(user.permissions).toContain('staff.manage');
    expect(user.permissions).not.toContain('payments.manage');
  });
});

describe('files', () => {
  it('uploads an image and serves it only to signed-in staff', async () => {
    const t = await makeTestContext();
    const me = await t.as('agent');
    const id = await uploadPng(me);
    const got = await me.raw(`/api/files/${id}`, { headers: { cookie: me.cookie! } });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG_1PX);
    expect((await t.anon.get(`/api/files/${id}`)).status).toBe(401);
  });

  it('refuses non-images whatever their declared type', async () => {
    const t = await makeTestContext();
    const me = await t.as('agent');
    const form = new FormData();
    form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
    expect((await me.post('/api/files', form)).status).toBe(415);
  });
});

describe('unknown routes and auth wall', () => {
  it('404s unknown API routes as JSON and 401s module routes when signed out', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/nope')).status).toBe(404);
    expect((await t.anon.get('/api/students')).status).toBe(401);
  });
});
