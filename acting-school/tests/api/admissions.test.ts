import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addDays, todayISO } from '../../src/shared/dates';
import type { DashboardData } from '../../src/shared/schemas/dashboard';
import type { AdmissionsCourseOption, EnrolResult, Interview, LeadActivity, LeadDetail, LeadListItem } from '../../src/shared/schemas/admissions';
import type { ScheduleEvent } from '../../src/shared/schemas/schedule';
import { courses, enrollments, interviews, leadActivities, leads, students } from '../../src/server/db/schema';
import { makeTestContext, type Client } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const today = todayISO();
const tomorrow = addDays(today, 1);

const LEAD_KEYS = [
  'id',
  'firstName',
  'lastName',
  'phone',
  'email',
  'dateOfBirth',
  'gender',
  'city',
  'guardianName',
  'guardianPhone',
  'source',
  'sourceDetail',
  'interest',
  'experience',
  'preferredCourseId',
  'status',
  'lostReason',
  'assignedToId',
  'nextFollowUpOn',
  'studentId',
  'createdById',
  'notes',
  'createdAt',
  'updatedAt',
  'assignedToName',
  'createdByName',
  'preferredCourse',
  'student',
  'interviews',
  'activities',
].sort();

const INTERVIEW_KEYS = [
  'id',
  'leadId',
  'scheduledAt',
  'durationMinutes',
  'room',
  'interviewerId',
  'interviewerName',
  'status',
  'scores',
  'strengths',
  'areasToWork',
  'notes',
  'recommendation',
  'recommendedLevel',
  'recommendedCourseId',
  'recommendedCourseName',
  'recordedById',
  'recordedByName',
  'recordedAt',
  'createdAt',
  'updatedAt',
].sort();

