import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { toISODate } from '../../src/shared/dates';
import { castingRoles, castings, students, submissions, talent, talentPhotos, users } from '../../src/server/db/schema';
import { makeTestContext, uploadPng, type Client, todayISO } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

/** A birth date that makes someone exactly `years` old today (their birthday was ten days ago). */
function dobForAge(years: number): string {
  const [y, m, d] = todayISO().split('-').map(Number) as [number, number, number];
  return toISODate(new Date(y - years, m - 1, d - 10));
}

function addStudent(t: Ctx, values: Partial<typeof students.$inferInsert> = {}) {
  return t.db
    .insert(students)
    .values({ firstName: 'Sara', lastName: 'Haddad', ...values })
    .returning()
    .get()!;
}

async function createTalent(client: Client, values: Record<string, unknown> = {}) {
  const res = await client.post('/api/talent', { firstName: 'Lina', lastName: 'Nasser', ...values });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const ids = (res: { body: { items: { id: number }[] } }) => res.body.items.map((i) => i.id);

describe('talent CRUD', () => {
  let t: Ctx;
  let agent: Client;
  beforeEach(async () => {
    t = await makeTestContext();
    agent = await t.as('agent');
  });

  it('creates with defaults and answers 201 with the full profile', async () => {
    const res = await agent.post('/api/talent', { firstName: ' Lina ', lastName: 'Nasser' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      firstName: 'Lina',
      lastName: 'Nasser',
      stageName: null,
      studentId: null,
      status: 'active',
      languages: [],
      skills: [],
      headshotFileId: null,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      contactHidden: false,
    });
    // Exactly the Talent interface — no extra keys.
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'id', 'studentId', 'firstName', 'lastName', 'stageName', 'email', 'phone', 'dateOfBirth', 'gender', 'playingAgeMin',
        'playingAgeMax', 'heightCm', 'eyeColor', 'hairColor', 'city', 'languages', 'skills', 'showreelUrl', 'instagram',
        'headshotFileId', 'status', 'representedSince', 'notes', 'createdAt', 'updatedAt', 'contactHidden',
      ].sort(),
    );
  });

  it('stores every field, turns blanks into null, normalises tags and Instagram', async () => {
    const res = await agent.post('/api/talent', {
      firstName: 'Omar',
      lastName: 'Khalil',
      stageName: 'Omar K',
      email: 'Omar@Example.com',
      phone: '+971 50 123 4567',
      dateOfBirth: '1995-04-12',
      gender: 'male',
      playingAgeMin: '25',
      playingAgeMax: 32,
      heightCm: 182,
      eyeColor: 'Brown',
      hairColor: 'Black',
      city: 'Dubai',
      languages: ['Arabic', 'English', 'arabic'],
      skills: ['Stage combat', 'Singing'],
      showreelUrl: 'https://vimeo.com/123',
      instagram: '@omar.k',
      status: 'on_hold',
      representedSince: '2024-01-15',
      notes: '',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'omar@example.com',
      playingAgeMin: 25,
      playingAgeMax: 32,
      heightCm: 182,
      languages: ['Arabic', 'English'],
      skills: ['Stage combat', 'Singing'],
      instagram: 'omar.k',
      status: 'on_hold',
      notes: null,
    });

    const link = await agent.post('/api/talent', { firstName: 'A', lastName: 'B', instagram: 'https://www.instagram.com/someone/' });
    expect(link.body.instagram).toBe('someone');
  });

  it('validates input (400 with field issues)', async () => {
    const res = await agent.post('/api/talent', {
      firstName: '',
      email: 'not-an-email',
      dateOfBirth: '2020-02-30',
      gender: 'robot',
      heightCm: 5,
      showreelUrl: 'javascript:alert(1)',
      playingAgeMin: 30,
      playingAgeMax: 20,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    const paths = res.body.error.issues.map((i: any) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'dateOfBirth', 'gender', 'heightCm', 'showreelUrl']));

    const range = await agent.post('/api/talent', { firstName: 'A', lastName: 'B', playingAgeMin: 30, playingAgeMax: 20 });
    expect(range.status).toBe(400);
    expect(range.body.error.issues).toEqual([expect.objectContaining({ path: ['playingAgeMax'], message: 'errors.rangeOrder' })]);

    const bad = await agent.post('/api/talent', { firstName: 'A', lastName: 'B', status: 'retired' });
    expect(bad.status).toBe(400);
  });

  it('refuses a headshot on create (photos are attached afterwards)', async () => {
    const fileId = await uploadPng(agent);
    const res = await agent.post('/api/talent', { firstName: 'A', lastName: 'B', headshotFileId: fileId });
    expect(res.status).toBe(400);
    expect(res.body.error.issues[0]).toMatchObject({ path: ['headshotFileId'] });
    // Blank is fine.
    expect((await agent.post('/api/talent', { firstName: 'A', lastName: 'B', headshotFileId: '' })).status).toBe(201);
  });

  it('reads the detail with photos, submissions and student', async () => {
    const s = addStudent(t, { firstName: 'Maya', lastName: 'Saleh' });
    const created = await createTalent(agent, { studentId: s.id });
    const res = await agent.get(`/api/talent/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ...created,
      photos: [],
      submissions: [],
      student: { id: s.id, firstName: 'Maya', lastName: 'Saleh' },
    });
    expect(Object.keys(res.body.student).sort()).toEqual(['firstName', 'id', 'lastName']);

    const plain = await createTalent(agent);
    expect((await agent.get(`/api/talent/${plain.id}`)).body.student).toBeNull();
  });

  it('updates part of a profile and keeps the rest', async () => {
    const created = await createTalent(agent, { city: 'Amman', skills: ['Dance'], playingAgeMin: 20, playingAgeMax: 30 });
    const res = await agent.patch(`/api/talent/${created.id}`, { stageName: 'Lina N', skills: ['Dance', 'DANCE', 'Mime'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stageName: 'Lina N', city: 'Amman', skills: ['Dance', 'Mime'], playingAgeMin: 20, playingAgeMax: 30 });

    const cleared = await agent.patch(`/api/talent/${created.id}`, { city: '', playingAgeMin: '' });
    expect(cleared.body).toMatchObject({ city: null, playingAgeMin: null, playingAgeMax: 30 });

    const empty = await agent.patch(`/api/talent/${created.id}`, {});
    expect(empty.status).toBe(200);
    expect(empty.body.stageName).toBe('Lina N');

    expect((await agent.patch(`/api/talent/${created.id}`, { firstName: '' })).status).toBe(400);
    expect((await agent.patch(`/api/talent/${created.id}`, { status: 'former' })).body.status).toBe('former');
  });

  it('checks the playing-age range against the stored values on PATCH', async () => {
    const created = await createTalent(agent, { playingAgeMin: 20, playingAgeMax: 30 });
    const tooLow = await agent.patch(`/api/talent/${created.id}`, { playingAgeMax: 18 });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error.issues[0]).toMatchObject({ path: ['playingAgeMax'], message: 'errors.rangeOrder' });

    const tooHigh = await agent.patch(`/api/talent/${created.id}`, { playingAgeMin: 35 });
    expect(tooHigh.status).toBe(400);

    // Both together, or moving the max first, is fine.
    expect((await agent.patch(`/api/talent/${created.id}`, { playingAgeMin: 35, playingAgeMax: 40 })).status).toBe(200);
    expect((await agent.patch(`/api/talent/${created.id}`, { playingAgeMax: '' })).status).toBe(200);
    expect((await agent.patch(`/api/talent/${created.id}`, { playingAgeMin: 50 })).status).toBe(200);
  });

  it('deletes (204) and cascades photos and submissions', async () => {
    const created = await createTalent(agent);
    const fileId = await uploadPng(agent);
    await agent.post(`/api/talent/${created.id}/photos`, { fileId });
    // A second photo is a student's photo too.
    const shared = await uploadPng(agent);
    await agent.post(`/api/talent/${created.id}/photos`, { fileId: shared });
    t.db.insert(students).values({ firstName: 'Same', lastName: 'Person', photoFileId: shared }).run();
    const casting = t.db.insert(castings).values({ title: 'Ad' }).returning().get()!;
    const role = t.db.insert(castingRoles).values({ castingId: casting.id, name: 'Lead' }).returning().get()!;
    t.db.insert(submissions).values({ roleId: role.id, talentId: created.id }).run();

    const res = await agent.delete(`/api/talent/${created.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect((await agent.get(`/api/talent/${created.id}`)).status).toBe(404);
    expect(t.db.select().from(talentPhotos).all()).toEqual([]);
    expect(t.db.select().from(submissions).all()).toEqual([]);
    // The profile's own image goes with it (nothing could remove it afterwards); one a student also uses is kept.
    const file = (id: string) => agent.raw(`/api/files/${id}`, { headers: { cookie: agent.cookie! } });
    expect((await file(fileId)).status).toBe(404);
    expect((await file(shared)).status).toBe(200);
  });

  it('answers 404 for unknown or malformed ids', async () => {
    expect((await agent.get('/api/talent/9999')).status).toBe(404);
    expect((await agent.get('/api/talent/abc')).status).toBe(404);
    expect((await agent.patch('/api/talent/9999', { city: 'X' })).status).toBe(404);
    expect((await agent.delete('/api/talent/9999')).status).toBe(404);
    expect((await agent.post('/api/talent/9999/photos', { fileId: crypto.randomUUID() })).status).toBe(404);
    expect((await agent.patch('/api/talent/9999/photos/1', { caption: 'x' })).status).toBe(404);
    expect((await agent.delete('/api/talent/9999/photos/1')).status).toBe(404);
  });
});

describe('talent list and filters', () => {
  let t: Ctx;
  let agent: Client;
  beforeEach(async () => {
    t = await makeTestContext();
    agent = await t.as('agent');
  });

  it('lists everyone sorted by last name, first name, in the list-item shape', async () => {
    const c = await createTalent(agent, { firstName: 'Zaid', lastName: 'Abbas' });
    const a = await createTalent(agent, { firstName: 'Amal', lastName: 'Qasim' });
    const b = await createTalent(agent, { firstName: 'basma', lastName: 'abbas' });
    const former = await createTalent(agent, { firstName: 'Old', lastName: 'Timer', status: 'former' });
    const res = await agent.get('/api/talent');
    expect(res.status).toBe(200);
    // Last names compare case-insensitively ("abbas" = "Abbas"), then first names ("basma" < "Zaid").
    expect(ids(res)).toEqual([b.id, c.id, a.id, former.id]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      [
        'id', 'firstName', 'lastName', 'stageName', 'gender', 'dateOfBirth', 'playingAgeMin', 'playingAgeMax', 'heightCm', 'city',
        'headshotFileId', 'skills', 'languages', 'status',
      ].sort(),
    );
  });

  it('filters by status (all statuses by default)', async () => {
    const active = await createTalent(agent);
    const hold = await createTalent(agent, { status: 'on_hold' });
    const former = await createTalent(agent, { status: 'former' });
    expect(ids(await agent.get('/api/talent')).sort()).toEqual([active.id, hold.id, former.id].sort());
    expect(ids(await agent.get('/api/talent?status=active'))).toEqual([active.id]);
    expect(ids(await agent.get('/api/talent?status=on_hold'))).toEqual([hold.id]);
    expect(ids(await agent.get('/api/talent?status=former'))).toEqual([former.id]);
    expect((await agent.get('/api/talent?status=nope')).status).toBe(400);
  });

  it('searches first, last, stage name and "first last", case-insensitively', async () => {
    const lina = await createTalent(agent, { firstName: 'Lina', lastName: 'Nasser', stageName: 'Lee Starr' });
    const omar = await createTalent(agent, { firstName: 'Omar', lastName: 'Linden' });
    await createTalent(agent, { firstName: 'Rami', lastName: 'Fares' });
    expect(ids(await agent.get('/api/talent?q=lin')).sort()).toEqual([lina.id, omar.id].sort());
    expect(ids(await agent.get('/api/talent?q=STARR'))).toEqual([lina.id]);
    expect(ids(await agent.get('/api/talent?q=lina%20nasser'))).toEqual([lina.id]);
    expect(ids(await agent.get('/api/talent?q=lina%20%20nas'))).toEqual([lina.id]);
    expect(ids(await agent.get('/api/talent?q=nasser%20lina'))).toEqual([lina.id]);
    expect(ids(await agent.get('/api/talent?q=zzz'))).toEqual([]);
    // LIKE wildcards are literal.
    expect(ids(await agent.get('/api/talent?q=%25'))).toEqual([]);
    expect(ids(await agent.get('/api/talent?q=_'))).toEqual([]);
    // A blank q is ignored.
    expect(ids(await agent.get('/api/talent?q='))).toHaveLength(3);
  });

  it('filters by gender and studentId', async () => {
    const s = addStudent(t);
    const f = await createTalent(agent, { gender: 'female', studentId: s.id });
    const m = await createTalent(agent, { gender: 'male' });
    await createTalent(agent);
    expect(ids(await agent.get('/api/talent?gender=female'))).toEqual([f.id]);
    expect(ids(await agent.get('/api/talent?gender=male'))).toEqual([m.id]);
    expect(ids(await agent.get(`/api/talent?studentId=${s.id}`))).toEqual([f.id]);
    expect(ids(await agent.get('/api/talent?studentId=9999'))).toEqual([]);
    expect((await agent.get('/api/talent?gender=x')).status).toBe(400);
  });

  it('filters by age: playing range contains it, else actual age ±1 from date of birth', async () => {
    const range = await createTalent(agent, { firstName: 'Range', playingAgeMin: 20, playingAgeMax: 28 });
    const minOnly = await createTalent(agent, { firstName: 'MinOnly', playingAgeMin: 40 });
    const maxOnly = await createTalent(agent, { firstName: 'MaxOnly', playingAgeMax: 12 });
    // Has a range, so their real age (30) is ignored.
    const rangeWithDob = await createTalent(agent, { firstName: 'RangeDob', playingAgeMin: 50, playingAgeMax: 60, dateOfBirth: dobForAge(30) });
    const dob30 = await createTalent(agent, { firstName: 'Dob30', dateOfBirth: dobForAge(30) });
    const nothing = await createTalent(agent, { firstName: 'Nothing' });

    const at = async (age: number) => ids(await agent.get(`/api/talent?age=${age}`)).sort();
    expect(await at(20)).toEqual([range.id]);
    expect(await at(28)).toEqual([range.id]);
    expect(await at(29)).toEqual([dob30.id]);
    expect(await at(30)).toEqual([dob30.id]);
    expect(await at(31)).toEqual([dob30.id]);
    expect(await at(32)).toEqual([]);
    expect(await at(27)).toEqual([range.id]);
    expect(await at(12)).toEqual([maxOnly.id]);
    expect(await at(0)).toEqual([maxOnly.id]);
    expect(await at(45)).toEqual([minOnly.id]);
    expect(await at(55)).toEqual([minOnly.id, rangeWithDob.id].sort());
    expect(nothing.id).toBeTruthy();
    expect((await agent.get('/api/talent?age=-1')).status).toBe(400);
    expect((await agent.get('/api/talent?age=abc')).status).toBe(400);
  });

  it('matches actual age exactly at the edges of ±1 year', async () => {
    const [y, m, d] = todayISO().split('-').map(Number) as [number, number, number];
    // Turns 22 tomorrow → 21 today; turned 22 today → 22.
    const turns22Tomorrow = await createTalent(agent, { dateOfBirth: toISODate(new Date(y - 22, m - 1, d + 1)) });
    const turned22Today = await createTalent(agent, { dateOfBirth: toISODate(new Date(y - 22, m - 1, d)) });
    const at = async (age: number) => ids(await agent.get(`/api/talent?age=${age}`)).sort();
    expect(await at(20)).toEqual([turns22Tomorrow.id]);
    expect(await at(23)).toEqual([turned22Today.id]);
    expect(await at(22)).toEqual([turns22Tomorrow.id, turned22Today.id].sort());
    expect(await at(24)).toEqual([]);
    expect(await at(19)).toEqual([]);
  });

  it('filters by one skill or language tag, case-insensitively and whole-tag only', async () => {
    const a = await createTalent(agent, { skills: ['Stage Combat', 'Singing'], languages: ['Arabic', 'French'] });
    const b = await createTalent(agent, { skills: ['singing'], languages: ['english'] });
    await createTalent(agent, { skills: ['Sing'], languages: [] });
    const e = await createTalent(agent, { skills: ['Épée'], languages: ['ÉLVISH'] });
    expect(ids(await agent.get('/api/talent?skill=SINGING')).sort()).toEqual([a.id, b.id].sort());
    expect(ids(await agent.get('/api/talent?skill=stage%20combat'))).toEqual([a.id]);
    expect(ids(await agent.get('/api/talent?skill=sin'))).toEqual([]);
    expect(ids(await agent.get('/api/talent?language=arabic'))).toEqual([a.id]);
    expect(ids(await agent.get('/api/talent?language=English'))).toEqual([b.id]);
    expect(ids(await agent.get('/api/talent?skill=singing&language=french'))).toEqual([a.id]);
    // Non-ASCII letters fold too.
    expect(ids(await agent.get(`/api/talent?skill=${encodeURIComponent('ÉPÉE')}`))).toEqual([e.id]);
    expect(ids(await agent.get(`/api/talent?language=${encodeURIComponent('élvish')}`))).toEqual([e.id]);
  });

  it('combines filters', async () => {
    const hit = await createTalent(agent, { gender: 'female', playingAgeMin: 20, playingAgeMax: 30, skills: ['Dance'], firstName: 'Hala' });
    await createTalent(agent, { gender: 'male', playingAgeMin: 20, playingAgeMax: 30, skills: ['Dance'], firstName: 'Hadi' });
    await createTalent(agent, { gender: 'female', playingAgeMin: 40, playingAgeMax: 50, skills: ['Dance'], firstName: 'Hiba' });
    await createTalent(agent, { gender: 'female', playingAgeMin: 20, playingAgeMax: 30, skills: ['Dance'], firstName: 'Huda', status: 'former' });
    const res = await agent.get('/api/talent?gender=female&age=25&skill=dance&status=active&q=h');
    expect(ids(res)).toEqual([hit.id]);
  });
});

describe('talent tags', () => {
  it('lists distinct skills and languages, de-duplicated case-insensitively, most common spelling, sorted', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    expect((await agent.get('/api/talent/tags')).body).toEqual({ skills: [], languages: [] });

    await createTalent(agent, { skills: ['singing', 'Stage combat'], languages: ['Arabic', 'english'] });
    await createTalent(agent, { skills: ['Singing', 'Accents'], languages: ['English', 'arabic'] });
    await createTalent(agent, { skills: ['Singing', 'zumba'], languages: ['English', 'Arabic'] });
    const res = await agent.get('/api/talent/tags');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      skills: ['Accents', 'Singing', 'Stage combat', 'zumba'],
      languages: ['Arabic', 'English'],
    });
  });

  it('is not mistaken for a talent id and needs talent.read', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/talent/tags')).status).toBe(401);
    const teacher = await t.as('teacher');
    expect((await teacher.get('/api/talent/tags')).status).toBe(403);
  });
});

