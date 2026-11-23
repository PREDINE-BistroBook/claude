import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authSessions, positions, userPositions, users } from '../../src/server/db/schema';
import { ensureBuiltInPositions } from '../../src/server/lib/access';
import { BUILT_IN_POSITIONS, PERMISSIONS, effectivePermissions, holdsAll } from '../../src/shared/permissions';
import type { Position } from '../../src/shared/schemas/positions';
import { makeTestContext } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;
const byKey = (items: Position[], key: string) => items.find((p) => p.key === key)!;
/**
 * The Executive Director's built-in list: everything but money amounts, the owners' monthly cafeteria page (she serves
 * the cafeteria since grant v4) and the editor's and reviewer's work on videos (she adds and sees them since grant v5).
 */
const ALL_BUT_MONEY = PERMISSIONS.filter((p) => !['payments.manage', 'cafeteria.report', 'videos.edit', 'videos.review'].includes(p));
const POSITION_KEYS = ['id', 'key', 'name', 'nameAr', 'isOwner', 'permissions', 'sortOrder', 'holderCount', 'editable', 'assignable', 'createdAt', 'updatedAt'].sort();
const holders = (t: Ctx, positionId: number) =>
  t.db.select().from(userPositions).where(eq(userPositions.positionId, positionId)).all().length;

// ── The catalogue ───────────────────────────────────────────────────────────

describe('permissions (unit)', () => {
  it('owner positions allow everything; other permissions add up across positions', () => {
    expect(effectivePermissions([{ isOwner: true, permissions: [] }])).toEqual([...PERMISSIONS]);
    expect(effectivePermissions([{ isOwner: false, permissions: ['talent.read'] }, { isOwner: true, permissions: [] }])).toEqual([...PERMISSIONS]);
    expect(
      effectivePermissions([
        { isOwner: false, permissions: ['courses.read', 'students.read', 'not.a.permission'] },
        { isOwner: false, permissions: ['students.read', 'payments.status'] },
      ]),
    ).toEqual(['students.read', 'courses.read', 'payments.status']);
    expect(effectivePermissions([])).toEqual([]);
    expect(holdsAll(['students.read', 'courses.read'], ['courses.read'])).toBe(true);
    expect(holdsAll(['students.read'], ['students.read', 'students.contact'])).toBe(false);
  });

  it('defines the confirmed built-ins', () => {
    expect(BUILT_IN_POSITIONS.map((p) => p.key)).toEqual(['ceo', 'cfo', 'executive_director', 'head_of_casting', 'casting_team', 'video_editor', 'acting_coach', 'finance', 'reception', 'office_helper', 'video_reviewer']);
    expect(byKeyStatic('executive_director').permissions).toEqual(ALL_BUT_MONEY);
    expect(byKeyStatic('casting_team').permissions).not.toContain('castings.send');
    expect(byKeyStatic('head_of_casting').permissions).toContain('castings.send');
    expect(byKeyStatic('video_editor').permissions).not.toContain('students.contact');
    expect(byKeyStatic('finance').permissions).toContain('students.contact');
    expect(byKeyStatic('acting_coach').permissions).not.toContain('classes.all');
  });
});
const byKeyStatic = (key: string) => BUILT_IN_POSITIONS.find((p) => p.key === key)!;

describe('ensureBuiltInPositions', () => {
  it('creates missing built-ins at startup and leaves edited ones alone', async () => {
    const t = await makeTestContext();
    expect(t.db.select().from(positions).all().map((p) => p.key)).toEqual(BUILT_IN_POSITIONS.map((p) => p.key));
    t.db.update(positions).set({ name: 'Coach', permissions: ['students.read'] }).where(eq(positions.key, 'acting_coach')).run();
    t.db.delete(positions).where(eq(positions.key, 'video_editor')).run();
    ensureBuiltInPositions(t.db);
    ensureBuiltInPositions(t.db);
    const rows = t.db.select().from(positions).all();
    expect(rows).toHaveLength(BUILT_IN_POSITIONS.length);
    expect(rows.find((p) => p.key === 'acting_coach')).toMatchObject({ name: 'Coach', permissions: ['students.read'] });
    expect(rows.find((p) => p.key === 'video_editor')).toMatchObject({ name: 'Video editor', nameAr: 'مونتير' });
  });
});