async function mkLead(client: Client, body: Record<string, unknown> = {}): Promise<LeadDetail> {
  const res = await client.post<LeadDetail>('/api/leads', { firstName: 'Nour', lastName: 'Khaled', phone: '0100 765 4321', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

function mkCourse(t: Ctx, o: Partial<typeof courses.$inferInsert> = {}) {
  return t.db
    .insert(courses)
    .values({ name: 'Screen Acting I', startDate: addDays(today, -30), endDate: addDays(today, 60), ...o })
    .returning()
    .get()!;
}

function mkStudent(t: Ctx, o: Partial<typeof students.$inferInsert> = {}) {
  return t.db.insert(students).values({ firstName: 'Existing', lastName: 'Student', ...o }).returning().get()!;
}

const getLead = async (client: Client, id: number) => (await client.get<LeadDetail>(`/api/leads/${id}`)).body;
const statusOf = (t: Ctx, id: number) => t.db.select({ status: leads.status }).from(leads).where(eq(leads.id, id)).get()!.status;
const statusChanges = (lead: LeadDetail) =>
  lead.activities
    .filter((a) => a.type === 'status_change')
    .map((a) => `${a.meta!.from}>${a.meta!.to}`)
    .reverse();

/** Schedule an interview (the body is typed loosely: error answers are checked too). */
async function schedule(client: Client, leadId: number, body: Record<string, unknown> = {}) {
  return client.post<Interview & { error?: any }>(`/api/leads/${leadId}/interviews`, { scheduledAt: `${tomorrow}T17:00`, ...body });
}

const SCORES = { presence: 4, voice: 5, body: 3, emotion: 4, imagination: 5, listening: 4, commitment: 5 };

// ── Access ──────────────────────────────────────────────────────────────────

describe('admissions access', () => {
  it('401 signed out', async () => {
    const t = await makeTestContext();
    for (const url of ['/api/leads', '/api/leads/1', '/api/leads/counts', '/api/leads/duplicates?phone=0100', '/api/leads/course-options']) {
      expect((await t.anon.get(url)).status).toBe(401);
    }
    expect((await t.anon.post('/api/leads', { firstName: 'A', lastName: 'B', phone: '01001234567' })).status).toBe(401);
    expect((await t.anon.post('/api/leads/1/enrol', { courseId: 1 })).status).toBe(401);
  });

  it('403 for positions without admissions.read (coach, casting team, video editor, head of casting, finance)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    for (const role of ['acting_coach', 'casting_team', 'video_editor', 'head_of_casting', 'finance'] as const) {
      const c = await t.as(role);
      expect((await c.get('/api/leads')).status).toBe(403);
      expect((await c.get(`/api/leads/${lead.id}`)).status).toBe(403);
      expect((await c.get('/api/leads/counts')).status).toBe(403);
      expect((await c.get('/api/leads/duplicates?phone=01007654321')).status).toBe(403);
      expect((await c.get('/api/leads/course-options')).status).toBe(403);
      expect((await c.post('/api/leads', { firstName: 'A', lastName: 'B', phone: '01001234567' })).status).toBe(403);
      expect((await c.patch(`/api/leads/${lead.id}`, { notes: 'x' })).status).toBe(403);
      expect((await c.delete(`/api/leads/${lead.id}`)).status).toBe(403);
    }
  });

  it('only admissions.read: reads everything (contacts included), every write is 403', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { email: 'nour@example.com', guardianPhone: '+20 100 000 0000' });
    const iv = (await schedule(director, lead.id)).body;
    const reader = await t.as({ permissions: ['admissions.read'] });

    expect((await reader.get('/api/leads')).body.items).toHaveLength(1);
    const d = await reader.get<LeadDetail>(`/api/leads/${lead.id}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ phone: '0100 765 4321', email: 'nour@example.com', guardianPhone: '+20 100 000 0000' });
    expect((await reader.get('/api/leads/counts')).status).toBe(200);

    expect((await reader.post('/api/leads', { firstName: 'A', lastName: 'B', phone: '01001234567' })).status).toBe(403);
    expect((await reader.patch(`/api/leads/${lead.id}`, { notes: 'x' })).status).toBe(403);
    expect((await reader.post(`/api/leads/${lead.id}/activities`, { type: 'call' })).status).toBe(403);
    expect((await schedule(reader, lead.id)).status).toBe(403);
    expect((await reader.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'cancelled' })).status).toBe(403);
    expect((await reader.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id })).status).toBe(403);
    expect((await reader.delete(`/api/leads/${lead.id}`)).status).toBe(403);
    // Nothing changed.
    expect((await getLead(director, lead.id)).status).toBe('interview_scheduled');
  });

  it('read + write without decide: works the lead, but deciding, recording, enrolling and deleting are 403', async () => {
    const t = await makeTestContext();
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lead = await mkLead(desk);
    expect((await desk.post(`/api/leads/${lead.id}/activities`, { type: 'call', body: 'Called' })).status).toBe(201);
    const iv = (await schedule(desk, lead.id)).body;
    expect((await desk.patch(`/api/leads/${lead.id}`, { status: 'accepted' })).status).toBe(403);
    expect((await desk.patch(`/api/leads/${lead.id}`, { status: 'declined' })).status).toBe(403);
    expect((await desk.post(`/api/leads/${lead.id}/activities`, { type: 'note', body: 'ok', status: 'accepted' })).status).toBe(403);
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'done' })).status).toBe(403);
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { scores: { voice: 3 } })).status).toBe(403);
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { recommendation: 'accept' })).status).toBe(403);
    expect((await desk.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id })).status).toBe(403);
    expect((await desk.delete(`/api/leads/${lead.id}`)).status).toBe(403);
    // Write-level interview changes are fine.
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { room: 'Studio B', scheduledAt: `${tomorrow}T18:00` })).status).toBe(200);
    expect(statusOf(t, lead.id)).toBe('interview_scheduled');
  });

  it('the director and owners hold all three; positions without them get no admissions on the dashboard', async () => {
    const t = await makeTestContext();
    for (const role of ['executive_director', 'ceo', 'cfo'] as const) {
      const me = (await (await t.as(role)).get('/api/auth/me')).body.user;
      expect(me.permissions).toEqual(expect.arrayContaining(['admissions.read', 'admissions.write', 'admissions.decide']));
    }
    for (const role of ['acting_coach', 'casting_team', 'video_editor', 'head_of_casting', 'finance'] as const) {
      const me = (await (await t.as(role)).get('/api/auth/me')).body.user;
      expect(me.permissions.filter((p: string) => p.startsWith('admissions.'))).toEqual([]);
    }
  });
});

// ── Create / read / update / delete ─────────────────────────────────────────

describe('leads CRUD', () => {
  it('creates with defaults: status new, source other, assigned to and created by the caller', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { name: 'Salma' });
    const lead = await mkLead(director, { firstName: '  نور ', email: 'Nour@Example.COM', city: '', interest: 'Screen acting' });
    expect(Object.keys(lead).sort()).toEqual(LEAD_KEYS);
    expect(lead).toMatchObject({
      firstName: 'نور',
      lastName: 'Khaled',
      phone: '0100 765 4321',
      email: 'nour@example.com',
      city: null,
      source: 'other',
      status: 'new',
      lostReason: null,
      assignedToId: director.user.id,
      assignedToName: 'Salma',
      createdById: director.user.id,
      createdByName: 'Salma',
      nextFollowUpOn: null,
      studentId: null,
      student: null,
      preferredCourse: null,
      interest: 'Screen acting',
      interviews: [],
      activities: [],
    });
    const fetched = await director.get<LeadDetail>(`/api/leads/${lead.id}`);
    expect(fetched.body).toEqual(lead);
  });

  it('stores every field; assignedToId null leaves it unassigned; a preferred class shows its teacher', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const coach = await t.createUser('acting_coach', { name: 'Moaty' });
    const course = mkCourse(t, { teacherId: coach.id, level: 'beginner' });
    const lead = await mkLead(director, {
      email: 'x@example.com',
      dateOfBirth: '2014-03-03',
      gender: 'male',
      city: 'Giza',
      guardianName: 'Father',
      guardianPhone: '+20 109 444 2200',
      source: 'facebook',
      sourceDetail: 'Ad: Kids Drama',
      interest: 'Kids class',
      experience: 'None',
      preferredCourseId: course.id,
      assignedToId: null,
      nextFollowUpOn: tomorrow,
      notes: 'Call after 6pm',
    });
    expect(lead).toMatchObject({
      dateOfBirth: '2014-03-03',
      gender: 'male',
      guardianName: 'Father',
      source: 'facebook',
      sourceDetail: 'Ad: Kids Drama',
      assignedToId: null,
      assignedToName: null,
      nextFollowUpOn: tomorrow,
      preferredCourseId: course.id,
      preferredCourse: { id: course.id, name: 'Screen Acting I', level: 'beginner', status: 'active', teacherId: coach.id, teacherName: 'Moaty' },
    });
  });

  it('validates: names and phone required, phone needs 7+ digits, email, dates, enums, known class', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const bad = async (body: Record<string, unknown>, path: string) => {
      const res = await director.post('/api/leads', { firstName: 'A', lastName: 'B', phone: '01001234567', ...body });
      expect(res.status, path).toBe(400);
      expect(res.body.error.issues.map((i: any) => i.path[0])).toContain(path);
      return res;
    };
    await bad({ firstName: '  ' }, 'firstName');
    await bad({ lastName: undefined }, 'lastName');
    await bad({ phone: '' }, 'phone');
    expect((await bad({ phone: '12-34' }, 'phone')).body.error.issues[0].message).toBe('admissions:errors.invalidPhone');
    await bad({ guardianPhone: '123' }, 'guardianPhone');
    await bad({ email: 'nope' }, 'email');
    await bad({ dateOfBirth: '2020-02-30' }, 'dateOfBirth');
    await bad({ nextFollowUpOn: 'tomorrow' }, 'nextFollowUpOn');
    await bad({ source: 'carrier_pigeon' }, 'source');
    await bad({ gender: 'x' }, 'gender');
    await bad({ status: 'maybe' }, 'status');
    await bad({ lostReason: 'bored', status: 'lost' }, 'lostReason');
    expect((await bad({ preferredCourseId: 999 }, 'preferredCourseId')).body.error.issues[0].message).toBe('admissions:errors.courseNotFound');
    const archived = mkCourse(t, { status: 'archived' });
    expect((await bad({ preferredCourseId: archived.id }, 'preferredCourseId')).body.error.issues[0].message).toBe('admissions:errors.courseArchived');
    expect((await director.post('/api/leads', 'nope' as any)).status).toBe(400);
    expect(t.db.select().from(leads).all()).toHaveLength(0);
  });

  it('404 for a lead that does not exist', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    expect((await director.get('/api/leads/999')).status).toBe(404);
    expect((await director.get('/api/leads/abc')).status).toBe(404);
    expect((await director.patch('/api/leads/999', { notes: 'x' })).status).toBe(404);
    expect((await director.delete('/api/leads/999')).status).toBe(404);
    expect((await director.post('/api/leads/999/activities', { type: 'call' })).status).toBe(404);
    expect((await schedule(director, 999)).status).toBe(404);
    expect((await director.post('/api/leads/999/enrol', { courseId: 1 })).status).toBe(404);
  });

  it('PATCH changes only what is sent; blank optional fields clear', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { email: 'a@example.com', city: 'Cairo', source: 'whatsapp' });
    const res = await director.patch<LeadDetail>(`/api/leads/${lead.id}`, { city: '', lastName: 'Kamal', interest: 'Voice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ city: null, lastName: 'Kamal', interest: 'Voice', email: 'a@example.com', source: 'whatsapp', status: 'new' });
    expect((await director.patch(`/api/leads/${lead.id}`, { phone: '' })).status).toBe(400);
    expect((await director.patch(`/api/leads/${lead.id}`, { firstName: null })).status).toBe(400);
    expect((await director.patch(`/api/leads/${lead.id}`, {})).status).toBe(200);
  });

  it('DELETE needs admissions.decide; removes the timeline and interviews, keeps an enrolled student', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    await schedule(director, lead.id);
    const enrolled = await mkLead(director, { phone: '01112223344' });
    await director.post(`/api/leads/${enrolled.id}/enrol`, { courseId: mkCourse(t).id });
    const studentId = (await getLead(director, enrolled.id)).studentId!;

    expect((await director.delete(`/api/leads/${lead.id}`)).status).toBe(204);
    expect((await director.delete(`/api/leads/${enrolled.id}`)).status).toBe(204);
    expect(t.db.select().from(leads).all()).toHaveLength(0);
    expect(t.db.select().from(interviews).all()).toHaveLength(0);
    expect(t.db.select().from(leadActivities).all()).toHaveLength(0);
    expect(t.db.select().from(students).where(eq(students.id, studentId)).get()).toBeTruthy();
  });
});

// ── Assignment ──────────────────────────────────────────────────────────────

describe('assignment', () => {
  it('must be an active staff member; a hidden owner answers like a missing id for non-owners', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const owner = await t.as('ceo', { name: 'Ahmed Tamam' });
    const gone = await t.createUser('acting_coach', { active: false });
    const colleague = await t.createUser({ permissions: ['admissions.read', 'admissions.write'] }, { name: 'Front desk' });

    for (const assignedToId of [gone.id, owner.user.id, 99999]) {
      const res = await director.post('/api/leads', { firstName: 'A', lastName: 'B', phone: '01001234567', assignedToId });
      expect(res.status).toBe(400);
      expect(res.body.error.issues).toEqual([expect.objectContaining({ path: ['assignedToId'], message: 'admissions:errors.assigneeInvalid' })]);
    }
    const lead = await mkLead(director, { assignedToId: colleague.id });
    expect(lead).toMatchObject({ assignedToId: colleague.id, assignedToName: 'Front desk' });
    expect((await director.patch(`/api/leads/${lead.id}`, { assignedToId: gone.id })).status).toBe(400);
    expect((await director.patch(`/api/leads/${lead.id}`, { assignedToId: owner.user.id })).status).toBe(400);

    // Owners may assign owners; the lead stays editable for the director while the assignment is unchanged.
    expect((await owner.patch(`/api/leads/${lead.id}`, { assignedToId: owner.user.id })).status).toBe(200);
    const edit = await director.patch<LeadDetail>(`/api/leads/${lead.id}`, { notes: 'Called back', assignedToId: owner.user.id });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ notes: 'Called back', assignedToId: owner.user.id });
    expect((await director.patch<LeadDetail>(`/api/leads/${lead.id}`, { assignedToId: null })).body.assignedToId).toBeNull();
  });
});

// ── Lists ───────────────────────────────────────────────────────────────────

describe('GET /api/leads', () => {
  async function fixture() {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const other = await t.createUser({ permissions: ['admissions.read', 'admissions.write'] });
    const a = await mkLead(director, { firstName: 'Amira', lastName: 'Saad', phone: '+20 101 234 5678', email: 'amira@example.com', source: 'whatsapp', nextFollowUpOn: addDays(today, -2) });
    const b = await mkLead(director, { firstName: 'Bassem', lastName: 'Youssef', phone: '0122 000 1111', source: 'instagram', nextFollowUpOn: tomorrow, assignedToId: other.id });
    const c = await mkLead(director, { firstName: 'Carla', lastName: 'Diaz', phone: '+34 600 111 222', source: 'whatsapp', nextFollowUpOn: today });
    const d = await mkLead(director, { firstName: 'Dina', lastName: 'Hamdy', phone: '0111 333 4444', source: 'email' });
    const e = await mkLead(director, { firstName: 'Ehab', lastName: 'Nour', phone: '0155 555 6666', source: 'walk_in', status: 'lost', lostReason: 'no_response' });
    await schedule(director, d.id);
    return { t, director, other, a, b, c, d, e };
  }
  const ids = (res: { body: { items: LeadListItem[] } }) => res.body.items.map((i) => i.id);

  it('lists every lead: follow-up soonest first, none last (then newest first), with names and the next interview', async () => {
    const { director, other, a, b, c, d, e } = await fixture();
    const res = await director.get<{ items: LeadListItem[] }>('/api/leads');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([a.id, c.id, b.id, e.id, d.id]);
    const bItem = res.body.items.find((i) => i.id === b.id)!;
    expect(bItem).toMatchObject({ assignedToId: other.id, assignedToName: other.name, source: 'instagram', status: 'new', nextInterview: null });
    const dItem = res.body.items.find((i) => i.id === d.id)!;
    expect(dItem.nextInterview).toEqual({ id: expect.any(Number), scheduledAt: `${tomorrow}T17:00` });
    expect(dItem.status).toBe('interview_scheduled');
  });

  it('filters by group, status, source and assignee; searches names, email and phone digits', async () => {
    const { director, other, a, b, c, d, e } = await fixture();
    const get = (qs: string) => director.get<{ items: LeadListItem[] }>(`/api/leads?${qs}`);
    expect(ids(await get('group=open'))).toEqual([a.id, c.id, b.id, d.id]);
    expect(ids(await get('group=closed'))).toEqual([e.id]);
    expect(ids(await get('group=follow_up_due'))).toEqual([a.id, c.id]);
    expect(ids(await get('group=interviews'))).toEqual([d.id]);
    expect(ids(await get('status=new'))).toEqual([a.id, c.id, b.id]);
    expect(ids(await get('source=whatsapp'))).toEqual([a.id, c.id]);
    expect(ids(await get(`assignedToId=${other.id}`))).toEqual([b.id]);
    expect(ids(await get('q=amira'))).toEqual([a.id]);
    expect(ids(await get('q=youssef bassem'))).toEqual([b.id]);
    expect(ids(await get('q=diaz'))).toEqual([c.id]);
    expect(ids(await get('q=amira@example'))).toEqual([a.id]);
    // Phone digits: spaced, local with trunk 0 against an international number.
    expect(ids(await get('q=0122 000'))).toEqual([b.id]);
    expect(ids(await get('q=01012345678'))).toEqual([a.id]);
    expect(ids(await get('q=50%'))).toEqual([]);
    expect(ids(await get('group=open&source=whatsapp&q=carla'))).toEqual([c.id]);
    expect((await get('group=bogus')).status).toBe(400);
    expect((await get('status=bogus')).status).toBe(400);
  });

  it('counts per tab', async () => {
    const { director } = await fixture();
    expect((await director.get('/api/leads/counts')).body).toEqual({ followUpDue: 2, new: 3, interviews: 1, open: 4, closed: 1 });
  });
});

// ── Status rules ────────────────────────────────────────────────────────────

describe('automatic status moves', () => {
  it('contact on a new lead → contacted (a note alone does not); every change is on the timeline', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    await director.post(`/api/leads/${lead.id}/activities`, { type: 'note', body: 'Saw our post' });
    expect(statusOf(t, lead.id)).toBe('new');
    await director.post(`/api/leads/${lead.id}/activities`, { type: 'whatsapp', body: 'Sent prices' });
    expect(statusOf(t, lead.id)).toBe('contacted');
    await director.post(`/api/leads/${lead.id}/activities`, { type: 'call', body: 'Second call' });
    const d = await getLead(director, lead.id);
    expect(statusChanges(d)).toEqual(['new>contacted']);
    expect(d.activities.map((a) => a.type)).toEqual(['call', 'status_change', 'whatsapp', 'note']);
  });

  it('schedule → interview_scheduled; done → interviewed; accept → accepted; enrol → enrolled', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    const lead = await mkLead(director, { nextFollowUpOn: tomorrow });
    const iv = (await schedule(director, lead.id)).body;
    expect(statusOf(t, lead.id)).toBe('interview_scheduled');
    expect((await director.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'done', scores: SCORES, recommendation: 'accept' })).status).toBe(200);
    expect(statusOf(t, lead.id)).toBe('interviewed');
    expect((await director.patch(`/api/leads/${lead.id}`, { status: 'accepted' })).status).toBe(200);
    expect((await director.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id })).status).toBe(201);
    const d = await getLead(director, lead.id);
    expect(d).toMatchObject({ status: 'enrolled', nextFollowUpOn: null });
    expect(statusChanges(d)).toEqual(['new>interview_scheduled', 'interview_scheduled>interviewed', 'interviewed>accepted', 'accepted>enrolled']);
    expect(d.activities.map((a) => a.type).reverse()).toEqual([
      'interview_scheduled',
      'status_change',
      'interview_recorded',
      'status_change',
      'status_change',
      'status_change',
      'enrolled',
    ]);
  });

  it('decline → declined (closed: follow-up cleared)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { nextFollowUpOn: tomorrow });
    const res = await director.patch<LeadDetail>(`/api/leads/${lead.id}`, { status: 'declined' });
    expect(res.body).toMatchObject({ status: 'declined', nextFollowUpOn: null });
  });

  it('no-show → back to contacted, with the interview outcome and the status change on the timeline', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    const res = await desk.patch<Interview>(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'no_show' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'no_show', recordedById: desk.user.id, recordedAt: expect.any(Number) });
    const d = await getLead(director, lead.id);
    expect(d.status).toBe('contacted');
    expect(d.activities[0]).toMatchObject({ type: 'status_change', meta: { from: 'interview_scheduled', to: 'contacted' } });
    expect(d.activities[1]).toMatchObject({ type: 'interview_recorded', meta: { interviewId: iv.id, interviewStatus: 'no_show' } });
    // A new interview after the no-show.
    expect((await schedule(director, lead.id, { scheduledAt: `${addDays(today, 3)}T12:00` })).status).toBe(201);
    expect((await getLead(director, lead.id)).interviews.map((i) => i.status)).toEqual(['scheduled', 'no_show']);
  });

  it('cancelling the last scheduled interview → contacted; with another still scheduled the status stays', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const first = (await schedule(director, lead.id)).body;
    const second = (await schedule(director, lead.id, { scheduledAt: `${addDays(today, 2)}T10:00` })).body;
    await director.patch(`/api/leads/${lead.id}/interviews/${first.id}`, { status: 'cancelled' });
    expect(statusOf(t, lead.id)).toBe('interview_scheduled');
    await director.patch(`/api/leads/${lead.id}/interviews/${second.id}`, { status: 'cancelled' });
    expect(statusOf(t, lead.id)).toBe('contacted');
    // Back on the calendar → interview_scheduled again.
    await director.patch(`/api/leads/${lead.id}/interviews/${second.id}`, { status: 'scheduled' });
    expect(statusOf(t, lead.id)).toBe('interview_scheduled');
  });

  it('closing a lead cancels its interviews still scheduled', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    await director.patch(`/api/leads/${lead.id}`, { status: 'lost', lostReason: 'not_interested' });
    const d = await getLead(director, lead.id);
    expect(d.interviews.find((i) => i.id === iv.id)!.status).toBe('cancelled');
    expect(d.activities.some((a) => a.type === 'interview_recorded' && a.meta?.interviewStatus === 'cancelled')).toBe(true);
  });
});

describe('manual status rules', () => {
  it('accepted/declined need admissions.decide; enrolled only via enrol; lost needs a reason', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lead = await mkLead(desk);

    expect((await desk.patch(`/api/leads/${lead.id}`, { status: 'interviewed' })).status).toBe(200);
    expect((await desk.patch(`/api/leads/${lead.id}`, { status: 'accepted' })).status).toBe(403);
    expect((await director.patch(`/api/leads/${lead.id}`, { status: 'accepted' })).status).toBe(200);

    const enrolled = await director.patch(`/api/leads/${lead.id}`, { status: 'enrolled' });
    expect(enrolled.status).toBe(400);
    expect(enrolled.body.error.issues).toEqual([expect.objectContaining({ path: ['status'], message: 'admissions:errors.enrolViaAction' })]);
    expect((await director.post('/api/leads', { firstName: 'A', lastName: 'B', phone: '01001234567', status: 'enrolled' })).status).toBe(400);

    const noReason = await desk.patch(`/api/leads/${lead.id}`, { status: 'lost' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.issues).toEqual([expect.objectContaining({ path: ['lostReason'], message: 'admissions:errors.lostReasonRequired' })]);
    expect(statusOf(t, lead.id)).toBe('accepted');
  });

  it('lost with a reason clears the follow-up; a reason can be changed but not removed; follow-ups refused while closed', async () => {
    const t = await makeTestContext();
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lead = await mkLead(desk, { nextFollowUpOn: tomorrow });
    const lost = await desk.patch<LeadDetail>(`/api/leads/${lead.id}`, { status: 'lost', lostReason: 'too_expensive' });
    expect(lost.body).toMatchObject({ status: 'lost', lostReason: 'too_expensive', nextFollowUpOn: null });
    expect(lost.body.activities[0]).toMatchObject({ type: 'status_change', meta: { from: 'new', to: 'lost', lostReason: 'too_expensive' } });

    expect((await desk.patch<LeadDetail>(`/api/leads/${lead.id}`, { lostReason: 'schedule_conflict' })).body.lostReason).toBe('schedule_conflict');
    expect((await desk.patch(`/api/leads/${lead.id}`, { lostReason: null })).status).toBe(400);
    const fu = await desk.patch(`/api/leads/${lead.id}`, { nextFollowUpOn: tomorrow });
    expect(fu.status).toBe(400);
    expect(fu.body.error.issues[0]).toMatchObject({ path: ['nextFollowUpOn'], message: 'admissions:errors.followUpClosed' });
    // Closing and setting a follow-up at once is refused too.
    const other = await mkLead(desk, { phone: '01112223344' });
    expect((await desk.patch(`/api/leads/${other.id}`, { status: 'lost', lostReason: 'other', nextFollowUpOn: tomorrow })).status).toBe(400);
  });

  it('reopening a lost or declined lead → contacted (reason cleared); admissions.write is enough', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lost = await mkLead(desk, { status: 'lost', lostReason: 'no_response' });
    const reopened = await desk.patch<LeadDetail>(`/api/leads/${lost.id}`, { status: 'contacted', nextFollowUpOn: tomorrow });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ status: 'contacted', lostReason: null, nextFollowUpOn: tomorrow });
    expect(reopened.body.activities[0].meta).toEqual({ from: 'lost', to: 'contacted' });

    const declined = await mkLead(director, { phone: '01112223344' });
    await director.patch(`/api/leads/${declined.id}`, { status: 'declined' });
    expect((await desk.patch<LeadDetail>(`/api/leads/${declined.id}`, { status: 'contacted' })).body.status).toBe('contacted');
  });

  it('an enrolled lead’s status is final', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    await director.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id });
    const res = await director.patch(`/api/leads/${lead.id}`, { status: 'contacted' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('lead_enrolled');
    // Other fields stay editable; sending the same status is fine.
    expect((await director.patch(`/api/leads/${lead.id}`, { notes: 'Started Tuesday', status: 'enrolled' })).status).toBe(200);
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────

describe('POST /api/leads/:id/activities', () => {
  it('logs a contact (201, the activity), sets / clears / keeps the follow-up, and can change status', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { name: 'Salma' });
    const lead = await mkLead(director, { nextFollowUpOn: today });
    const res = await director.post<LeadActivity>(`/api/leads/${lead.id}/activities`, { type: 'call', body: ' Called, wants Saturday ', nextFollowUpOn: tomorrow });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      leadId: lead.id,
      type: 'call',
      body: 'Called, wants Saturday',
      meta: { nextFollowUpOn: tomorrow },
      createdById: director.user.id,
      createdByName: 'Salma',
    });
    expect((await getLead(director, lead.id)).nextFollowUpOn).toBe(tomorrow);
    await director.post(`/api/leads/${lead.id}/activities`, { type: 'email', body: 'Sent brochure' });
    expect((await getLead(director, lead.id)).nextFollowUpOn).toBe(tomorrow);
    await director.post(`/api/leads/${lead.id}/activities`, { type: 'meeting', nextFollowUpOn: null });
    expect((await getLead(director, lead.id)).nextFollowUpOn).toBeNull();

    await director.post(`/api/leads/${lead.id}/activities`, { type: 'whatsapp', body: 'Not now', status: 'lost', lostReason: 'schedule_conflict' });
    const d = await getLead(director, lead.id);
    expect(d).toMatchObject({ status: 'lost', lostReason: 'schedule_conflict' });
    // Newest first.
    expect(d.activities.map((a) => a.type)).toEqual(['status_change', 'whatsapp', 'meeting', 'email', 'status_change', 'call']);
  });

  it('validates: a note needs text; only contact types; dates; status rules', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const note = await director.post(`/api/leads/${lead.id}/activities`, { type: 'note', body: '  ' });
    expect(note.status).toBe(400);
    expect(note.body.error.issues[0]).toMatchObject({ path: ['body'], message: 'admissions:errors.noteRequired' });
    for (const type of ['status_change', 'enrolled', 'interview_recorded', 'fax', undefined]) {
      expect((await director.post(`/api/leads/${lead.id}/activities`, { type })).status).toBe(400);
    }
    expect((await director.post(`/api/leads/${lead.id}/activities`, { type: 'call', nextFollowUpOn: '2026-13-01' })).status).toBe(400);
    expect((await director.post(`/api/leads/${lead.id}/activities`, { type: 'call', status: 'lost' })).status).toBe(400);
    expect((await director.post(`/api/leads/${lead.id}/activities`, { type: 'call', status: 'enrolled' })).status).toBe(400);
    expect(t.db.select().from(leadActivities).all()).toHaveLength(0);
  });
});

// ── Interviews ──────────────────────────────────────────────────────────────

describe('interviews', () => {
  it('schedules with defaults (30 minutes, no interviewer) and answers the Interview shape', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { name: 'Salma' });
    const lead = await mkLead(director);
    const res = await schedule(director, lead.id, { room: 'Studio A', notes: 'Bring a monologue' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(INTERVIEW_KEYS);
    expect(res.body).toMatchObject({
      leadId: lead.id,
      scheduledAt: `${tomorrow}T17:00`,
      durationMinutes: 30,
      room: 'Studio A',
      interviewerId: null,
      status: 'scheduled',
      scores: {},
      notes: 'Bring a monologue',
      recommendation: null,
      recordedAt: null,
    });
    const withSalma = await schedule(director, lead.id, { interviewerId: director.user.id, durationMinutes: 45 });
    expect(withSalma.body).toMatchObject({ interviewerId: director.user.id, interviewerName: 'Salma', durationMinutes: 45 });
    const d = await getLead(director, lead.id);
    expect(d.interviews.map((i) => i.id)).toEqual([withSalma.body.id, res.body.id].sort((a, b) => b - a));
    expect(d.activities.find((a) => a.type === 'interview_scheduled')!.meta).toEqual({ interviewId: withSalma.body.id, scheduledAt: `${tomorrow}T17:00` });
  });

  it('validates the time, duration and interviewer (inactive or hidden owner → 400)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const owner = await t.as('ceo');
    const gone = await t.createUser('acting_coach', { active: false });
    const lead = await mkLead(director);
    for (const body of [{ scheduledAt: tomorrow }, { scheduledAt: `${tomorrow}T25:00` }, { scheduledAt: '2026-02-30T10:00' }, { durationMinutes: 2 }, { durationMinutes: 600 }]) {
      expect((await schedule(director, lead.id, body)).status).toBe(400);
    }
    for (const interviewerId of [gone.id, owner.user.id, 99999]) {
      const res = await schedule(director, lead.id, { interviewerId });
      expect(res.status).toBe(400);
      expect(res.body.error.issues[0]).toMatchObject({ path: ['interviewerId'], message: 'admissions:errors.interviewerInvalid' });
    }
    expect((await schedule(owner, lead.id, { interviewerId: owner.user.id })).status).toBe(201);
  });

  it('a lost/declined lead must be reopened first; an enrolled one can’t get interviews', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lost = await mkLead(director, { status: 'lost', lostReason: 'no_response' });
    const res = await schedule(director, lost.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('lead_closed');
    const enrolled = await mkLead(director, { phone: '01112223344' });
    await director.post(`/api/leads/${enrolled.id}/enrol`, { courseId: mkCourse(t).id });
    expect((await schedule(director, enrolled.id)).body.error.code).toBe('lead_enrolled');
  });

  it('reschedules (write) with the old time on the timeline; only a scheduled interview can move', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    const moved = await desk.patch<Interview>(`/api/leads/${lead.id}/interviews/${iv.id}`, { scheduledAt: `${addDays(today, 2)}T11:30`, durationMinutes: 60, room: 'Room 3' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ scheduledAt: `${addDays(today, 2)}T11:30`, durationMinutes: 60, room: 'Room 3', status: 'scheduled' });
    expect((await getLead(director, lead.id)).activities[0]).toMatchObject({
      type: 'interview_scheduled',
      meta: { interviewId: iv.id, scheduledAt: `${addDays(today, 2)}T11:30`, previousScheduledAt: `${tomorrow}T17:00` },
    });

    await director.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'done' });
    const late = await director.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { scheduledAt: `${addDays(today, 5)}T11:30` });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('interview_not_scheduled');
    // Sending the stored time back (a whole form) is not a reschedule.
    expect((await director.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { scheduledAt: `${addDays(today, 2)}T11:30`, notes: 'ok' })).status).toBe(200);
    // Changing a done interview needs admissions.decide.
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { notes: 'edit' })).status).toBe(403);
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'scheduled' })).status).toBe(403);
  });

  it('records the assessment (decide): scores against the current criteria, recommendation, level and class', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { name: 'Salma' });
    const course = mkCourse(t, { name: 'Voice & Speech' });
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    // Assessment fields without a status record the interview as done.
    const res = await director.patch<Interview>(`/api/leads/${lead.id}/interviews/${iv.id}`, {
      scores: SCORES,
      strengths: 'Great voice',
      areasToWork: 'Movement',
      notes: 'Nervous at first',
      recommendation: 'accept',
      recommendedLevel: 'intermediate',
      recommendedCourseId: course.id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'done',
      scores: SCORES,
      strengths: 'Great voice',
      areasToWork: 'Movement',
      recommendation: 'accept',
      recommendedLevel: 'intermediate',
      recommendedCourseId: course.id,
      recommendedCourseName: 'Voice & Speech',
      recordedById: director.user.id,
      recordedByName: 'Salma',
      recordedAt: expect.any(Number),
    });
    const d = await getLead(director, lead.id);
    expect(d.status).toBe('interviewed');
    expect(d.activities.find((a) => a.type === 'interview_recorded')!.meta).toMatchObject({ interviewId: iv.id, interviewStatus: 'done', recommendation: 'accept' });
    // null clears the scores.
    expect((await director.patch<Interview>(`/api/leads/${lead.id}/interviews/${iv.id}`, { scores: null })).body.scores).toEqual({});
  });

  it('validates scores (known criteria, whole numbers 1–5), the status and the recommended class', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    const url = `/api/leads/${lead.id}/interviews/${iv.id}`;
    const unknown = await director.patch(url, { scores: { voice: 3, juggling: 4 } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.issues[0]).toMatchObject({ path: ['scores', 'juggling'], message: 'admissions:errors.unknownCriterion' });
    for (const v of [0, 6, 3.5, '4', null]) {
      const r = await director.patch(url, { scores: { voice: v } });
      expect(r.status).toBe(400);
      expect(r.body.error.issues[0].path).toEqual(['scores', 'voice']);
    }
    expect((await director.patch(url, { recommendation: 'yes' })).status).toBe(400);
    expect((await director.patch(url, { recommendedLevel: 'expert' })).status).toBe(400);
    expect((await director.patch(url, { status: 'bogus' })).status).toBe(400);
    const notDone = await director.patch(url, { status: 'cancelled', recommendation: 'accept' });
    expect(notDone.status).toBe(400);
    expect(notDone.body.error.issues[0]).toMatchObject({ path: ['status'], message: 'admissions:errors.assessmentNeedsDone' });
    expect((await director.patch(url, { recommendedCourseId: 999 })).body.error.issues[0].message).toBe('admissions:errors.courseNotFound');
    expect((await director.patch(url, { recommendedCourseId: mkCourse(t, { status: 'archived' }).id })).body.error.issues[0].message).toBe(
      'admissions:errors.courseArchived',
    );
    expect((await director.get<LeadDetail>(`/api/leads/${lead.id}`)).body.interviews[0]).toMatchObject({ status: 'scheduled', scores: {} });
  });

  it('criteria follow the settings: a new key is accepted; a removed key is kept where stored but can’t be added elsewhere', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const first = (await schedule(director, lead.id)).body;
    const second = (await schedule(director, lead.id, { scheduledAt: `${addDays(today, 2)}T10:00` })).body;
    await director.patch(`/api/leads/${lead.id}/interviews/${first.id}`, { scores: { presence: 4, voice: 3 } });
    expect(
      (
        await director.patch('/api/settings', {
          interviewCriteria: [
            { key: 'presence', label: 'Presence', labelAr: 'الحضور' },
            { key: 'singing', label: 'Singing', labelAr: 'الغناء' },
          ],
        })
      ).status,
    ).toBe(200);
    const kept = await director.patch<Interview>(`/api/leads/${lead.id}/interviews/${first.id}`, { scores: { presence: 5, voice: 3, singing: 2 } });
    expect(kept.status).toBe(200);
    expect(kept.body.scores).toEqual({ presence: 5, voice: 3, singing: 2 });
    const removed = await director.patch(`/api/leads/${lead.id}/interviews/${second.id}`, { scores: { voice: 3 } });
    expect(removed.status).toBe(400);
    expect(removed.body.error.issues[0].path).toEqual(['scores', 'voice']);
  });

  it('an interview of another lead is a 404', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const a = await mkLead(director);
    const b = await mkLead(director, { phone: '01112223344' });
    const iv = (await schedule(director, a.id)).body;
    expect((await director.patch(`/api/leads/${b.id}/interviews/${iv.id}`, { status: 'cancelled' })).status).toBe(404);
    expect((await director.patch(`/api/leads/${a.id}/interviews/999`, { status: 'cancelled' })).status).toBe(404);
  });
});

// ── Enrol ───────────────────────────────────────────────────────────────────

describe('POST /api/leads/:id/enrol', () => {
  it('creates the student and the enrollment and links the lead — even without students.write / courses.write', async () => {
    const t = await makeTestContext();
    const salma = await t.as({ permissions: ['admissions.read', 'admissions.decide'] });
    const director = await t.as('executive_director');
    const course = mkCourse(t, { capacity: 10 });
    const lead = await mkLead(director, {
      firstName: 'Lina',
      lastName: 'Fares',
      phone: '+20 128 777 1212',
      email: 'lina@example.com',
      dateOfBirth: '2010-10-10',
      gender: 'female',
      city: 'Giza',
      guardianName: 'Rania Fares',
      guardianPhone: '+20 128 777 1200',
      nextFollowUpOn: tomorrow,
    });
    const res = await salma.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id, joinedOn: addDays(today, 3) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ createdStudent: true, studentId: expect.any(Number), enrollmentId: expect.any(Number) });
    expect(res.body.lead).toMatchObject({ status: 'enrolled', studentId: res.body.studentId, nextFollowUpOn: null, student: { id: res.body.studentId, visible: false } });

    const student = t.db.select().from(students).where(eq(students.id, res.body.studentId)).get()!;
    expect(student).toMatchObject({
      firstName: 'Lina',
      lastName: 'Fares',
      phone: '+20 128 777 1212',
      email: 'lina@example.com',
      dateOfBirth: '2010-10-10',
      gender: 'female',
      guardianName: 'Rania Fares',
      guardianPhone: '+20 128 777 1200',
      notes: 'From admissions\nCity: Giza',
      status: 'active',
      mediaConsent: false,
      joinedOn: addDays(today, 3),
      createdBy: salma.user.id,
    });
    expect(t.db.select().from(enrollments).where(eq(enrollments.id, res.body.enrollmentId)).get()).toMatchObject({
      courseId: course.id,
      studentId: student.id,
      status: 'enrolled',
      enrolledOn: addDays(today, 3),
    });
    expect(res.body.lead.activities[0]).toMatchObject({
      type: 'enrolled',
      meta: { courseId: course.id, courseName: 'Screen Acting I', studentId: student.id, linkedExistingStudent: false },
    });
    // The director (students.read + classes.all) may open the student.
    expect((await getLead(director, lead.id)).student).toEqual({ id: student.id, visible: true });
    expect((await director.get(`/api/students/${student.id}`)).status).toBe(200);
  });

  it('defaults joinedOn to today; a lead already enrolled → 409', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    const lead = await mkLead(director);
    const res = await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id });
    expect(t.db.select().from(students).where(eq(students.id, res.body.studentId)).get()!.joinedOn).toBe(today);
    const again = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t, { name: 'Other' }).id, createNew: true });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('lead_enrolled');
    expect(t.db.select().from(students).all()).toHaveLength(1);
  });

  it('a full class → 409 class_full and nothing is created (one transaction)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t, { capacity: 1 });
    t.db.insert(enrollments).values({ courseId: course.id, studentId: mkStudent(t, { phone: '0999' }).id, enrolledOn: today }).run();
    const lead = await mkLead(director);
    const res = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('class_full');
    expect(t.db.select().from(students).all()).toHaveLength(1);
    expect(t.db.select().from(enrollments).all()).toHaveLength(1);
    const d = await getLead(director, lead.id);
    expect(d).toMatchObject({ status: 'new', studentId: null });
    expect(d.activities).toEqual([]);
  });

  it('an archived class → 409 course_archived; an unknown class → 400; validation', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const archived = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t, { status: 'archived' }).id });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('course_archived');
    const missing = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: 999 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues[0]).toMatchObject({ path: ['courseId'], message: 'admissions:errors.courseNotFound' });
    expect((await director.post(`/api/leads/${lead.id}/enrol`, {})).status).toBe(400);
    expect((await director.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id, joinedOn: 'soon' })).status).toBe(400);
    const both = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id, linkStudentId: 1, createNew: true });
    expect(both.status).toBe(400);
    expect(both.body.error.issues[0].message).toBe('admissions:errors.linkOrCreate');
    expect(t.db.select().from(students).all()).toHaveLength(0);
  });

  it('same phone (any format) or email as a student → 409 possible_duplicate with names only; linkStudentId or createNew go ahead', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    const existing = mkStudent(t, { firstName: 'Tariq', lastName: 'Saleh', phone: '+20 122 303 0318', email: 'tariq@example.com', status: 'prospect' });
    const byEmail = mkStudent(t, { firstName: 'Other', lastName: 'Tariq', phone: '0999 999 999', email: 'TS@example.com' });
    const lead = await mkLead(director, { firstName: 'Tariq', lastName: 'Saleh', phone: '01223030318', email: 'ts@example.com' });

    const dup = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('possible_duplicate');
    expect(dup.body.error.details).toEqual({
      matches: [
        { id: existing.id, name: 'Tariq Saleh' },
        { id: byEmail.id, name: 'Other Tariq' },
      ],
    });
    expect(t.db.select().from(enrollments).all()).toHaveLength(0);

    // Link to the existing student: no new student; a prospect becomes active.
    const linked = await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: existing.id });
    expect(linked.status).toBe(201);
    expect(linked.body).toMatchObject({ studentId: existing.id, createdStudent: false });
    expect(linked.body.lead.activities[0].meta).toMatchObject({ studentId: existing.id, linkedExistingStudent: true });
    expect(t.db.select().from(students).all()).toHaveLength(2);
    expect(t.db.select().from(students).where(eq(students.id, existing.id)).get()!.status).toBe('active');

    // createNew: a new student despite the match.
    const twin = await mkLead(director, { firstName: 'Tariq', lastName: 'Saleh', phone: '01223030318' });
    const created = await director.post<EnrolResult>(`/api/leads/${twin.id}/enrol`, { courseId: course.id, createNew: true });
    expect(created.status).toBe(201);
    expect(created.body.createdStudent).toBe(true);
    expect(t.db.select().from(students).all()).toHaveLength(3);
  });

  it('linkStudentId must exist; linking a student already in the class links the lead to that enrollment (nothing new created)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    const existing = mkStudent(t, { phone: '01007654321' });
    const enrollment = t.db.insert(enrollments).values({ courseId: course.id, studentId: existing.id, enrolledOn: addDays(today, -7) }).returning().get()!;
    const lead = await mkLead(director);
    const missing = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: 999 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues[0]).toMatchObject({ path: ['linkStudentId'], message: 'admissions:errors.studentNotFound' });
    expect(statusOf(t, lead.id)).toBe('new');
    const res = await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: existing.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ studentId: existing.id, enrollmentId: enrollment.id, createdStudent: false, lead: { status: 'enrolled', studentId: existing.id } });
    expect(t.db.select().from(enrollments).all()).toEqual([enrollment]);
    expect(t.db.select().from(students).all()).toHaveLength(1);
  });
});

// ── Duplicates / class options ──────────────────────────────────────────────

describe('GET /api/leads/duplicates', () => {
  it('matches open leads and students by phone digits or email; names only, never a student’s contacts', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const openLead = await mkLead(director, { firstName: 'Open', lastName: 'Lead', phone: '+20 101 234 5678' });
    await mkLead(director, { firstName: 'Closed', lastName: 'Lead', phone: '01012345678', status: 'lost', lostReason: 'other' });
    const student = mkStudent(t, { firstName: 'Stu', lastName: 'Dent', phone: '010-1234-5678', email: 'stu@example.com', guardianPhone: '+20 100 000 0000' });
    const mailLead = await mkLead(director, { firstName: 'Mail', lastName: 'Match', phone: '0111 000 0000', email: 'stu@example.com' });

    const res = await director.get('/api/leads/duplicates?phone=010 1234 5678');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { kind: 'lead', id: openLead.id, name: 'Open Lead', status: 'new' },
      { kind: 'student', id: student.id, name: 'Stu Dent' },
    ]);
    for (const item of res.body.items) expect(Object.keys(item).sort()).toEqual(item.kind === 'lead' ? ['id', 'kind', 'name', 'status'] : ['id', 'kind', 'name']);

    const byMail = await director.get(`/api/leads/duplicates?email=STU@example.com&excludeLeadId=${mailLead.id}`);
    expect(byMail.body.items).toEqual([{ kind: 'student', id: student.id, name: 'Stu Dent' }]);
    expect((await director.get(`/api/leads/duplicates?phone=%2B201012345678&excludeLeadId=${openLead.id}`)).body.items).toEqual([
      { kind: 'student', id: student.id, name: 'Stu Dent' },
    ]);
    expect((await director.get('/api/leads/duplicates')).body.items).toEqual([]);
    expect((await director.get('/api/leads/duplicates?phone=12')).body.items).toEqual([]);
    // A reader without students.read still only gets names.
    const reader = await t.as({ permissions: ['admissions.read'] });
    expect((await reader.get('/api/leads/duplicates?phone=01012345678')).body.items).toHaveLength(2);
  });
});

describe('GET /api/leads/course-options', () => {
  it('active classes that haven’t ended, with coach, schedule and free places — no courses.read needed', async () => {
    const t = await makeTestContext();
    const reader = await t.as({ permissions: ['admissions.read'] });
    const coach = await t.createUser('acting_coach', { name: 'Moaty' });
    const open = mkCourse(t, { name: 'B Improv', capacity: 2, teacherId: coach.id, level: 'all_levels' });
    const unlimited = mkCourse(t, { name: 'A Voice' });
    mkCourse(t, { name: 'Archived', status: 'archived' });
    mkCourse(t, { name: 'Ended', startDate: addDays(today, -90), endDate: addDays(today, -1) });
    t.db.insert(enrollments).values({ courseId: open.id, studentId: mkStudent(t).id, enrolledOn: today }).run();
    const res = await reader.get<{ items: AdmissionsCourseOption[] }>('/api/leads/course-options');
    expect(res.status).toBe(200);
    expect(res.body.items.map((c) => c.id)).toEqual([unlimited.id, open.id]);
    expect(res.body.items[1]).toMatchObject({ name: 'B Improv', teacherId: coach.id, teacherName: 'Moaty', level: 'all_levels', capacity: 2, enrolledCount: 1, freePlaces: 1, schedule: [] });
    expect(res.body.items[0]).toMatchObject({ capacity: null, freePlaces: null });
    expect((await reader.get('/api/courses')).status).toBe(403);
  });
});

// ── Schedule and dashboard ──────────────────────────────────────────────────

describe('interviews on the schedule', () => {
  it('a third event kind for admissions.read holders only; cancelled ones left out', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director', { name: 'Salma' });
    const lead = await mkLead(director, { firstName: 'Sara', lastName: 'Nabil' });
    const iv = (await schedule(director, lead.id, { scheduledAt: `${tomorrow}T23:45`, durationMinutes: 30, room: 'Room 3', interviewerId: director.user.id })).body;
    const cancelled = (await schedule(director, lead.id, { scheduledAt: `${tomorrow}T10:00` })).body;
    await director.patch(`/api/leads/${lead.id}/interviews/${cancelled.id}`, { status: 'cancelled' });

    const range = `/api/schedule?from=${today}&to=${addDays(today, 6)}`;
    const items = (await director.get<{ items: ScheduleEvent[] }>(range)).body.items.filter((e) => e.kind === 'interview');
    expect(items).toEqual([
      {
        kind: 'interview',
        id: iv.id,
        leadId: lead.id,
        title: 'Sara Nabil',
        date: tomorrow,
        startTime: '23:45',
        endTime: '23:59',
        durationMinutes: 30,
        room: 'Room 3',
        interviewerId: director.user.id,
        interviewerName: 'Salma',
        status: 'scheduled',
      },
    ]);
    const reader = await t.as({ permissions: ['admissions.read'] });
    expect((await reader.get<{ items: ScheduleEvent[] }>(range)).body.items.map((e) => e.kind)).toEqual(['interview']);
    for (const role of ['acting_coach', 'head_of_casting', 'finance'] as const) {
      const events = (await (await t.as(role)).get<{ items: ScheduleEvent[] }>(range)).body.items;
      expect(events.some((e) => e.kind === 'interview')).toBe(false);
    }
  });
});

describe('admissions on the dashboard', () => {
  it('open and new-this-week counts, follow-ups due (most overdue first, capped, closed leads never), upcoming interviews', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const d3 = await mkLead(director, { firstName: 'Three', nextFollowUpOn: addDays(today, -3) });
    const d0 = await mkLead(director, { firstName: 'Today', nextFollowUpOn: today, phone: '01000000001' });
    const d1 = await mkLead(director, { firstName: 'One', nextFollowUpOn: addDays(today, -1), phone: '01000000002' });
    await mkLead(director, { firstName: 'Later', nextFollowUpOn: tomorrow, phone: '01000000003' });
    await mkLead(director, { firstName: 'Lost', status: 'lost', lostReason: 'other', phone: '01000000004' });
    const old = await mkLead(director, { firstName: 'Old', phone: '01000000005' });
    t.db.update(leads).set({ createdAt: Date.now() - 30 * 86_400_000 }).where(eq(leads.id, old.id)).run();
    for (let i = 0; i < 11; i++) await mkLead(director, { firstName: `Bulk${i}`, phone: `0120000${String(i).padStart(4, '0')}`, nextFollowUpOn: addDays(today, -10) });

    const soon = (await schedule(director, d0.id, { scheduledAt: `${today}T09:00` })).body;
    await schedule(director, d1.id, { scheduledAt: `${addDays(today, 8)}T09:00` });
    const doneIv = (await schedule(director, d3.id, { scheduledAt: `${tomorrow}T09:00` })).body;
    await director.patch(`/api/leads/${d3.id}/interviews/${doneIv.id}`, { status: 'done' });

    const body = (await director.get<DashboardData>('/api/dashboard')).body;
    expect(body.counts.openLeads).toBe(16);
    expect(body.counts.newLeadsThisWeek).toBe(16);
    expect(body.followUpsDueCount).toBe(14);
    expect(body.followUpsDue).toHaveLength(10);
    expect(body.followUpsDue!.slice(0, 10).every((l) => l.nextFollowUpOn === addDays(today, -10))).toBe(true);
    expect(body.upcomingInterviews!.map((e) => e.id)).toEqual([soon.id]);

    // Without the cap in the way: most overdue first, due today last.
    t.db.delete(leads).where(eq(leads.nextFollowUpOn, addDays(today, -10))).run();
    const again = (await director.get<DashboardData>('/api/dashboard')).body;
    expect(again.followUpsDue!.map((l) => l.id)).toEqual([d3.id, d1.id, d0.id]);
    expect(again.followUpsDueCount).toBe(3);
  });

  it('left out entirely for positions without admissions.read', async () => {
    const t = await makeTestContext();
    for (const role of ['acting_coach', 'head_of_casting', 'casting_team', 'video_editor', 'finance'] as const) {
      const body = (await (await t.as(role)).get<DashboardData>('/api/dashboard')).body;
      for (const key of ['followUpsDue', 'followUpsDueCount', 'upcomingInterviews']) expect(key in body).toBe(false);
      expect('openLeads' in body.counts).toBe(false);
      expect('newLeadsThisWeek' in body.counts).toBe(false);
    }
    const reader = await t.as({ permissions: ['admissions.read'] });
    const body = (await reader.get<DashboardData>('/api/dashboard')).body;
    expect(body).toMatchObject({ counts: { openLeads: 0, newLeadsThisWeek: 0 }, followUpsDue: [], followUpsDueCount: 0, upcomingInterviews: [] });
  });
});

// ── Review regressions ──────────────────────────────────────────────────────

/**
 * A request whose JSON body arrives later (a slow phone upload): the handler
 * starts as soon as the headers are in. `send` delivers the body.
 */
function slowRequest(client: Client, method: string, url: string) {
  let send!: (body: unknown) => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (body) => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      };
    },
  });
  const res = client.raw(url, {
    method,
    headers: { 'x-requested-with': 'fetch', cookie: client.cookie!, 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  return { send: (body: unknown) => send(body), res };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('enrol: linkStudentId is limited to the possible_duplicate matches', () => {
  it('an existing student who shares nothing with the lead answers like a missing id; nothing changes', async () => {
    const t = await makeTestContext();
    const decider = await t.as({ permissions: ['admissions.read', 'admissions.write', 'admissions.decide'] });
    const course = mkCourse(t);
    const unrelated = mkStudent(t, { firstName: 'Unrelated', lastName: 'Alumna', phone: '0111 111 1111', email: 'alumna@example.com', status: 'alumni' });
    expect((await decider.get(`/api/students/${unrelated.id}`)).status).toBe(403);
    const lead = await mkLead(decider);

    const res = await decider.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: unrelated.id });
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toEqual([expect.objectContaining({ path: ['linkStudentId'], message: 'admissions:errors.studentNotFound' })]);
    const missing = await decider.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: 99999 });
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual(res.body);

    expect(t.db.select().from(students).where(eq(students.id, unrelated.id)).get()!.status).toBe('alumni');
    expect(t.db.select().from(enrollments).all()).toEqual([]);
    expect(await getLead(decider, lead.id)).toMatchObject({ status: 'new', studentId: null, activities: [] });
  });
});

describe('phone matching: Arabic-Indic digits, invisible marks, international search, trunk 0 after the country code', () => {
  it('phones typed with Arabic digits or pasted with bidi marks are stored with Western digits', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { phone: '٠١٠١٢٣٤٥٦٧٨', guardianPhone: '\u202A+20 101 234 5600\u202C' });
    expect(lead).toMatchObject({ phone: '01012345678', guardianPhone: '+20 101 234 5600' });
    const student = await director.post('/api/students', { firstName: 'Mona', lastName: 'Adel', phone: '\u200E٠١٠ ١٢٣ ٤٥٦٧٨', guardianPhone: '۰۱۰۱۲۳۴۵۶۰۰' });
    expect(student.status).toBe(201);
    expect(student.body).toMatchObject({ phone: '010 123 45678', guardianPhone: '01012345600' });
  });

  it('a student stored with Arabic digits is a duplicate (warning and enrol 409); stored marks and Arabic digits are searchable', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    // Rows saved before phones were normalised.
    const mona = mkStudent(t, { firstName: 'Mona', lastName: 'Adel', phone: '٠١٠١٢٣٤٥٦٧٨' });
    expect((await director.get('/api/leads/duplicates?phone=01012345678')).body.items).toEqual([{ kind: 'student', id: mona.id, name: 'Mona Adel' }]);
    const lead = await mkLead(director, { firstName: 'Mona', lastName: 'Adel', phone: '+20 101 234 5678' });
    const enrol = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id });
    expect(enrol.status).toBe(409);
    expect(enrol.body.error.code).toBe('possible_duplicate');
    expect(t.db.select().from(students).all()).toHaveLength(1);

    const marked = t.db.insert(leads).values({ firstName: 'Bidi', lastName: 'Marks', phone: '\u202A+20 122 555 6677\u202C', source: 'whatsapp' }).returning().get()!;
    const arabic = t.db.insert(leads).values({ firstName: 'Arabic', lastName: 'Digits', phone: '٠١١٢٢٢٣٣٣٤٤', source: 'whatsapp' }).returning().get()!;
    expect((await director.get('/api/leads/duplicates?phone=01225556677')).body.items).toEqual([{ kind: 'lead', id: marked.id, name: 'Bidi Marks', status: 'new' }]);
    const ids = async (q: string) => (await director.get<{ items: LeadListItem[] }>(`/api/leads?q=${encodeURIComponent(q)}`)).body.items.map((i) => i.id);
    expect(await ids('01122233344')).toEqual([arabic.id]);
    expect(await ids('٠١١٢٢٢٣٣٣٤٤')).toEqual([arabic.id]);
    expect(await ids('0122 555 6677')).toEqual([marked.id]);
  });

  it('the list search finds a locally stored number from its international form', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { phone: '0100 765 4321' });
    await mkLead(director, { firstName: 'Other', phone: '0122 000 1111' });
    for (const q of ['+20 100 765 4321', '00201007654321', '201007654321', '+20 100 765', '01007654321', '1007654321']) {
      const res = await director.get<{ items: LeadListItem[] }>(`/api/leads?q=${encodeURIComponent(q)}`);
      expect(res.body.items.map((i) => i.id), q).toEqual([lead.id]);
    }
  });

  it('"+20 (0) 100…" is the same number as "0100…" (enrol answers possible_duplicate)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const student = mkStudent(t, { phone: '01007654321' });
    const lead = await mkLead(director, { phone: '+20 (0) 100 765 4321' });
    const res = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ matches: [{ id: student.id, name: 'Existing Student' }] });
  });
});

describe('a later interview never undoes an assessment or a decision', () => {
  it('no-show / cancellation of a second interview → back to interviewed when one is done', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const first = (await schedule(director, lead.id)).body;
    await director.patch(`/api/leads/${lead.id}/interviews/${first.id}`, { status: 'done', scores: SCORES, recommendation: 'maybe' });
    expect(statusOf(t, lead.id)).toBe('interviewed');
    const second = (await schedule(director, lead.id, { scheduledAt: `${addDays(today, 3)}T12:00` })).body;
    expect(statusOf(t, lead.id)).toBe('interview_scheduled');
    expect((await director.patch(`/api/leads/${lead.id}/interviews/${second.id}`, { status: 'no_show' })).status).toBe(200);
    expect(statusOf(t, lead.id)).toBe('interviewed');
    expect((await director.get<{ items: LeadListItem[] }>('/api/leads?group=interviews')).body.items.map((i) => i.id)).toEqual([lead.id]);

    const third = (await schedule(director, lead.id, { scheduledAt: `${addDays(today, 4)}T12:00` })).body;
    await director.patch(`/api/leads/${lead.id}/interviews/${third.id}`, { status: 'cancelled' });
    expect(statusOf(t, lead.id)).toBe('interviewed');
    expect(statusChanges(await getLead(director, lead.id))).toEqual([
      'new>interview_scheduled',
      'interview_scheduled>interviewed',
      'interviewed>interview_scheduled',
      'interview_scheduled>interviewed',
      'interviewed>interview_scheduled',
      'interview_scheduled>interviewed',
    ]);
  });

  it('an accepted lead stays accepted when another interview is scheduled, cancelled or missed', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const desk = await t.as({ permissions: ['admissions.read', 'admissions.write'] });
    const lead = await mkLead(director, { status: 'accepted' });
    const iv = (await schedule(desk, lead.id)).body;
    expect(statusOf(t, lead.id)).toBe('accepted');
    expect((await desk.patch(`/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'cancelled' })).status).toBe(200);
    expect(statusOf(t, lead.id)).toBe('accepted');
    const again = (await schedule(desk, lead.id)).body;
    await desk.patch(`/api/leads/${lead.id}/interviews/${again.id}`, { status: 'no_show' });
    expect(statusOf(t, lead.id)).toBe('accepted');
    expect(statusChanges(await getLead(director, lead.id))).toEqual([]);
  });
});