describe('student link', () => {
  let t: Ctx;
  let agent: Client;
  beforeEach(async () => {
    t = await makeTestContext();
    agent = await t.as('agent');
  });

  it('links a student on create', async () => {
    const s = addStudent(t);
    const res = await agent.post('/api/talent', { firstName: 'Sara', lastName: 'Haddad', studentId: s.id });
    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe(s.id);
  });

  it('refuses a missing student (400 on studentId)', async () => {
    const res = await agent.post('/api/talent', { firstName: 'A', lastName: 'B', studentId: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    expect(res.body.error.issues).toEqual([expect.objectContaining({ path: ['studentId'] })]);

    const created = await createTalent(agent);
    const patch = await agent.patch(`/api/talent/${created.id}`, { studentId: 9999 });
    expect(patch.status).toBe(400);
    expect(patch.body.error.issues[0].path).toEqual(['studentId']);
  });

  it('refuses a student already on the roster (409 student_already_talent)', async () => {
    const s = addStudent(t);
    const first = await createTalent(agent, { studentId: s.id });
    const dup = await agent.post('/api/talent', { firstName: 'A', lastName: 'B', studentId: s.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('student_already_talent');

    const other = await createTalent(agent);
    const patch = await agent.patch(`/api/talent/${other.id}`, { studentId: s.id });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe('student_already_talent');

    // Re-sending the profile's own link is fine; unlinking frees the student.
    expect((await agent.patch(`/api/talent/${first.id}`, { studentId: s.id, city: 'Doha' })).status).toBe(200);
    expect((await agent.patch(`/api/talent/${first.id}`, { studentId: null })).body.studentId).toBeNull();
    expect((await agent.patch(`/api/talent/${other.id}`, { studentId: s.id })).body.studentId).toBe(s.id);
  });

  it('keeps the profile, unlinked, when the student is deleted', async () => {
    const s = addStudent(t);
    const created = await createTalent(agent, { studentId: s.id });
    t.db.delete(students).where(eq(students.id, s.id)).run();
    const res = await agent.get(`/api/talent/${created.id}`);
    expect(res.body).toMatchObject({ studentId: null, student: null });
  });
});

describe('student link follows student access', () => {
  it('talent.read+talent.write without students.read can’t learn student names (or ids) by linking', async () => {
    const t = await makeTestContext();
    const secret = addStudent(t, { firstName: 'Secret', lastName: 'Student' });
    const linkedElsewhere = addStudent(t, { firstName: 'Linked', lastName: 'Already' });
    const admin = await t.as('admin');
    const other = await createTalent(admin, { studentId: linkedElsewhere.id });
    const assistant = await t.as({ permissions: ['talent.read', 'talent.write'] });
    expect((await assistant.get(`/api/students/${secret.id}`)).status).toBe(403);
    const created = await assistant.post('/api/talent', { firstName: 'X', lastName: 'Y' });
    expect(created.status).toBe(201);
    const missing = await assistant.post('/api/talent', { firstName: 'X', lastName: 'Y', studentId: 99999 });
    expect(missing.status).toBe(400);
    // Existing, missing and already-linked students all answer the same.
    for (const studentId of [secret.id, linkedElsewhere.id]) {
      const onCreate = await assistant.post('/api/talent', { firstName: 'X', lastName: 'Y', studentId });
      expect([onCreate.status, onCreate.body]).toEqual([missing.status, missing.body]);
      const onPatch = await assistant.patch(`/api/talent/${created.body.id}`, { studentId });
      expect([onPatch.status, onPatch.body]).toEqual([missing.status, missing.body]);
    }
    expect(t.db.select().from(talent).where(eq(talent.studentId, secret.id)).all()).toHaveLength(0);
    // A profile someone else linked shows no student, and the studentId filter finds nothing.
    const detail = await assistant.get(`/api/talent/${other.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ studentId: null, student: null });
    expect(ids(await assistant.get(`/api/talent?studentId=${linkedElsewhere.id}`))).toEqual([]);
    expect(ids(await admin.get(`/api/talent?studentId=${linkedElsewhere.id}`))).toEqual([other.id]);
    // Editing that profile neither shows nor drops the link.
    const edited = await assistant.patch(`/api/talent/${other.id}`, { city: 'Cairo' });
    expect(edited.body).toMatchObject({ city: 'Cairo', studentId: null });
    expect(t.db.select().from(talent).where(eq(talent.id, other.id)).get()!.studentId).toBe(linkedElsewhere.id);
  });

  it('a coach with talent.read doesn’t see the linked student outside their classes', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const outside = addStudent(t, { firstName: 'Outside', lastName: 'Pupil' });
    const tal = await createTalent(admin, { firstName: 'Stage', lastName: 'Name', studentId: outside.id });
    const coach = await t.as({ permissions: ['students.read', 'courses.read', 'attendance.write', 'talent.read'] });
    expect((await coach.get(`/api/students/${outside.id}`)).status).toBe(404);
    expect((await coach.get(`/api/talent/${tal.id}`)).body).toMatchObject({ studentId: null, student: null });
    expect(ids(await coach.get(`/api/talent?studentId=${outside.id}`))).toEqual([]);
    // The director sees the link.
    expect((await admin.get(`/api/talent/${tal.id}`)).body).toMatchObject({ studentId: outside.id, student: { id: outside.id, firstName: 'Outside', lastName: 'Pupil' } });
  });
});

describe('photos and headshot', () => {
  let t: Ctx;
  let agent: Client;
  beforeEach(async () => {
    t = await makeTestContext();
    agent = await t.as('agent');
  });

  it('adds photos in order; the first becomes the headshot', async () => {
    const created = await createTalent(agent);
    const f1 = await uploadPng(agent);
    const f2 = await uploadPng(agent);
    const p1 = await agent.post(`/api/talent/${created.id}/photos`, { fileId: f1, caption: 'Smiling' });
    expect(p1.status).toBe(201);
    expect(p1.body).toEqual({ id: expect.any(Number), fileId: f1, caption: 'Smiling', sortOrder: 0 });
    const p2 = await agent.post(`/api/talent/${created.id}/photos`, { fileId: f2 });
    expect(p2.body).toMatchObject({ fileId: f2, caption: null, sortOrder: 1 });

    const detail = await agent.get(`/api/talent/${created.id}`);
    expect(detail.body.headshotFileId).toBe(f1);
    expect(detail.body.photos.map((p: any) => p.fileId)).toEqual([f1, f2]);
    // The list shows the headshot too.
    expect((await agent.get('/api/talent')).body.items[0].headshotFileId).toBe(f1);
  });

  it('refuses a missing file (400) and a duplicate (409)', async () => {
    const created = await createTalent(agent);
    const missing = await agent.post(`/api/talent/${created.id}/photos`, { fileId: crypto.randomUUID() });
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues[0].path).toEqual(['fileId']);
    expect((await agent.post(`/api/talent/${created.id}/photos`, { fileId: 'nope' })).status).toBe(400);

    const f = await uploadPng(agent);
    expect((await agent.post(`/api/talent/${created.id}/photos`, { fileId: f })).status).toBe(201);
    const dup = await agent.post(`/api/talent/${created.id}/photos`, { fileId: f });
    expect(dup.status).toBe(409);
    // The same file can still go to another profile.
    const other = await createTalent(agent);
    expect((await agent.post(`/api/talent/${other.id}/photos`, { fileId: f })).status).toBe(201);
  });

  it('only accepts one of the talent’s own photos as the headshot', async () => {
    const a = await createTalent(agent);
    const b = await createTalent(agent);
    const fa1 = await uploadPng(agent);
    const fa2 = await uploadPng(agent);
    const fb = await uploadPng(agent);
    const loose = await uploadPng(agent);
    await agent.post(`/api/talent/${a.id}/photos`, { fileId: fa1 });
    await agent.post(`/api/talent/${a.id}/photos`, { fileId: fa2 });
    await agent.post(`/api/talent/${b.id}/photos`, { fileId: fb });

    const ok = await agent.patch(`/api/talent/${a.id}`, { headshotFileId: fa2 });
    expect(ok.status).toBe(200);
    expect(ok.body.headshotFileId).toBe(fa2);

    for (const fileId of [fb, loose, crypto.randomUUID()]) {
      const res = await agent.patch(`/api/talent/${a.id}`, { headshotFileId: fileId });
      expect(res.status).toBe(400);
      expect(res.body.error.issues[0]).toMatchObject({ path: ['headshotFileId'], message: 'talent:errors.headshotNotPhoto' });
    }
    expect((await agent.patch(`/api/talent/${a.id}`, { headshotFileId: 'not-a-uuid' })).status).toBe(400);

    const none = await agent.patch(`/api/talent/${a.id}`, { headshotFileId: null });
    expect(none.body.headshotFileId).toBeNull();
    // Next photo added becomes the headshot again because there is none.
    const fa3 = await uploadPng(agent);
    await agent.post(`/api/talent/${a.id}/photos`, { fileId: fa3 });
    expect((await agent.get(`/api/talent/${a.id}`)).body.headshotFileId).toBe(fa3);
  });

  it('does not replace an existing headshot when more photos are added', async () => {
    const a = await createTalent(agent);
    const f1 = await uploadPng(agent);
    const f2 = await uploadPng(agent);
    await agent.post(`/api/talent/${a.id}/photos`, { fileId: f1 });
    await agent.patch(`/api/talent/${a.id}`, { headshotFileId: f1 });
    await agent.post(`/api/talent/${a.id}/photos`, { fileId: f2 });
    expect((await agent.get(`/api/talent/${a.id}`)).body.headshotFileId).toBe(f1);
  });

  it('updates caption and order', async () => {
    const a = await createTalent(agent);
    const f1 = await uploadPng(agent);
    const f2 = await uploadPng(agent);
    const p1 = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f1 })).body;
    const p2 = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f2 })).body;

    const res = await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, { caption: 'Profile', sortOrder: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: p1.id, fileId: f1, caption: 'Profile', sortOrder: 5 });
    expect((await agent.get(`/api/talent/${a.id}`)).body.photos.map((p: any) => p.id)).toEqual([p2.id, p1.id]);

    const cleared = await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, { caption: '' });
    expect(cleared.body).toMatchObject({ caption: null, sortOrder: 5 });
    expect((await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, {})).status).toBe(200);
    expect((await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, { sortOrder: -1 })).status).toBe(400);
    expect((await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, { sortOrder: 1.5 })).status).toBe(400);
  });

  it('treats another talent’s photo as not found', async () => {
    const a = await createTalent(agent);
    const b = await createTalent(agent);
    const f = await uploadPng(agent);
    const p = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f })).body;
    expect((await agent.patch(`/api/talent/${b.id}/photos/${p.id}`, { caption: 'x' })).status).toBe(404);
    expect((await agent.delete(`/api/talent/${b.id}/photos/${p.id}`)).status).toBe(404);
    expect((await agent.delete(`/api/talent/${a.id}/photos/9999`)).status).toBe(404);
  });

  it('moves the headshot to the first remaining photo when it is deleted, then to none', async () => {
    const a = await createTalent(agent);
    const [f1, f2, f3] = [await uploadPng(agent), await uploadPng(agent), await uploadPng(agent)];
    const p1 = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f1 })).body;
    const p2 = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f2 })).body;
    const p3 = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f3 })).body;
    // Put photo 3 first in the gallery.
    await agent.patch(`/api/talent/${a.id}/photos/${p3.id}`, { sortOrder: 0 });
    await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, { sortOrder: 1 });
    await agent.patch(`/api/talent/${a.id}/photos/${p2.id}`, { sortOrder: 2 });

    // Deleting a non-headshot photo leaves the headshot alone.
    expect((await agent.delete(`/api/talent/${a.id}/photos/${p2.id}`)).status).toBe(204);
    expect((await agent.get(`/api/talent/${a.id}`)).body.headshotFileId).toBe(f1);

    expect((await agent.delete(`/api/talent/${a.id}/photos/${p1.id}`)).status).toBe(204);
    let detail = (await agent.get(`/api/talent/${a.id}`)).body;
    expect(detail.headshotFileId).toBe(f3);
    expect(detail.photos.map((p: any) => p.id)).toEqual([p3.id]);

    expect((await agent.delete(`/api/talent/${a.id}/photos/${p3.id}`)).status).toBe(204);
    detail = (await agent.get(`/api/talent/${a.id}`)).body;
    expect(detail.headshotFileId).toBeNull();
    expect(detail.photos).toEqual([]);
  });

  it('sets sortOrder after the highest even with gaps', async () => {
    const a = await createTalent(agent);
    const f1 = await uploadPng(agent);
    const p1 = (await agent.post(`/api/talent/${a.id}/photos`, { fileId: f1 })).body;
    await agent.patch(`/api/talent/${a.id}/photos/${p1.id}`, { sortOrder: 7 });
    const p2 = await agent.post(`/api/talent/${a.id}/photos`, { fileId: await uploadPng(agent) });
    expect(p2.body.sortOrder).toBe(8);
  });
});

describe('detail submissions', () => {
  it('includes the talent’s submissions with casting and role, newest first', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const me = await createTalent(agent);
    const other = await createTalent(agent);
    const c1 = t.db.insert(castings).values({ title: 'Desert Film' }).returning().get()!;
    const c2 = t.db.insert(castings).values({ title: 'Juice Ad', type: 'commercial' }).returning().get()!;
    const r1 = t.db.insert(castingRoles).values({ castingId: c1.id, name: 'Nadia' }).returning().get()!;
    const r2 = t.db.insert(castingRoles).values({ castingId: c2.id, name: 'Mum' }).returning().get()!;
    const old = t.db
      .insert(submissions)
      .values({ roleId: r1.id, talentId: me.id, status: 'callback', auditionAt: '2026-03-02T14:30', updatedAt: 1000, createdAt: 1000 })
      .returning()
      .get()!;
    const recent = t.db
      .insert(submissions)
      .values({ roleId: r2.id, talentId: me.id, status: 'booked', updatedAt: 5000, createdAt: 2000 })
      .returning()
      .get()!;
    t.db.insert(submissions).values({ roleId: r1.id, talentId: other.id }).run();

    const res = await agent.get(`/api/talent/${me.id}`);
    expect(res.body.submissions).toEqual([
      { id: recent.id, status: 'booked', castingId: c2.id, castingTitle: 'Juice Ad', roleId: r2.id, roleName: 'Mum', auditionAt: null, updatedAt: 5000 },
      {
        id: old.id,
        status: 'callback',
        castingId: c1.id,
        castingTitle: 'Desert Film',
        roleId: r1.id,
        roleName: 'Nadia',
        auditionAt: '2026-03-02T14:30',
        updatedAt: 1000,
      },
    ]);
  });
});

describe('talent permissions', () => {
  it('answers 401 when signed out, on every route', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const a = await createTalent(owner);
    const anon = t.anon;
    expect((await anon.get('/api/talent')).status).toBe(401);
    expect((await anon.get(`/api/talent/${a.id}`)).status).toBe(401);
    expect((await anon.post('/api/talent', { firstName: 'A', lastName: 'B' })).status).toBe(401);
    expect((await anon.patch(`/api/talent/${a.id}`, { city: 'X' })).status).toBe(401);
    expect((await anon.delete(`/api/talent/${a.id}`)).status).toBe(401);
    expect((await anon.post(`/api/talent/${a.id}/photos`, { fileId: crypto.randomUUID() })).status).toBe(401);
    expect((await anon.patch(`/api/talent/${a.id}/photos/1`, {})).status).toBe(401);
    expect((await anon.delete(`/api/talent/${a.id}/photos/1`)).status).toBe(401);
  });

  it('answers 403 to teachers on everything, reads included', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const a = await createTalent(owner);
    const f = await uploadPng(owner);
    const p = (await owner.post(`/api/talent/${a.id}/photos`, { fileId: f })).body;
    const teacher = await t.as('teacher');
    expect((await teacher.get('/api/talent')).status).toBe(403);
    expect((await teacher.get('/api/talent/tags')).status).toBe(403);
    expect((await teacher.get(`/api/talent/${a.id}`)).status).toBe(403);
    expect((await teacher.get('/api/talent/9999')).status).toBe(403);
    expect((await teacher.post('/api/talent', { firstName: 'A', lastName: 'B' })).status).toBe(403);
    expect((await teacher.patch(`/api/talent/${a.id}`, { city: 'X' })).status).toBe(403);
    expect((await teacher.delete(`/api/talent/${a.id}`)).status).toBe(403);
    expect((await teacher.post(`/api/talent/${a.id}/photos`, { fileId: f })).status).toBe(403);
    expect((await teacher.patch(`/api/talent/${a.id}/photos/${p.id}`, { caption: 'x' })).status).toBe(403);
    expect((await teacher.delete(`/api/talent/${a.id}/photos/${p.id}`)).status).toBe(403);
    // Nothing changed.
    expect(t.db.select().from(talent).all()).toHaveLength(1);
    expect(t.db.select().from(talentPhotos).all()).toHaveLength(1);
  });

  it.each(['agent', 'admin', 'owner'] as const)('lets %s read and write', async (role) => {
    const t = await makeTestContext();
    const me = await t.as(role);
    const created = await createTalent(me);
    expect((await me.get('/api/talent')).status).toBe(200);
    expect((await me.get('/api/talent/tags')).status).toBe(200);
    expect((await me.get(`/api/talent/${created.id}`)).status).toBe(200);
    expect((await me.patch(`/api/talent/${created.id}`, { city: 'Beirut' })).status).toBe(200);
    const f = await uploadPng(me);
    const p = await me.post(`/api/talent/${created.id}/photos`, { fileId: f });
    expect(p.status).toBe(201);
    expect((await me.patch(`/api/talent/${created.id}/photos/${p.body.id}`, { caption: 'Hi' })).status).toBe(200);
    expect((await me.delete(`/api/talent/${created.id}/photos/${p.body.id}`)).status).toBe(204);
    expect((await me.delete(`/api/talent/${created.id}`)).status).toBe(204);
  });

  it('rejects a deactivated agent', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    t.db.update(users).set({ active: false }).where(eq(users.id, agent.user.id)).run();
    expect((await agent.get('/api/talent')).status).toBe(401);
  });

  it('requires the X-Requested-With header on writes', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const res = await agent.raw('/api/talent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: agent.cookie! },
      body: JSON.stringify({ firstName: 'A', lastName: 'B' }),
    });
    expect(res.status).toBe(403);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const res = await agent.raw('/api/talent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: agent.cookie!, 'x-requested-with': 'fetch' },
      body: '{nope',
    });
    expect(res.status).toBe(400);
  });
});

describe('talent contact details (talent.contact)', () => {
  it('without talent.contact (video editor) phone and email are hidden on every answer', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const actor = await createTalent(agent, { email: 'lina@example.com', phone: '+20 100 555 1234', city: 'Cairo' });
    const editor = await t.as('video_editor');
    const detail = await editor.get(`/api/talent/${actor.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ email: null, phone: null, city: 'Cairo', contactHidden: true });
    // The list carries no contact details at all; the editor still sees names and photos.
    const list = await editor.get('/api/talent');
    expect(list.body.items[0]).toMatchObject({ firstName: 'Lina', headshotFileId: null });
    expect('phone' in list.body.items[0]).toBe(false);
    // Search never looks at phone or email (no oracle).
    expect(ids(await editor.get('/api/talent?q=555'))).toEqual([]);
    expect(ids(await editor.get('/api/talent?q=lina%40'))).toEqual([]);
    expect(ids(await editor.get('/api/talent?q=lina'))).toEqual([actor.id]);
  });

  it('the casting team (talent.contact) sees them', async () => {
    const t = await makeTestContext();
    const team = await t.as('casting_team');
    const actor = await createTalent(team, { email: 'lina@example.com', phone: '0100' });
    expect(actor).toMatchObject({ email: 'lina@example.com', phone: '0100', contactHidden: false });
    expect((await team.get(`/api/talent/${actor.id}`)).body).toMatchObject({ email: 'lina@example.com', contactHidden: false });
  });

  it('without talent.contact, create and update ignore phone and email (an edit form can’t wipe them)', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    const writer = await t.as({ permissions: ['talent.read', 'talent.write'] });
    const actor = await createTalent(agent, { email: 'lina@example.com', phone: '0100' });
    const res = await writer.patch(`/api/talent/${actor.id}`, { email: '', phone: null, city: 'Giza' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ city: 'Giza', email: null, phone: null, contactHidden: true });
    expect(t.db.select().from(talent).where(eq(talent.id, actor.id)).get()).toMatchObject({ email: 'lina@example.com', phone: '0100', city: 'Giza' });
    const created = await writer.post('/api/talent', { firstName: 'New', lastName: 'Face', email: 'x@example.com', phone: '123' });
    expect(created.status).toBe(201);
    expect(t.db.select().from(talent).where(eq(talent.id, created.body.id)).get()).toMatchObject({ email: null, phone: null });
  });
});