// ── GET /api/positions ──────────────────────────────────────────────────────

describe('GET /api/positions', () => {
  it('owners see every position in order, owner positions listing every permission, with holder counts', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    await t.createUser(['acting_coach', 'finance']);
    await t.createUser('acting_coach', { active: false });
    const res = await owner.get<{ items: Position[] }>('/api/positions');
    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.key)).toEqual(BUILT_IN_POSITIONS.map((p) => p.key));
    for (const p of res.body.items) expect(Object.keys(p).sort()).toEqual(POSITION_KEYS);
    expect(byKey(res.body.items, 'ceo')).toMatchObject({ name: 'CEO', nameAr: 'الرئيس التنفيذي', isOwner: true, permissions: [...PERMISSIONS], holderCount: 1, editable: true, assignable: true });
    expect(byKey(res.body.items, 'acting_coach')).toMatchObject({ holderCount: 2, permissions: ['students.read', 'courses.read', 'attendance.write', 'videos.add'] });
    expect(byKey(res.body.items, 'finance')).toMatchObject({ holderCount: 1, editable: true, assignable: true });
  });

  it('the director never sees owner positions; what she can edit/assign is limited to her own access', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    // An owner who also holds a non-owner position is counted for her too (a bare number, so the
    // count agrees with "can't delete a position someone holds"); the account itself stays hidden.
    await t.createUser(['ceo', 'acting_coach']);
    await t.createUser('acting_coach');
    const res = await director.get<{ items: Position[] }>('/api/positions');
    expect(res.status).toBe(200);
    expect(res.body.items.map((p) => p.key)).toEqual(['executive_director', 'head_of_casting', 'casting_team', 'video_editor', 'acting_coach', 'finance', 'reception', 'office_helper', 'video_reviewer']);
    expect(res.body.items.every((p) => !p.isOwner)).toBe(true);
    expect(byKey(res.body.items, 'acting_coach')).toMatchObject({ holderCount: 2, editable: true, assignable: true });
    expect(byKey(res.body.items, 'executive_director')).toMatchObject({ holderCount: 1, editable: true, assignable: true });
    // Finance allows payments.manage, which she doesn't hold; the Video editor and the Video reviewer the editor's and the reviewer's work (Part L).
    expect(byKey(res.body.items, 'finance')).toMatchObject({ editable: false, assignable: false });
    expect(byKey(res.body.items, 'video_editor')).toMatchObject({ editable: false, assignable: false });
    expect(byKey(res.body.items, 'video_reviewer')).toMatchObject({ editable: false, assignable: false });
  });

  it('needs staff.manage or positions.manage; editable/assignable follow which one', async () => {
    const t = await makeTestContext();
    const assigner = await t.as({ permissions: ['staff.manage', 'students.read', 'courses.read', 'attendance.write', 'videos.add'] });
    const a = (await assigner.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(byKey(a, 'acting_coach')).toMatchObject({ editable: false, assignable: true });
    expect(byKey(a, 'video_editor')).toMatchObject({ editable: false, assignable: false });
    const editor = await t.as({ permissions: ['positions.manage', 'talent.read'] });
    const e = (await editor.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(byKey(e, 'acting_coach')).toMatchObject({ editable: false, assignable: false });
    expect(e.some((p) => p.editable)).toBe(true); // its own custom position: only talent.read + positions.manage
    expect((await (await t.as('teacher')).get('/api/positions')).status).toBe(403);
    expect((await (await t.as('agent')).get('/api/positions')).status).toBe(403);
    expect((await t.anon.get('/api/positions')).status).toBe(401);
  });
});

// ── POST /api/positions ─────────────────────────────────────────────────────

