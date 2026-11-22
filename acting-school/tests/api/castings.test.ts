import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { CastingDetail, CastingListItem, CastingRole, Submission } from '../../src/shared/schemas/castings';
import { castingRoles, castings, submissions, talent } from '../../src/server/db/schema';
import { makeTestContext, type Client } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const LIST_KEYS = [
  'id',
  'title',
  'production',
  'type',
  'status',
  'location',
  'submissionDeadline',
  'shootStart',
  'shootEnd',
  'rolesCount',
  'submissionsCount',
  'bookedCount',
].sort();

const DETAIL_KEYS = [
  'id',
  'title',
  'production',
  'type',
  'status',
  'location',
  'submissionDeadline',
  'shootStart',
  'shootEnd',
  'castingDirector',
  'contactEmail',
  'contactPhone',
  'description',
  'rate',
  'createdAt',
  'updatedAt',
  'roles',
].sort();

const ROLE_KEYS = ['id', 'castingId', 'name', 'description', 'gender', 'ageMin', 'ageMax', 'requirements', 'submissions'].sort();
const SUBMISSION_KEYS = ['id', 'roleId', 'talentId', 'status', 'auditionAt', 'auditionLocation', 'notes', 'createdAt', 'updatedAt', 'talent'].sort();
const TALENT_SUMMARY_KEYS = ['id', 'firstName', 'lastName', 'stageName', 'headshotFileId'].sort();

/** Talent rows go straight into the database: the talent routes are another module. */
function insertTalent(t: Ctx, overrides: Partial<typeof talent.$inferInsert> = {}) {
  return t.db
    .insert(talent)
    .values({ firstName: 'Layla', lastName: 'Haddad', ...overrides })
    .returning()
    .get()!;
}