describe('enrol: linking a student who is or was in the class', () => {
  it('previously enrolled (withdrawn) → re-enrolled in the same enrollment; the lead is linked', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    const student = mkStudent(t, { phone: '01112223334', status: 'alumni' });
    const old = t.db.insert(enrollments).values({ courseId: course.id, studentId: student.id, enrolledOn: addDays(today, -200), status: 'withdrawn' }).returning().get()!;
    const lead = await mkLead(director, { phone: '01112223334', status: 'accepted' });

    const res = await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: student.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ studentId: student.id, enrollmentId: old.id, createdStudent: false, lead: { status: 'enrolled', studentId: student.id } });
    expect(t.db.select().from(enrollments).all()).toEqual([expect.objectContaining({ id: old.id, status: 'enrolled' })]);
    expect(t.db.select().from(students).where(eq(students.id, student.id)).get()!.status).toBe('active');
  });

  it('re-enrolling still respects capacity: a full class → 409 class_full, nothing changes', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t, { capacity: 1 });
    t.db.insert(enrollments).values({ courseId: course.id, studentId: mkStudent(t, { phone: '0999 000 000' }).id, enrolledOn: today }).run();
    const student = mkStudent(t, { phone: '01112223334', status: 'alumni' });
    t.db.insert(enrollments).values({ courseId: course.id, studentId: student.id, enrolledOn: addDays(today, -200), status: 'completed' }).run();
    const lead = await mkLead(director, { phone: '01112223334' });
    const res = await director.post(`/api/leads/${lead.id}/enrol`, { courseId: course.id, linkStudentId: student.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('class_full');
    expect(t.db.select().from(enrollments).where(eq(enrollments.studentId, student.id)).get()!.status).toBe('completed');
    expect(t.db.select().from(students).where(eq(students.id, student.id)).get()!.status).toBe('alumni');
    expect(statusOf(t, lead.id)).toBe('new');
  });
});