describe('POST /api/positions', () => {
  it('creates a position (201), keeping only known permissions once and in catalogue order', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const res = await owner.post<Position>('/api/positions', {
      name: ' Receptionist ',
      nameAr: 'موظف الاستقبال',
      permissions: ['students.contact', 'students.read', 'students.read'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: null, name: 'Receptionist', nameAr: 'موظف الاستقبال', isOwner: false, permissions: ['students.read', 'students.contact'], holderCount: 0, editable: true, assignable: true });
    // New positions go last.
    const list = (await owner.get<{ items: Position[] }>('/api/positions')).body.items;
    expect(list.at(-1)!.id).toBe(res.body.id);
    const blankAr = await owner.post<Position>('/api/positions', { name: 'Driver', nameAr: '', permissions: [] });
    expect(blankAr.body).toMatchObject({ nameAr: null, permissions: [] });
  });

  it('validates input and keeps names unique (any case)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const bad = await owner.post('/api/positions', { name: '', permissions: ['students.fly'], isOwner: 'yes' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['name', 'permissions', 'isOwner']));
    expect((await owner.post('/api/positions', { name: 'X' })).status).toBe(400);
    const dup = await owner.post('/api/positions', { name: 'acting COACH', permissions: [] });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'position_name_taken', issues: [expect.objectContaining({ path: ['name'], message: 'positions:errors.nameTaken' })] });
  });

  it('no escalation: the director may only allow what she holds, and never create an owner position', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    const ok = await director.post<Position>('/api/positions', { name: 'Assistant', permissions: ['students.read', 'castings.send'] });
    expect(ok.status).toBe(201);
    const money = await director.post('/api/positions', { name: 'Bookkeeper', permissions: ['payments.status', 'payments.manage'] });
    expect(money.status).toBe(403);
    expect(money.body.error.code).toBe('exceeds_your_access');
    const owner = await director.post('/api/positions', { name: 'Partner', isOwner: true, permissions: [] });
    expect(owner.status).toBe(403);
    expect(owner.body.error.code).toBe('owner_only');
    expect(t.db.select().from(positions).where(eq(positions.name, 'Bookkeeper')).get()).toBeUndefined();
    expect(t.db.select().from(positions).where(eq(positions.name, 'Partner')).get()).toBeUndefined();
  });

  it('owners may create owner positions, which allow every permission whatever is stored', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const res = await owner.post<Position>('/api/positions', { name: 'Founder', isOwner: true, permissions: [] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ isOwner: true, permissions: [...PERMISSIONS] });
    // Even if the stored list were empty, a holder can do everything.
    t.db.update(positions).set({ permissions: [] }).where(eq(positions.id, res.body.id)).run();
    const founder = await t.as({ permissions: [] });
    t.setPositions(founder.user.id, { permissions: [], isOwner: true });
    const me = (await founder.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ isOwner: true, permissions: [...PERMISSIONS] });
    for (const url of ['/api/staff', '/api/positions', '/api/students', '/api/talent', '/api/castings', '/api/courses']) {
      expect((await founder.get(url)).status).toBe(200);
    }
  });

  it('403 without positions.manage (staff.manage alone is not enough), 401 signed out', async () => {
    const t = await makeTestContext();
    expect((await (await t.as({ permissions: ['staff.manage'] })).post('/api/positions', { name: 'X', permissions: [] })).status).toBe(403);
    expect((await (await t.as('teacher')).post('/api/positions', { name: 'X', permissions: [] })).status).toBe(403);
    expect((await t.anon.post('/api/positions', { name: 'X', permissions: [] })).status).toBe(401);
  });
});

// ── PATCH /api/positions/:id ────────────────────────────────────────────────