async function createCasting(client: Client, body: Record<string, unknown> = {}): Promise<CastingDetail> {
  const res = await client.post<CastingDetail>('/api/castings', { title: 'Desert Rose', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

async function createRole(client: Client, castingId: number, body: Record<string, unknown> = {}): Promise<CastingRole> {
  const res = await client.post<CastingRole>(`/api/castings/${castingId}/roles`, { name: 'Lead', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

async function submit(client: Client, roleId: number, talentId: number, body: Record<string, unknown> = {}): Promise<Submission> {
  const res = await client.post<Submission>('/api/submissions', { roleId, talentId, ...body });
  expect(res.status).toBe(201);
  return res.body;
}

// ── Castings ────────────────────────────────────────────────────────────────

describe('POST /api/castings', () => {
  it('creates a casting with defaults and answers the full CastingDetail shape', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const res = await agent.post<CastingDetail>('/api/castings', { title: '  Desert Rose ', production: 'Falcon Films' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(DETAIL_KEYS);
    expect(res.body).toMatchObject({
      title: 'Desert Rose',
      production: 'Falcon Films',
      status: 'open',
      type: null,
      castingDirector: null,
      contactEmail: null,
      submissionDeadline: null,
      rate: null,
      roles: [],
    });
    expect(typeof res.body.id).toBe('number');
    expect(typeof res.body.createdAt).toBe('number');
    const row = t.db.select().from(castings).where(eq(castings.id, res.body.id)).get()!;
    expect(row.createdBy).toBe(agent.user.id);
  });

  it('stores every field, turning blanks into null and lower-casing the email', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const res = await owner.post<CastingDetail>('/api/castings', {
      title: 'Spring Campaign',
      production: '',
      castingDirector: 'Rana Saleh',
      contactEmail: 'Rana@Casting.Example',
      contactPhone: '+971 4 555 0100',
      type: 'commercial',
      location: 'Dubai Studio City',
      description: 'Line one\nLine two',
      status: 'closed',
      submissionDeadline: '2026-12-01',
      shootStart: '2026-12-10',
      shootEnd: '2026-12-12',
      rate: 'AED 2,000/day',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      production: null,
      castingDirector: 'Rana Saleh',
      contactEmail: 'rana@casting.example',
      contactPhone: '+971 4 555 0100',
      type: 'commercial',
      location: 'Dubai Studio City',
      description: 'Line one\nLine two',
      status: 'closed',
      submissionDeadline: '2026-12-01',
      shootStart: '2026-12-10',
      shootEnd: '2026-12-12',
      rate: 'AED 2,000/day',
    });
  });

  it('validates the body', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.post('/api/castings', {
      title: '',
      contactEmail: 'nope',
      type: 'opera',
      status: 'maybe',
      submissionDeadline: '2026-02-30',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    const paths = res.body.error.issues.map((i: any) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['title', 'contactEmail', 'type', 'status', 'submissionDeadline']));
  });

  it('refuses a shoot that ends before it starts', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.post('/api/castings', { title: 'X', shootStart: '2026-12-10', shootEnd: '2026-12-09' });
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toEqual([expect.objectContaining({ path: ['shootEnd'], message: 'errors.endBeforeStart' })]);
  });

  it('rejects a non-JSON body', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.raw('/api/castings', {
      method: 'POST',
      headers: { cookie: admin.cookie!, 'x-requested-with': 'fetch', 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/castings', () => {
  it('sorts open first, then by nearest deadline (none last), then newest', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const later = await createCasting(agent, { title: 'Open later', submissionDeadline: '2026-12-20' });
    const noDeadlineOld = await createCasting(agent, { title: 'Open no deadline (old)' });
    const sooner = await createCasting(agent, { title: 'Open sooner', submissionDeadline: '2026-12-05' });
    const noDeadlineNew = await createCasting(agent, { title: 'Open no deadline (new)' });
    const closed = await createCasting(agent, { title: 'Closed early', status: 'closed', submissionDeadline: '2026-01-01' });
    const cancelled = await createCasting(agent, { title: 'Cancelled', status: 'cancelled', submissionDeadline: '2026-06-01' });
    const closedNone = await createCasting(agent, { title: 'Closed none', status: 'closed' });
    // Same millisecond is possible: make "newest" unambiguous.
    t.db.update(castings).set({ createdAt: 1000 }).where(eq(castings.id, noDeadlineOld.id)).run();
    t.db.update(castings).set({ createdAt: 2000 }).where(eq(castings.id, noDeadlineNew.id)).run();

    const res = await agent.get<{ items: CastingListItem[] }>('/api/castings');
    expect(res.status).toBe(200);
    expect(res.body.items.map((c) => c.id)).toEqual([
      sooner.id,
      later.id,
      noDeadlineNew.id,
      noDeadlineOld.id,
      closed.id,
      cancelled.id,
      closedNone.id,
    ]);
    expect(Object.keys(res.body.items[0]!).sort()).toEqual(LIST_KEYS);
  });

  it('filters by status', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const open = await createCasting(agent, { title: 'A' });
    const closed = await createCasting(agent, { title: 'B', status: 'closed' });
    const cancelled = await createCasting(agent, { title: 'C', status: 'cancelled' });
    const ids = async (qs: string) => (await agent.get<{ items: CastingListItem[] }>(`/api/castings${qs}`)).body.items.map((c) => c.id);
    expect(await ids('?status=open')).toEqual([open.id]);
    expect(await ids('?status=closed')).toEqual([closed.id]);
    expect(await ids('?status=cancelled')).toEqual([cancelled.id]);
    expect((await ids('?status=')).sort()).toEqual([open.id, closed.id, cancelled.id].sort());
    expect((await agent.get('/api/castings?status=archived')).status).toBe(400);
  });

  it('searches title, production and casting director case-insensitively, wildcards literal', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const rose = await createCasting(agent, { title: 'Desert Rose', production: 'Falcon Films' });
    const ad = await createCasting(agent, { title: 'Juice Ad', castingDirector: 'Rana Saleh' });
    const pct = await createCasting(agent, { title: '100% Natural' });
    await createCasting(agent, { title: 'Other', location: 'Rose Garden' }); // location is not searched
    const ids = async (q: string) =>
      (await agent.get<{ items: CastingListItem[] }>(`/api/castings?q=${encodeURIComponent(q)}`)).body.items.map((c) => c.id);
    expect(await ids('desert')).toEqual([rose.id]);
    expect(await ids('FALCON')).toEqual([rose.id]);
    expect(await ids('rana')).toEqual([ad.id]);
    expect(await ids('0%')).toEqual([pct.id]);
    expect(await ids('%')).toEqual([pct.id]);
    expect(await ids('nothing-like-this')).toEqual([]);
  });

  it('combines q and status', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    await createCasting(agent, { title: 'Rose one' });
    const closed = await createCasting(agent, { title: 'Rose two', status: 'closed' });
    const res = await agent.get<{ items: CastingListItem[] }>('/api/castings?q=rose&status=closed');
    expect(res.body.items.map((c) => c.id)).toEqual([closed.id]);
  });

  it('counts roles, submissions and bookings per casting', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const a = insertTalent(t, { firstName: 'A' });
    const b = insertTalent(t, { firstName: 'B' });
    const c = insertTalent(t, { firstName: 'C' });

    const busy = await createCasting(agent, { title: 'Busy' });
    const lead = await createRole(agent, busy.id, { name: 'Lead' });
    const friend = await createRole(agent, busy.id, { name: 'Friend' });
    await createRole(agent, busy.id, { name: 'Extra' });
    await submit(agent, lead.id, a.id, { status: 'booked' });
    await submit(agent, lead.id, b.id, { status: 'rejected' });
    await submit(agent, friend.id, a.id);
    await submit(agent, friend.id, c.id, { status: 'booked' });

    const rolesOnly = await createCasting(agent, { title: 'Roles only' });
    await createRole(agent, rolesOnly.id);
    await createRole(agent, rolesOnly.id, { name: 'Second' });
    const empty = await createCasting(agent, { title: 'Empty' });

    const res = await agent.get<{ items: CastingListItem[] }>('/api/castings');
    const by = new Map(res.body.items.map((i) => [i.id, i]));
    expect(by.get(busy.id)).toMatchObject({ rolesCount: 3, submissionsCount: 4, bookedCount: 2 });
    expect(by.get(rolesOnly.id)).toMatchObject({ rolesCount: 2, submissionsCount: 0, bookedCount: 0 });
    expect(by.get(empty.id)).toMatchObject({ rolesCount: 0, submissionsCount: 0, bookedCount: 0 });
  });

  it('validates the query', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    expect((await agent.get(`/api/castings?q=${'x'.repeat(101)}`)).status).toBe(400);
  });
});

describe('GET /api/castings/:id', () => {
  it('answers the detail with roles by id and submissions in pipeline order', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent, { title: 'Pipeline', castingDirector: 'Rana' });
    const second = await createRole(agent, casting.id, { name: 'Second' });
    const first = await createRole(agent, casting.id, { name: 'First' });
    // Role ids ascending, whatever their names.
    expect(second.id).toBeLessThan(first.id);

    const people = ['Booked', 'Withdrawn', 'Shortlisted old', 'Callback', 'Shortlisted new', 'Rejected', 'Submitted', 'Audition'].map((n) =>
      insertTalent(t, { firstName: n, lastName: 'T' }),
    );
    const byName = Object.fromEntries(people.map((p) => [p.firstName, p]));
    const sub = async (name: string, status: string) => submit(agent, second.id, byName[name]!.id, { status });
    await sub('Booked', 'booked');
    await sub('Withdrawn', 'withdrawn');
    const oldShort = await sub('Shortlisted old', 'shortlisted');
    await sub('Callback', 'callback');
    const newShort = await sub('Shortlisted new', 'shortlisted');
    await sub('Rejected', 'rejected');
    await sub('Submitted', 'submitted');
    await sub('Audition', 'audition');
    t.db.update(submissions).set({ updatedAt: 1000 }).where(eq(submissions.id, oldShort.id)).run();
    t.db.update(submissions).set({ updatedAt: 9_000_000_000_000 }).where(eq(submissions.id, newShort.id)).run();

    const res = await agent.get<CastingDetail>(`/api/castings/${casting.id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(DETAIL_KEYS);
    expect(res.body.castingDirector).toBe('Rana');
    expect(res.body.roles.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(Object.keys(res.body.roles[0]!).sort()).toEqual(ROLE_KEYS);
    expect(res.body.roles[1]!.submissions).toEqual([]);

    const list = res.body.roles[0]!.submissions;
    expect(list.map((s) => s.talent.firstName)).toEqual([
      'Shortlisted new',
      'Shortlisted old',
      'Submitted',
      'Audition',
      'Callback',
      'Booked',
      'Rejected',
      'Withdrawn',
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual(SUBMISSION_KEYS);
    expect(Object.keys(list[0]!.talent).sort()).toEqual(TALENT_SUMMARY_KEYS);
  });

  it('includes the talent summary (stage name, headshot)', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id);
    const star = insertTalent(t, { firstName: 'Nour', lastName: 'Khalil', stageName: 'Nour K' });
    await submit(agent, role.id, star.id);
    const res = await agent.get<CastingDetail>(`/api/castings/${casting.id}`);
    expect(res.body.roles[0]!.submissions[0]!.talent).toEqual({
      id: star.id,
      firstName: 'Nour',
      lastName: 'Khalil',
      stageName: 'Nour K',
      headshotFileId: null,
    });
  });

  it('404s for unknown or malformed ids', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    expect((await agent.get('/api/castings/999')).status).toBe(404);
    expect((await agent.get('/api/castings/abc')).status).toBe(404);
    expect((await agent.get('/api/castings/0')).status).toBe(404);
  });
});

describe('PATCH /api/castings/:id', () => {
  it('updates only the fields sent', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent, { production: 'Falcon Films', location: 'Dubai' });
    await createRole(agent, casting.id);
    const res = await agent.patch<CastingDetail>(`/api/castings/${casting.id}`, { status: 'closed', location: '' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(DETAIL_KEYS);
    expect(res.body).toMatchObject({ title: 'Desert Rose', production: 'Falcon Films', status: 'closed', location: null });
    expect(res.body.roles).toHaveLength(1);
  });

  it('accepts an empty body and changes nothing', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent, { rate: 'TBC' });
    const res = await agent.patch<CastingDetail>(`/api/castings/${casting.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: casting.title, rate: 'TBC' });
  });

  it('checks shoot dates against the stored values', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent, { shootStart: '2026-12-10', shootEnd: '2026-12-12' });

    const endTooEarly = await agent.patch(`/api/castings/${casting.id}`, { shootEnd: '2026-12-09' });
    expect(endTooEarly.status).toBe(400);
    expect(endTooEarly.body.error.issues).toEqual([expect.objectContaining({ path: ['shootEnd'], message: 'errors.endBeforeStart' })]);

    const startTooLate = await agent.patch(`/api/castings/${casting.id}`, { shootStart: '2026-12-13' });
    expect(startTooLate.status).toBe(400);
    expect(startTooLate.body.error.issues[0].path).toEqual(['shootEnd']);

    // Same day is fine; clearing the start removes the constraint.
    expect((await agent.patch(`/api/castings/${casting.id}`, { shootStart: '2026-12-12' })).status).toBe(200);
    expect((await agent.patch(`/api/castings/${casting.id}`, { shootStart: null, shootEnd: '2026-12-01' })).status).toBe(200);
    // Moving both together is checked on the new pair.
    const both = await agent.patch<CastingDetail>(`/api/castings/${casting.id}`, { shootStart: '2027-01-05', shootEnd: '2027-01-07' });
    expect(both.body).toMatchObject({ shootStart: '2027-01-05', shootEnd: '2027-01-07' });
  });

  it('validates the body and 404s for unknown castings', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent);
    const bad = await agent.patch(`/api/castings/${casting.id}`, { title: '  ', status: 'paused' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['title', 'status']));
    expect((await agent.patch('/api/castings/999', { title: 'X' })).status).toBe(404);
  });
});