describe('admissions.decide without admissions.write', () => {
  it('may accept, decline and record assessments — but not edit, reschedule or cancel', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const salma = await t.as({ permissions: ['admissions.read', 'admissions.decide'] });
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    const ivUrl = `/api/leads/${lead.id}/interviews/${iv.id}`;

    expect((await salma.patch(ivUrl, { room: 'Studio B' })).status).toBe(403);
    expect((await salma.patch(ivUrl, { scheduledAt: `${addDays(today, 2)}T10:00` })).status).toBe(403);
    expect((await salma.patch(ivUrl, { status: 'cancelled' })).status).toBe(403);
    expect((await salma.patch(ivUrl, { status: 'no_show' })).status).toBe(403);
    const recorded = await salma.patch<Interview>(ivUrl, {
      status: 'done',
      scores: { voice: 4 },
      strengths: 'Voice',
      notes: 'Calm',
      recommendation: 'accept',
      // The whole interview form may come back unchanged.
      scheduledAt: `${tomorrow}T17:00`,
      room: null,
    });
    expect(recorded.status).toBe(200);
    expect(recorded.body).toMatchObject({ status: 'done', scores: { voice: 4 }, notes: 'Calm', recommendation: 'accept', recordedById: salma.user.id });
    expect((await salma.patch(ivUrl, { recommendation: 'maybe', notes: 'Second look' })).status).toBe(200);
    expect(statusOf(t, lead.id)).toBe('interviewed');

    expect((await salma.patch(`/api/leads/${lead.id}`, { notes: 'x' })).status).toBe(403);
    expect((await salma.patch(`/api/leads/${lead.id}`, { status: 'contacted' })).status).toBe(403);
    expect((await salma.patch(`/api/leads/${lead.id}`, { status: 'accepted', nextFollowUpOn: tomorrow })).status).toBe(403);
    expect((await salma.patch<LeadDetail>(`/api/leads/${lead.id}`, { status: 'accepted' })).body.status).toBe('accepted');
    expect((await salma.patch<LeadDetail>(`/api/leads/${lead.id}`, { status: 'declined' })).body.status).toBe('declined');
    expect((await salma.post(`/api/leads/${lead.id}/activities`, { type: 'call' })).status).toBe(403);
    expect((await schedule(salma, lead.id)).status).toBe(403);
  });
});