describe('PATCH /api/positions/:id', () => {
  it('renames and changes what a position allows; holders get the change on their next request', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const coach = await t.as('teacher');
    expect((await coach.get('/api/talent')).status).toBe(403);
    const id = t.positionId('acting_coach');
    const res = await owner.patch<Position>(`/api/positions/${id}`, { name: 'Coach', nameAr: 'مدرّب', permissions: ['students.read', 'courses.read', 'attendance.write', 'talent.read'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'acting_coach', name: 'Coach', nameAr: 'مدرّب', holderCount: 1 });
    expect(res.body.permissions).toContain('talent.read');
    expect((await coach.get('/api/talent')).status).toBe(200);
    expect((await coach.get('/api/auth/me')).body.user.positions[0]).toMatchObject({ name: 'Coach', nameAr: 'مدرّب' });
    // An empty patch answers the position unchanged.
    expect((await owner.patch<Position>(`/api/positions/${id}`, {})).body.name).toBe('Coach');
    expect((await owner.patch(`/api/positions/${id}`, { name: 'video EDITOR' })).body.error.code).toBe('position_name_taken');
    expect((await owner.patch(`/api/positions/${id}`, { name: '' })).status).toBe(400);
    expect((await owner.patch('/api/positions/9999', { name: 'Z' })).status).toBe(404);
  });

  it('no escalation for the director: only permissions she holds, never a position that already exceeds hers', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    const casting = t.positionId('head_of_casting');
    const ok = await director.patch<Position>(`/api/positions/${casting}`, { name: 'Casting lead', permissions: ['talent.read', 'castings.read'] });
    expect(ok.status).toBe(200);
    expect(ok.body.permissions).toEqual(['talent.read', 'castings.read']);
    const add = await director.patch(`/api/positions/${casting}`, { permissions: ['talent.read', 'payments.manage'] });
    expect(add.status).toBe(403);
    expect(add.body.error.code).toBe('exceeds_your_access');
    // Finance already allows payments.manage: out of her reach, even just to rename or reduce it.
    const finance = t.positionId('finance');
    for (const patch of [{ name: 'Money' }, { permissions: ['students.read'] }]) {
      const res = await director.patch(`/api/positions/${finance}`, patch);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('exceeds_your_access');
    }
    expect(t.db.select().from(positions).where(eq(positions.id, finance)).get()!.name).toBe('Finance');
    // She can't turn a position into an owner position.
    const promote = await director.patch(`/api/positions/${casting}`, { isOwner: true });
    expect(promote.status).toBe(403);
    expect(promote.body.error.code).toBe('owner_only');
  });

  it('owner positions are a 404 for non-owners; owners may change them', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    const owner = await t.as('owner');
    const ceo = t.positionId('ceo');
    expect((await director.patch(`/api/positions/${ceo}`, { name: 'Boss' })).status).toBe(404);
    expect((await director.delete(`/api/positions/${ceo}`)).status).toBe(404);
    const res = await owner.patch<Position>(`/api/positions/${ceo}`, { name: 'Chief Executive' });
    expect(res.body).toMatchObject({ name: 'Chief Executive', isOwner: true, permissions: [...PERMISSIONS] });
  });

  it('turning an owner position into an ordinary one must leave someone holding an owner position', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner'); // holds CEO
    const cfo = t.positionId('cfo');
    const ceo = t.positionId('ceo');
    // Nobody holds CFO: making it ordinary is fine.
    const demoted = await owner.patch<Position>(`/api/positions/${cfo}`, { isOwner: false, permissions: ['payments.status'] });
    expect(demoted.status).toBe(200);
    expect(demoted.body).toMatchObject({ isOwner: false, permissions: ['payments.status'] });
    // CEO is the only owner position anyone holds.
    const last = await owner.patch(`/api/positions/${ceo}`, { isOwner: false, permissions: ALL_BUT_MONEY });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('last_owner');
    // Once CFO is an owner position again and someone active holds it, CEO may change.
    await owner.patch(`/api/positions/${cfo}`, { isOwner: true });
    await t.createUser('cfo');
    expect((await owner.patch(`/api/positions/${ceo}`, { isOwner: false, permissions: ALL_BUT_MONEY })).status).toBe(200);
  });

  it('a non-owner can’t edit a position held by someone whose access exceeds theirs (staff rule 4 holds here too)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = await t.as('admin');
    const moaty = await t.createUser(['acting_coach', 'finance'], { email: 'moaty@example.com' }); // payments.manage via Finance
    const coach = t.positionId('acting_coach');
    const original = t.db.select().from(positions).where(eq(positions.id, coach)).get()!;
    // Adding what she holds would hand Moaty staff.manage on top of payments.manage; taking away would cut him off.
    const add = await director.patch(`/api/positions/${coach}`, { permissions: ['students.read', 'courses.read', 'attendance.write', 'staff.manage'] });
    expect(add.status).toBe(403);
    expect(add.body.error.code).toBe('exceeds_your_access');
    for (const patch of [{ permissions: ['students.read'] }, { name: 'Coach' }]) {
      const res = await director.patch(`/api/positions/${coach}`, patch);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('exceeds_your_access');
    }
    expect(t.db.select().from(positions).where(eq(positions.id, coach)).get()).toMatchObject({ name: original.name, permissions: original.permissions });
    expect((await (await t.login('moaty@example.com')).get('/api/auth/me')).body.user.permissions).not.toContain('staff.manage');
    // The list says so: she may still give the position, not change it.
    expect(byKey((await director.get<{ items: Position[] }>('/api/positions')).body.items, 'acting_coach')).toMatchObject({ editable: false, assignable: true });
    // An owner may.
    expect((await owner.patch(`/api/positions/${coach}`, { name: 'Coach' })).status).toBe(200);
    // Owners holding it don't block her (their access doesn't change); once Moaty is within her reach, she may edit it.
    t.setPositions(moaty.id, 'acting_coach');
    await t.createUser(['ceo', 'acting_coach']);
    const ok = await director.patch<Position>(`/api/positions/${coach}`, { name: 'Acting coach' });
    expect(ok.status).toBe(200);
    expect(ok.body.editable).toBe(true);
  });

  it('403 without positions.manage', async () => {
    const t = await makeTestContext();
    const id = t.positionId('acting_coach');
    expect((await (await t.as({ permissions: ['staff.manage', 'students.read', 'courses.read', 'attendance.write'] })).patch(`/api/positions/${id}`, { name: 'X' })).status).toBe(403);
    expect((await t.anon.patch(`/api/positions/${id}`, { name: 'X' })).status).toBe(401);
  });
});