describe('DELETE /api/castings/:id', () => {
  it('deletes the casting with its roles and submissions, keeping the talent', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const casting = await createCasting(agent);
    const keep = await createCasting(agent, { title: 'Keep me' });
    const role = await createRole(agent, casting.id);
    const keptRole = await createRole(agent, keep.id);
    await submit(agent, role.id, person.id);
    await submit(agent, keptRole.id, person.id);

    const res = await agent.delete(`/api/castings/${casting.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect((await agent.get(`/api/castings/${casting.id}`)).status).toBe(404);
    expect(t.db.select().from(castingRoles).where(eq(castingRoles.castingId, casting.id)).all()).toEqual([]);
    expect(t.db.select().from(submissions).where(eq(submissions.roleId, role.id)).all()).toEqual([]);
    expect(t.db.select().from(talent).where(eq(talent.id, person.id)).get()).toBeTruthy();
    // The other casting is untouched.
    const other = await agent.get<CastingDetail>(`/api/castings/${keep.id}`);
    expect(other.body.roles[0]!.submissions).toHaveLength(1);

    expect((await agent.delete(`/api/castings/${casting.id}`)).status).toBe(404);
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

describe('casting roles', () => {
  it('creates a role (201) with an empty submissions list', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent);
    const res = await agent.post<CastingRole>(`/api/castings/${casting.id}/roles`, {
      name: ' Young mother ',
      description: 'Warm, funny',
      gender: 'female',
      ageMin: '25',
      ageMax: 35,
      requirements: '',
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(ROLE_KEYS);
    expect(res.body).toMatchObject({
      castingId: casting.id,
      name: 'Young mother',
      description: 'Warm, funny',
      gender: 'female',
      ageMin: 25,
      ageMax: 35,
      requirements: null,
      submissions: [],
    });
    const detail = await agent.get<CastingDetail>(`/api/castings/${casting.id}`);
    expect(detail.body.roles.map((r) => r.id)).toEqual([res.body.id]);
  });

  it('validates roles and 404s for an unknown casting', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent);
    const missing = await agent.post(`/api/castings/${casting.id}/roles`, { name: '', gender: 'any', ageMin: -1 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['name', 'gender', 'ageMin']));
    const order = await agent.post(`/api/castings/${casting.id}/roles`, { name: 'X', ageMin: 40, ageMax: 30 });
    expect(order.status).toBe(400);
    expect(order.body.error.issues).toEqual([expect.objectContaining({ path: ['ageMax'], message: 'errors.rangeOrder' })]);
    expect((await agent.post('/api/castings/999/roles', { name: 'X' })).status).toBe(404);
  });

  it('updates a role and answers it with its submissions', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id, { gender: 'male', ageMin: 20 });
    await submit(agent, role.id, person.id);
    const res = await agent.patch<CastingRole>(`/api/castings/${casting.id}/roles/${role.id}`, { name: 'Brother', gender: '' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(ROLE_KEYS);
    expect(res.body).toMatchObject({ name: 'Brother', gender: null, ageMin: 20 });
    expect(res.body.submissions.map((s) => s.talentId)).toEqual([person.id]);
    expect((await agent.patch<CastingRole>(`/api/castings/${casting.id}/roles/${role.id}`, {})).body.name).toBe('Brother');
  });

  it('checks the age range against the stored values', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id, { ageMin: 20, ageMax: 30 });
    const url = `/api/castings/${casting.id}/roles/${role.id}`;

    const maxLow = await agent.patch(url, { ageMax: 19 });
    expect(maxLow.status).toBe(400);
    expect(maxLow.body.error.issues).toEqual([expect.objectContaining({ path: ['ageMax'], message: 'errors.rangeOrder' })]);
    const minHigh = await agent.patch(url, { ageMin: 31 });
    expect(minHigh.status).toBe(400);
    expect(minHigh.body.error.issues[0].path).toEqual(['ageMax']);

    expect((await agent.patch(url, { ageMin: 30 })).status).toBe(200);
    expect((await agent.patch(url, { ageMax: null, ageMin: 50 })).body).toMatchObject({ ageMin: 50, ageMax: null });
  });

  it('treats a role from another casting as not found', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const a = await createCasting(agent, { title: 'A' });
    const b = await createCasting(agent, { title: 'B' });
    const roleOfB = await createRole(agent, b.id);
    expect((await agent.patch(`/api/castings/${a.id}/roles/${roleOfB.id}`, { name: 'Hijack' })).status).toBe(404);
    expect((await agent.delete(`/api/castings/${a.id}/roles/${roleOfB.id}`)).status).toBe(404);
    expect((await agent.patch(`/api/castings/999/roles/${roleOfB.id}`, { name: 'X' })).status).toBe(404);
    expect((await agent.patch(`/api/castings/${b.id}/roles/999`, { name: 'X' })).status).toBe(404);
    expect((await agent.patch(`/api/castings/${b.id}/roles/abc`, { name: 'X' })).status).toBe(404);
    const still = await agent.get<CastingDetail>(`/api/castings/${b.id}`);
    expect(still.body.roles[0]!.name).toBe('Lead');
  });

  it('deletes a role with its submissions', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id);
    const other = await createRole(agent, casting.id, { name: 'Other' });
    const s = await submit(agent, role.id, person.id);
    await submit(agent, other.id, person.id);

    const res = await agent.delete(`/api/castings/${casting.id}/roles/${role.id}`);
    expect(res.status).toBe(204);
    expect(t.db.select().from(submissions).where(eq(submissions.id, s.id)).get()).toBeUndefined();
    const detail = await agent.get<CastingDetail>(`/api/castings/${casting.id}`);
    expect(detail.body.roles.map((r) => r.id)).toEqual([other.id]);
    expect(detail.body.roles[0]!.submissions).toHaveLength(1);
    expect((await agent.delete(`/api/castings/${casting.id}/roles/${role.id}`)).status).toBe(404);
  });
});

// ── Submissions ─────────────────────────────────────────────────────────────

describe('submissions', () => {
  it('puts a talent forward (201), shortlisted by default', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t, { stageName: 'Layla H' });
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id);
    const res = await agent.post<Submission>('/api/submissions', { roleId: role.id, talentId: person.id, notes: '' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(SUBMISSION_KEYS);
    expect(res.body).toMatchObject({
      roleId: role.id,
      talentId: person.id,
      status: 'shortlisted',
      auditionAt: null,
      auditionLocation: null,
      notes: null,
      talent: { id: person.id, firstName: 'Layla', lastName: 'Haddad', stageName: 'Layla H', headshotFileId: null },
    });
    const row = t.db.select().from(submissions).where(eq(submissions.id, res.body.id)).get()!;
    expect(row.createdBy).toBe(agent.user.id);
  });

  it('accepts a status and audition details on create', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const role = await createRole(agent, (await createCasting(agent)).id);
    const res = await submit(agent, role.id, person.id, {
      status: 'audition',
      auditionAt: '2026-12-03T14:30',
      auditionLocation: 'Studio 4',
      notes: 'Bring headshots',
    });
    expect(res).toMatchObject({ status: 'audition', auditionAt: '2026-12-03T14:30', auditionLocation: 'Studio 4', notes: 'Bring headshots' });
  });

  it('refuses the same talent twice on one role (409 already_submitted) but allows other roles', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id);
    const other = await createRole(agent, casting.id, { name: 'Other' });
    await submit(agent, role.id, person.id);
    const dup = await agent.post('/api/submissions', { roleId: role.id, talentId: person.id, status: 'submitted' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_submitted');
    await submit(agent, other.id, person.id);
  });

  it('answers 400 on the field when the role or talent does not exist', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const role = await createRole(agent, (await createCasting(agent)).id);

    const noRole = await agent.post('/api/submissions', { roleId: 999, talentId: person.id });
    expect(noRole.status).toBe(400);
    expect(noRole.body.error.code).toBe('validation');
    expect(noRole.body.error.issues).toEqual([expect.objectContaining({ path: ['roleId'], message: 'castings:errors.roleNotFound' })]);

    const noTalent = await agent.post('/api/submissions', { roleId: role.id, talentId: 999 });
    expect(noTalent.status).toBe(400);
    expect(noTalent.body.error.issues).toEqual([expect.objectContaining({ path: ['talentId'], message: 'castings:errors.talentNotFound' })]);
  });

  it('validates the body', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const res = await agent.post('/api/submissions', { roleId: 'x', status: 'famous', auditionAt: '2026-12-03 14:30' });
    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['roleId', 'talentId', 'status', 'auditionAt']));
  });

  it('updates status and audition details, and clears them with blanks', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const role = await createRole(agent, (await createCasting(agent)).id);
    const s = await submit(agent, role.id, person.id);

    const moved = await agent.patch<Submission>(`/api/submissions/${s.id}`, {
      status: 'audition',
      auditionAt: '2026-12-05T09:00',
      auditionLocation: 'Main stage',
    });
    expect(moved.status).toBe(200);
    expect(Object.keys(moved.body).sort()).toEqual(SUBMISSION_KEYS);
    expect(moved.body).toMatchObject({ status: 'audition', auditionAt: '2026-12-05T09:00', auditionLocation: 'Main stage', notes: null });

    const notesOnly = await agent.patch<Submission>(`/api/submissions/${s.id}`, { notes: 'Great read' });
    expect(notesOnly.body).toMatchObject({ status: 'audition', auditionAt: '2026-12-05T09:00', notes: 'Great read' });

    const cleared = await agent.patch<Submission>(`/api/submissions/${s.id}`, { auditionAt: '', auditionLocation: null });
    expect(cleared.body).toMatchObject({ auditionAt: null, auditionLocation: null, notes: 'Great read' });

    expect((await agent.patch<Submission>(`/api/submissions/${s.id}`, {})).status).toBe(200);
  });

  it('validates updates and 404s for unknown submissions', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const role = await createRole(agent, (await createCasting(agent)).id);
    const s = await submit(agent, role.id, person.id);
    const bad = await agent.patch(`/api/submissions/${s.id}`, { status: 'famous', auditionAt: '2026-13-01T10:00' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['status', 'auditionAt']));
    expect((await agent.patch('/api/submissions/999', { status: 'booked' })).status).toBe(404);
    expect((await agent.patch('/api/submissions/abc', { status: 'booked' })).status).toBe(404);
  });

  it('removes a submission (204), then 404s', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id);
    const s = await submit(agent, role.id, person.id);
    const res = await agent.delete(`/api/submissions/${s.id}`);
    expect(res.status).toBe(204);
    expect((await agent.get<CastingDetail>(`/api/castings/${casting.id}`)).body.roles[0]!.submissions).toEqual([]);
    expect((await agent.delete(`/api/submissions/${s.id}`)).status).toBe(404);
    // The talent can be put forward again afterwards.
    await submit(agent, role.id, person.id);
  });

  it('disappears when the talent is deleted', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const person = insertTalent(t);
    const casting = await createCasting(agent);
    const role = await createRole(agent, casting.id);
    await submit(agent, role.id, person.id);
    t.db.delete(talent).where(eq(talent.id, person.id)).run();
    const list = await agent.get<{ items: CastingListItem[] }>('/api/castings');
    expect(list.body.items[0]).toMatchObject({ rolesCount: 1, submissionsCount: 0 });
  });
});

// ── Access ──────────────────────────────────────────────────────────────────

describe('access', () => {
  async function fixture(t: Ctx) {
    const owner = await t.as('owner');
    const person = insertTalent(t);
    const other = insertTalent(t, { firstName: 'Other' });
    const casting = await createCasting(owner);
    const role = await createRole(owner, casting.id);
    const s = await submit(owner, role.id, person.id);
    return { casting, role, s, person, other };
  }

  type Call = { method: 'get' | 'post' | 'patch' | 'delete'; url: string; body?: unknown };
  const calls = (f: Awaited<ReturnType<typeof fixture>>): Call[] => [
    { method: 'get', url: '/api/castings' },
    { method: 'get', url: `/api/castings/${f.casting.id}` },
    { method: 'post', url: '/api/castings', body: { title: 'New' } },
    { method: 'patch', url: `/api/castings/${f.casting.id}`, body: { title: 'Renamed' } },
    { method: 'post', url: `/api/castings/${f.casting.id}/roles`, body: { name: 'Another' } },
    { method: 'patch', url: `/api/castings/${f.casting.id}/roles/${f.role.id}`, body: { name: 'Renamed' } },
    { method: 'post', url: '/api/submissions', body: { roleId: f.role.id, talentId: f.other.id } },
    { method: 'patch', url: `/api/submissions/${f.s.id}`, body: { status: 'submitted' } },
    { method: 'delete', url: `/api/submissions/${f.s.id}` },
    { method: 'delete', url: `/api/castings/${f.casting.id}/roles/${f.role.id}` },
    { method: 'delete', url: `/api/castings/${f.casting.id}` },
  ];

  const send = (client: Client, c: Call) => (c.method === 'get' || c.method === 'delete' ? client[c.method](c.url) : client[c.method](c.url, c.body));

  it('answers 401 to signed-out requests', async () => {
    const t = await makeTestContext();
    const f = await fixture(t);
    for (const c of calls(f)) {
      const res = await send(t.anon, c);
      expect(res.status, `${c.method} ${c.url}`).toBe(401);
    }
  });

  it('answers 403 to teachers on everything, reads included', async () => {
    const t = await makeTestContext();
    const f = await fixture(t);
    const teacher = await t.as('teacher');
    for (const c of calls(f)) {
      const res = await send(teacher, c);
      expect(res.status, `${c.method} ${c.url}`).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
    // Nothing changed.
    expect(t.db.select().from(castings).all()).toHaveLength(1);
    expect(t.db.select().from(submissions).all()).toHaveLength(1);
  });

  it.each(['owner', 'admin', 'agent'] as const)('lets %s do everything', async (role) => {
    const t = await makeTestContext();
    const f = await fixture(t);
    const client = await t.as(role);
    const expected = [200, 200, 201, 200, 201, 200, 201, 200, 204, 204, 204];
    const got: number[] = [];
    for (const c of calls(f)) got.push((await send(client, c)).status);
    expect(got).toEqual(expected);
  });
});

// ── Sending to clients (castings.send) ──────────────────────────────────────

describe('castings.send', () => {
  async function fixture() {
    const t = await makeTestContext();
    const head = await t.as('head_of_casting');
    const team = await t.as('casting_team');
    const casting = await createCasting(head);
    const role = await createRole(head, casting.id);
    return { t, head, team, role, a: insertTalent(t), b: insertTalent(t, { firstName: 'Omar' }), c: insertTalent(t, { firstName: 'Dina' }) };
  }

  it('the casting team builds shortlists but can’t put anyone forward to the client (403 cannot_send)', async () => {
    const { t, team, role, a, b } = await fixture();
    const shortlisted = await submit(team, role.id, a.id);
    expect(shortlisted.status).toBe('shortlisted');
    for (const status of ['submitted', 'audition', 'callback', 'booked'] as const) {
      const created = await team.post('/api/submissions', { roleId: role.id, talentId: b.id, status });
      expect(created.status).toBe(403);
      expect(created.body.error.code).toBe('cannot_send');
      const moved = await team.patch(`/api/submissions/${shortlisted.id}`, { status });
      expect(moved.status).toBe(403);
      expect(moved.body.error.code).toBe('cannot_send');
    }
    expect(t.db.select().from(submissions).where(eq(submissions.id, shortlisted.id)).get()!.status).toBe('shortlisted');
    expect(t.db.select().from(submissions).where(eq(submissions.talentId, b.id)).all()).toEqual([]);
    // Statuses that don't send anyone are fine.
    for (const status of ['rejected', 'withdrawn', 'shortlisted'] as const) {
      expect((await team.patch(`/api/submissions/${shortlisted.id}`, { status })).status).toBe(200);
    }
    expect((await submit(team, role.id, b.id, { status: 'rejected' })).status).toBe('rejected');
  });

  it('heads of casting (and the director) send; the team can then still edit notes on a sent submission', async () => {
    const { t, head, team, role, a, b } = await fixture();
    const sent = await submit(head, role.id, a.id, { status: 'submitted' });
    expect((await head.patch(`/api/submissions/${sent.id}`, { status: 'audition', auditionAt: '2031-05-01T10:00' })).body.status).toBe('audition');
    // Saving the same status back with other fields isn't sending anyone new.
    const notes = await team.patch(`/api/submissions/${sent.id}`, { status: 'audition', notes: 'Bring headshots' });
    expect(notes.status).toBe(200);
    expect(notes.body).toMatchObject({ status: 'audition', notes: 'Bring headshots' });
    const director = await t.as('executive_director');
    expect((await submit(director, role.id, b.id, { status: 'booked' })).status).toBe('booked');
  });
});