describe('duplicates while editing an enrolled lead', () => {
  it('excludeLeadId also leaves out the student made from that lead', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { firstName: 'Lina', lastName: 'Fares', phone: '+20 128 777 1212', email: 'lina@example.com' });
    const enrol = (await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: mkCourse(t).id })).body;
    const qs = `phone=${encodeURIComponent('+20 128 777 1212')}&email=lina%40example.com`;
    expect((await director.get(`/api/leads/duplicates?${qs}&excludeLeadId=${lead.id}`)).body.items).toEqual([]);
    // Another enquiry with the same number still sees that student.
    expect((await director.get(`/api/leads/duplicates?${qs}`)).body.items).toEqual([{ kind: 'student', id: enrol.studentId, name: 'Lina Fares' }]);
  });
});

describe('a slow request body never writes back a stale status', () => {
  async function enrolledDuring(t: Ctx, director: Client, leadId: number, method: string, url: string, payload: unknown) {
    const slow = slowRequest(director, method, url);
    await tick();
    const enrol = await director.post(`/api/leads/${leadId}/enrol`, { courseId: mkCourse(t).id, createNew: true });
    expect(enrol.status).toBe(201);
    slow.send(payload);
    return (await slow.res).status;
  }

  it('PATCH /:id (no status in the body) keeps the lead enrolled', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { status: 'accepted' });
    expect(await enrolledDuring(t, director, lead.id, 'PATCH', `/api/leads/${lead.id}`, { notes: 'typo fixed' })).toBe(200);
    expect(await getLead(director, lead.id)).toMatchObject({ status: 'enrolled', notes: 'typo fixed', studentId: expect.any(Number) });
  });

  it('POST /:id/activities keeps the lead enrolled', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director, { status: 'accepted' });
    expect(await enrolledDuring(t, director, lead.id, 'POST', `/api/leads/${lead.id}/activities`, { type: 'call', body: 'Called' })).toBe(201);
    expect(statusOf(t, lead.id)).toBe('enrolled');
  });

  it('PATCH an interview (no-show) keeps the lead enrolled', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    const iv = (await schedule(director, lead.id)).body;
    await enrolledDuring(t, director, lead.id, 'PATCH', `/api/leads/${lead.id}/interviews/${iv.id}`, { status: 'no_show' });
    expect(statusOf(t, lead.id)).toBe('enrolled');
  });

  it('POST /:id/interviews on a lead enrolled meanwhile → 409 lead_enrolled, nothing scheduled', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const lead = await mkLead(director);
    expect(await enrolledDuring(t, director, lead.id, 'POST', `/api/leads/${lead.id}/interviews`, { scheduledAt: `${tomorrow}T17:00` })).toBe(409);
    expect(statusOf(t, lead.id)).toBe('enrolled');
    expect(t.db.select().from(interviews).all()).toEqual([]);
  });
});

describe('deleting the student an enrolled lead points to', () => {
  it('moves the lead back to accepted (on the timeline), so it can be enrolled or linked again', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const course = mkCourse(t);
    const lead = await mkLead(director, { status: 'accepted' });
    const first = (await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id })).body;
    expect((await director.delete(`/api/students/${first.studentId}`)).status).toBe(204);

    const d = await getLead(director, lead.id);
    expect(d).toMatchObject({ status: 'accepted', studentId: null, student: null });
    expect(d.activities[0]).toMatchObject({ type: 'status_change', meta: { from: 'enrolled', to: 'accepted' }, createdById: director.user.id });
    const again = await director.post<EnrolResult>(`/api/leads/${lead.id}/enrol`, { courseId: course.id });
    expect(again.status).toBe(201);
    expect(again.body.lead.status).toBe('enrolled');
  });
});