// ── DELETE /api/positions/:id ───────────────────────────────────────────────

describe('DELETE /api/positions/:id', () => {
  it('deletes an unused position (204); 409 position_in_use while anyone holds it; built-ins stay', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const made = (await owner.post<Position>('/api/positions', { name: 'Intern', permissions: ['students.read'] })).body;
    const holder = await t.createUser('teacher', { active: false });
    t.db.insert(userPositions).values({ userId: holder.id, positionId: made.id }).run();
    const inUse = await owner.delete(`/api/positions/${made.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('position_in_use');
    expect(holders(t, made.id)).toBe(1);
    t.db.delete(userPositions).where(eq(userPositions.positionId, made.id)).run();
    expect((await owner.delete(`/api/positions/${made.id}`)).status).toBe(204);
    expect((await owner.delete(`/api/positions/${made.id}`)).status).toBe(404);

    const builtIn = await owner.delete(`/api/positions/${t.positionId('video_editor')}`);
    expect(builtIn.status).toBe(409);
    expect(builtIn.body.error.code).toBe('position_built_in');
  });

  it('the director can delete only positions within her access', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = await t.as('admin');
    const mine = (await director.post<Position>('/api/positions', { name: 'Runner', permissions: ['students.read'] })).body;
    const money = (await owner.post<Position>('/api/positions', { name: 'Payroll', permissions: ['payments.manage'] })).body;
    const denied = await director.delete(`/api/positions/${money.id}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('exceeds_your_access');
    expect((await director.delete(`/api/positions/${mine.id}`)).status).toBe(204);
    expect((await (await t.as('teacher')).delete(`/api/positions/${money.id}`)).status).toBe(403);
  });
});

// ── Staff & positions rules ─────────────────────────────────────────────────

describe('staff rules: owner accounts are invisible to non-owners', () => {
  it('excluded from the list and directory; GET/PATCH /staff/:id answer 404', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner', { name: 'Ahmed' });
    const cfo = await t.createUser(['cfo', 'finance'], { name: 'Abdelrahman' });
    const director = await t.as('admin', { name: 'Salma' });
    const coach = await t.createUser('teacher', { name: 'Moaty' });

    const list = (await director.get('/api/staff')).body.items.map((s: any) => s.name);
    expect(list).toEqual(['Moaty', 'Salma']);
    const dir = (await director.get('/api/staff/directory')).body.items.map((s: any) => s.name);
    expect(dir).toEqual(['Moaty', 'Salma']);
    for (const id of [owner.user.id, cfo.id]) {
      expect((await director.get(`/api/staff/${id}`)).status).toBe(404);
      expect((await director.patch(`/api/staff/${id}`, { name: 'X' })).status).toBe(404);
      expect((await director.patch(`/api/staff/${id}`, { password: 'takeover1' })).status).toBe(404);
      expect((await director.patch(`/api/staff/${id}`, { active: false })).status).toBe(404);
    }
    expect((await director.get(`/api/staff/${coach.id}`)).body).toMatchObject({ name: 'Moaty', manageable: true, isOwner: false });
    // Owners see everyone.
    expect((await owner.get('/api/staff')).body.items.map((s: any) => s.name)).toEqual(['Abdelrahman', 'Ahmed', 'Moaty', 'Salma']);
    expect((await owner.get(`/api/staff/${cfo.id}`)).body).toMatchObject({ isOwner: true, manageable: true });
    expect((await owner.get('/api/staff/9999')).status).toBe(404);
    expect((await (await t.as('teacher')).get(`/api/staff/${coach.id}`)).status).toBe(403);
  });
});

describe('staff rules: no escalation when assigning positions', () => {
  it('the director may give or take only positions within her own access, never owner positions', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    const owner = await t.as('owner');
    const coach = await t.createUser('teacher');
    const finance = t.positionId('finance');
    const actingCoach = t.positionId('acting_coach');
    // Casting team is within her access (the Video editor no longer is: videos.edit, Part L).
    const editor = t.positionId('casting_team');

    // Assign: Finance allows payments.manage → refused; Casting team → fine.
    const give = await director.patch(`/api/staff/${coach.id}`, { positionIds: [actingCoach, finance] });
    expect(give.status).toBe(403);
    expect(give.body.error.code).toBe('exceeds_your_access');
    expect((await director.patch(`/api/staff/${coach.id}`, { positionIds: [actingCoach, editor] })).status).toBe(200);

    // Remove: an owner gave them Finance; the director can't take it away (she couldn't give it either)…
    await owner.patch(`/api/staff/${coach.id}`, { positionIds: [actingCoach, editor, finance] });
    const before = (await owner.get(`/api/staff/${coach.id}`)).body;
    expect(before.positions.map((p: any) => p.key)).toEqual(['casting_team', 'acting_coach', 'finance']);
    // …and the person now exceeds her access, so she can't touch them at all.
    const take = await director.patch(`/api/staff/${coach.id}`, { positionIds: [actingCoach, editor] });
    expect(take.status).toBe(403);
    expect(take.body.error.code).toBe('exceeds_your_access');

    // Owner positions: owner only, in both directions (to her they don't exist).
    const other = await t.createUser('agent');
    const toOwner = await director.patch(`/api/staff/${other.id}`, { positionIds: [t.positionId('cfo')] });
    expect(toOwner.status).toBe(400);
    expect(toOwner.body.error.issues[0]).toMatchObject({ path: ['positionIds'], message: 'staff:errors.positionNotFound' });
    expect((await owner.patch(`/api/staff/${other.id}`, { positionIds: [t.positionId('cfo')] })).status).toBe(200);
  });

  it('a person with staff.manage but narrow access can only hand out what they hold', async () => {
    const t = await makeTestContext();
    const lead = await t.as({ permissions: ['staff.manage', 'talent.read', 'talent.contact', 'talent.write', 'castings.read', 'castings.write', 'students.read', 'classes.all'] });
    const newbie = (positionIds: number[]) => ({ name: 'New', email: `n${positionIds.join('')}@example.com`, password: 'temporary1', positionIds });
    expect((await lead.post('/api/staff', newbie([t.positionId('casting_team')]))).status).toBe(201);
    const send = await lead.post('/api/staff', newbie([t.positionId('head_of_casting')])); // castings.send + courses.read
    expect(send.status).toBe(403);
    expect(send.body.error.code).toBe('exceeds_your_access');
  });
});

describe('staff rules: editing someone more powerful', () => {
  it('the director can’t reset the password of, deactivate or edit a coach+finance user (payments.manage); an owner can', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    const owner = await t.as('owner');
    const moaty = await t.createUser(['acting_coach', 'finance'], { email: 'moaty@example.com' });
    const session = await t.login('moaty@example.com');

    const list = (await director.get('/api/staff')).body.items;
    expect(list.find((s: any) => s.id === moaty.id)).toMatchObject({ manageable: false });
    for (const patch of [{ password: 'takeover123' }, { active: false }, { name: 'Renamed' }, { email: 'mine@example.com' }]) {
      const res = await director.patch(`/api/staff/${moaty.id}`, patch);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('exceeds_your_access');
    }
    expect(t.db.select().from(users).where(eq(users.id, moaty.id)).get()).toMatchObject({ active: true, name: moaty.name, email: 'moaty@example.com' });
    expect((await session.get('/api/auth/me')).body.user.id).toBe(moaty.id);
    expect(t.db.select().from(authSessions).where(eq(authSessions.userId, moaty.id)).all()).toHaveLength(1);

    expect((await owner.patch(`/api/staff/${moaty.id}`, { password: 'reset-by-owner' })).status).toBe(200);
    expect((await owner.patch(`/api/staff/${moaty.id}`, { active: false })).status).toBe(200);
  });

  it('the director can manage someone whose access is within hers', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    const coach = await t.createUser(['acting_coach', 'casting_team']);
    expect((await director.get(`/api/staff/${coach.id}`)).body.manageable).toBe(true);
    expect((await director.patch(`/api/staff/${coach.id}`, { password: 'new-password' })).status).toBe(200);
    expect((await director.patch(`/api/staff/${coach.id}`, { active: false })).status).toBe(200);
  });
});

describe('staff rules: self changes and the last owner', () => {
  it('nobody changes their own positions or deactivates themselves', async () => {
    const t = await makeTestContext();
    const director = await t.as('admin');
    await t.as('owner');
    const res = await director.patch(`/api/staff/${director.user.id}`, { positionIds: [t.positionId('executive_director'), t.positionId('casting_team')] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('cannot_change_self');
    expect((await director.patch(`/api/staff/${director.user.id}`, { active: false })).body.error.code).toBe('cannot_change_self');
  });

  it('at least one active account keeps an owner position', async () => {
    const t = await makeTestContext();
    const ceo = await t.as('owner');
    const res = await ceo.patch(`/api/staff/${ceo.user.id}`, { positionIds: [t.positionId('executive_director')] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_owner');
    // Another owner can't remove the last owner's position either.
    const cfo = await t.as('cfo');
    t.db.update(users).set({ active: false }).where(eq(users.id, cfo.user.id)).run();
    const second = await t.as('cfo');
    t.db.update(users).set({ active: false }).where(eq(users.id, ceo.user.id)).run();
    expect((await second.patch(`/api/staff/${second.user.id}`, { active: false })).body.error.code).toBe('last_owner');
  });
});

describe('owner positions and their holders stay invisible to non-owners', () => {
  it('a hidden owner position answers like a missing one when giving positions', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = await t.as('admin');
    const coach = await t.createUser('teacher');
    const custom = (await owner.post<Position>('/api/positions', { name: 'Board', isOwner: true, permissions: [] })).body;
    const miss = await director.patch(`/api/staff/${coach.id}`, { positionIds: [9999] });
    expect(miss.status).toBe(400);
    for (const id of [t.positionId('ceo'), custom.id]) {
      const own = await director.patch(`/api/staff/${coach.id}`, { positionIds: [id] });
      expect([own.status, own.body]).toEqual([miss.status, miss.body]);
      const created = await director.post('/api/staff', { name: 'New', email: `new${id}@example.com`, password: 'temporary1', positionIds: [id] });
      expect(created.status).toBe(400);
      expect(created.body.error.issues).toEqual(miss.body.error.issues);
    }
  });

  it('holder counts include everyone, so the listed count and the delete rule agree', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = await t.as('admin');
    const helper = (await director.post<Position>('/api/positions', { name: 'Helper', permissions: ['students.read'] })).body;
    t.db.insert(userPositions).values({ userId: owner.user.id, positionId: helper.id }).run();
    const listed = (await director.get<{ items: Position[] }>('/api/positions')).body.items.find((p) => p.id === helper.id)!;
    expect(listed.holderCount).toBe(1);
    const del = await director.delete(`/api/positions/${helper.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('position_in_use');
    expect((await director.patch<Position>(`/api/positions/${helper.id}`, { name: 'Helpers' })).body.holderCount).toBe(1);
  });

  it('position names are unique across every position, owner ones included, in English and Arabic', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const director = await t.as('admin');
    // Nobody can set up a look-alike of an owner position, even one they can't see.
    const fakeCeo = await director.post('/api/positions', { name: 'ceo', permissions: [] });
    expect(fakeCeo.status).toBe(409);
    expect(fakeCeo.body.error).toMatchObject({ code: 'position_name_taken', issues: [expect.objectContaining({ path: ['name'] })] });
    const fakeCeoAr = await director.post('/api/positions', { name: 'Chief', nameAr: 'الرئيس التنفيذي', permissions: [] });
    expect(fakeCeoAr.status).toBe(409);
    expect(fakeCeoAr.body.error.issues).toEqual([expect.objectContaining({ path: ['nameAr'], message: 'positions:errors.nameTaken' })]);
    await owner.post('/api/positions', { name: 'Secret Board', isOwner: true, permissions: [] });
    expect((await director.post('/api/positions', { name: 'SECRET board', permissions: [] })).body.error.code).toBe('position_name_taken');
    // Renaming into a taken name (either language) is refused too.
    const mine = (await director.post<Position>('/api/positions', { name: 'Runner', nameAr: 'مساعد', permissions: [] })).body;
    expect((await director.patch(`/api/positions/${mine.id}`, { name: 'secret BOARD' })).body.error.code).toBe('position_name_taken');
    const other = (await director.post<Position>('/api/positions', { name: 'Helper', permissions: [] })).body;
    expect((await director.patch(`/api/positions/${other.id}`, { nameAr: 'مساعد' })).body.error.issues[0].path).toEqual(['nameAr']);
    // Saving a position under the names it already has is always fine.
    expect((await director.patch(`/api/positions/${mine.id}`, { name: 'Runner', nameAr: 'مساعد', sortOrder: 5 })).status).toBe(200);
  });
});

describe('stored permission lists', () => {
  it('a position GET /positions reports assignable can be assigned (stale permission string in storage)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const stale = t.db
      .insert(positions)
      .values({ name: 'Old finance', isOwner: false, permissions: ['students.read', 'payments.view'] as never, sortOrder: 500 })
      .returning()
      .get();
    const row = (await director.get<{ items: Position[] }>('/api/positions')).body.items.find((p) => p.id === stale.id)!;
    expect(row).toMatchObject({ assignable: true, permissions: ['students.read'] });
    const created = await director.post('/api/staff', { name: 'New Hire', email: 'new.hire@example.com', password: 'password123', positionIds: [stale.id] });
    expect(created.status).toBe(201);
    const coach = await t.createUser(['acting_coach']);
    expect((await director.patch(`/api/staff/${coach.id}`, { positionIds: [t.positionId('acting_coach'), stale.id] })).status).toBe(200);
    expect((await director.patch(`/api/staff/${coach.id}`, { positionIds: [t.positionId('acting_coach')] })).status).toBe(200);
    t.cleanup();
  });
});
