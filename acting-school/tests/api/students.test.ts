import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { todayISO } from '../../src/shared/dates';
import type { Student, StudentDetail, StudentListItem } from '../../src/shared/schemas/students';
import { attendance, classSessions, courses, enrollments, students, talent } from '../../src/server/db/schema';
import { makeTestContext, uploadPng } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const STUDENT_KEYS = [
  'id',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'status',
  'joinedOn',
  'guardianName',
  'guardianPhone',
  'guardianEmail',
  'emergencyName',
  'emergencyPhone',
  'photoFileId',
  'mediaConsent',
  'notes',
  'createdAt',
  'updatedAt',
].sort();

const LIST_KEYS = ['id', 'firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'status', 'photoFileId', 'activeEnrollments'].sort();

function insertCourse(t: Ctx, name: string, color: (typeof courses.$inferInsert)['color'] = 'emerald') {
  return t.db.insert(courses).values({ name, startDate: '2026-01-05', endDate: '2026-06-30', color }).returning().get()!;
}

function insertSession(t: Ctx, courseId: number, date: string) {
  return t.db.insert(classSessions).values({ courseId, date, startTime: '18:00', endTime: '20:00' }).returning().get()!;
}

async function seedPeople(t: Ctx) {
  const admin = await t.as('admin');
  const mk = async (body: Record<string, unknown>) => {
    const res = await admin.post<Student>('/api/students', body);
    expect(res.status).toBe(201);
    return res.body;
  };
  const layla = await mk({ firstName: 'Layla', lastName: 'Haddad', email: 'layla@example.com', phone: '+971 50 123 4567' });
  const omar = await mk({ firstName: 'Omar', lastName: 'Aziz', email: 'omar.aziz@example.com', status: 'prospect' });
  const zoe = await mk({ firstName: 'zoe', lastName: 'baker', phone: '020 7946 0000', status: 'paused' });
  const adam = await mk({ firstName: 'Adam', lastName: 'Aziz', status: 'alumni' });
  return { admin, layla, omar, zoe, adam };
}

describe('POST /api/students', () => {
  it('creates a student with defaults and answers the full Student shape', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.post<Student>('/api/students', { firstName: '  Layla ', lastName: 'Haddad', email: 'Layla@Example.COM' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(STUDENT_KEYS);
    expect(res.body).toMatchObject({
      firstName: 'Layla',
      lastName: 'Haddad',
      email: 'layla@example.com',
      status: 'active',
      joinedOn: todayISO(),
      mediaConsent: false,
      phone: null,
      photoFileId: null,
      notes: null,
    });
    expect(typeof res.body.id).toBe('number');
    expect(typeof res.body.createdAt).toBe('number');
  });

  it('stores every field, turning blank strings into null', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const photo = await uploadPng(owner);
    const res = await owner.post<Student>('/api/students', {
      firstName: 'Sami',
      lastName: 'Nasser',
      email: '',
      phone: '050 111 2222',
      dateOfBirth: '2010-04-12',
      gender: 'male',
      status: 'prospect',
      joinedOn: '2026-02-01',
      guardianName: 'Rana Nasser',
      guardianPhone: '050 999 8888',
      guardianEmail: 'rana@example.com',
      emergencyName: '',
      emergencyPhone: '050 777 6666',
      photoFileId: photo,
      mediaConsent: true,
      notes: 'Line one\nLine two',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: null,
      phone: '050 111 2222',
      dateOfBirth: '2010-04-12',
      gender: 'male',
      status: 'prospect',
      joinedOn: '2026-02-01',
      guardianName: 'Rana Nasser',
      guardianEmail: 'rana@example.com',
      emergencyName: null,
      emergencyPhone: '050 777 6666',
      photoFileId: photo,
      mediaConsent: true,
      notes: 'Line one\nLine two',
    });
  });

  it('validates input', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.post('/api/students', {
      firstName: '',
      email: 'not-an-email',
      dateOfBirth: '2026-02-30',
      gender: 'robot',
      status: 'expelled',
      mediaConsent: 'yes',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    const paths = res.body.error.issues.map((i: { path: string[] }) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'dateOfBirth', 'gender', 'status', 'mediaConsent']));
  });

  it('rejects a non-JSON body', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.raw('/api/students', {
      method: 'POST',
      headers: { cookie: admin.cookie!, 'x-requested-with': 'fetch', 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('accepts an uploaded photo and rejects an unknown file id on photoFileId', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const good = await uploadPng(admin);
    const ok = await admin.post('/api/students', { firstName: 'A', lastName: 'B', photoFileId: good });
    expect(ok.status).toBe(201);
    expect(ok.body.photoFileId).toBe(good);

    const missing = await admin.post('/api/students', { firstName: 'A', lastName: 'B', photoFileId: '0b7f1a7e-8f1e-4c1b-9f3e-2a2b3c4d5e6f' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('validation');
    expect(missing.body.error.issues).toEqual([expect.objectContaining({ path: ['photoFileId'], message: 'students:errors.photoNotFound' })]);

    const malformed = await admin.post('/api/students', { firstName: 'A', lastName: 'B', photoFileId: 'nope' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.issues[0].path).toEqual(['photoFileId']);
    expect(t.db.select().from(students).all()).toHaveLength(1);
  });
});

describe('GET /api/students', () => {
  it('lists students sorted by last name then first name, case-insensitively', async () => {
    const t = await makeTestContext();
    const { admin } = await seedPeople(t);
    const res = await admin.get<{ items: StudentListItem[] }>('/api/students');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s) => `${s.firstName} ${s.lastName}`)).toEqual(['Adam Aziz', 'Omar Aziz', 'zoe baker', 'Layla Haddad']);
    expect(Object.keys(res.body.items[0]!).sort()).toEqual(LIST_KEYS);
  });

  it('searches first name, last name, "first last", email and phone, case-insensitively', async () => {
    const t = await makeTestContext();
    const { admin } = await seedPeople(t);
    const names = async (q: string) =>
      (await admin.get<{ items: StudentListItem[] }>(`/api/students?q=${encodeURIComponent(q)}`)).body.items.map((s) => s.firstName);

    expect(await names('layla')).toEqual(['Layla']);
    expect(await names('AZIZ')).toEqual(['Adam', 'Omar']);
    expect(await names('omar aziz')).toEqual(['Omar']);
    expect(await names('  Omar   Aziz ')).toEqual(['Omar']);
    expect(await names('aziz omar')).toEqual(['Omar']);
    expect(await names('omar.aziz@')).toEqual(['Omar']);
    expect(await names('EXAMPLE.COM')).toEqual(['Omar', 'Layla']);
    expect(await names('+971 50')).toEqual(['Layla']);
    // Phone digits match regardless of spacing.
    expect(await names('501234567')).toEqual(['Layla']);
    expect(await names('7946')).toEqual(['zoe']);
    expect(await names('nobody')).toEqual([]);
  });

  it('treats LIKE wildcards in the search literally', async () => {
    const t = await makeTestContext();
    const { admin } = await seedPeople(t);
    expect((await admin.get('/api/students?q=%25')).body.items).toEqual([]);
    expect((await admin.get('/api/students?q=_')).body.items).toEqual([]);
  });

  it('filters by status, combined with search', async () => {
    const t = await makeTestContext();
    const { admin } = await seedPeople(t);
    const byStatus = await admin.get<{ items: StudentListItem[] }>('/api/students?status=prospect');
    expect(byStatus.body.items.map((s) => s.firstName)).toEqual(['Omar']);
    const both = await admin.get<{ items: StudentListItem[] }>('/api/students?status=alumni&q=aziz');
    expect(both.body.items.map((s) => s.firstName)).toEqual(['Adam']);
    // Blank filters are ignored.
    expect((await admin.get('/api/students?status=&q=')).body.items).toHaveLength(4);
  });

  it('rejects an unknown status filter', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.get('/api/students?status=expelled');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it('counts only enrollments with status "enrolled"', async () => {
    const t = await makeTestContext();
    const { admin, layla, omar } = await seedPeople(t);
    const a = insertCourse(t, 'Acting I');
    const b = insertCourse(t, 'Voice');
    const c = insertCourse(t, 'Improv');
    t.db
      .insert(enrollments)
      .values([
        { courseId: a.id, studentId: layla.id, status: 'enrolled', enrolledOn: '2026-01-05' },
        { courseId: b.id, studentId: layla.id, status: 'enrolled', enrolledOn: '2026-01-06' },
        { courseId: c.id, studentId: layla.id, status: 'withdrawn', enrolledOn: '2026-01-07' },
        { courseId: a.id, studentId: omar.id, status: 'completed', enrolledOn: '2026-01-05' },
      ])
      .run();
    const res = await admin.get<{ items: StudentListItem[] }>('/api/students');
    const byName = Object.fromEntries(res.body.items.map((s) => [s.firstName, s.activeEnrollments]));
    expect(byName).toEqual({ Layla: 2, Omar: 0, zoe: 0, Adam: 0 });
  });
});

describe('GET /api/students/:id', () => {
  it('returns the student with enrollments, attendance totals and talent link', async () => {
    const t = await makeTestContext();
    const { admin, layla } = await seedPeople(t);
    const acting = insertCourse(t, 'Acting I', 'crimson');
    const voice = insertCourse(t, 'Voice', null);
    const improv = insertCourse(t, 'Improv', 'sky');
    t.db
      .insert(enrollments)
      .values([
        { courseId: acting.id, studentId: layla.id, status: 'enrolled', enrolledOn: '2026-01-05' },
        { courseId: voice.id, studentId: layla.id, status: 'completed', enrolledOn: '2025-09-01' },
        { courseId: improv.id, studentId: layla.id, status: 'withdrawn', enrolledOn: '2026-02-10' },
      ])
      .run();
    const marks = ['present', 'present', 'present', 'late', 'absent', 'excused'] as const;
    marks.forEach((status, i) => {
      const s = insertSession(t, acting.id, `2026-01-${String(10 + i).padStart(2, '0')}`);
      t.db.insert(attendance).values({ sessionId: s.id, studentId: layla.id, status }).run();
    });
    const tal = t.db.insert(talent).values({ studentId: layla.id, firstName: 'Layla', lastName: 'Haddad' }).returning().get()!;

    const res = await admin.get<StudentDetail>(`/api/students/${layla.id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...STUDENT_KEYS, 'enrollments', 'attendance', 'talentId'].sort());
    expect(res.body).toMatchObject({ id: layla.id, firstName: 'Layla', talentId: tal.id });
    expect(res.body.enrollments).toEqual([
      { id: expect.any(Number), courseId: improv.id, courseName: 'Improv', courseColor: 'sky', status: 'withdrawn', enrolledOn: '2026-02-10' },
      { id: expect.any(Number), courseId: acting.id, courseName: 'Acting I', courseColor: 'crimson', status: 'enrolled', enrolledOn: '2026-01-05' },
      { id: expect.any(Number), courseId: voice.id, courseName: 'Voice', courseColor: null, status: 'completed', enrolledOn: '2025-09-01' },
    ]);
    expect(res.body.attendance).toEqual({ present: 3, late: 1, absent: 1, excused: 1, total: 6 });
  });

  it('answers empty aggregates for a brand-new student', async () => {
    const t = await makeTestContext();
    const { admin, omar } = await seedPeople(t);
    const res = await admin.get<StudentDetail>(`/api/students/${omar.id}`);
    expect(res.status).toBe(200);
    expect(res.body.enrollments).toEqual([]);
    expect(res.body.attendance).toEqual({ present: 0, late: 0, absent: 0, excused: 0, total: 0 });
    expect(res.body.talentId).toBeNull();
  });

  it('does not count other students’ attendance', async () => {
    const t = await makeTestContext();
    const { admin, layla, omar } = await seedPeople(t);
    const course = insertCourse(t, 'Acting I');
    const s = insertSession(t, course.id, '2026-01-12');
    t.db.insert(attendance).values({ sessionId: s.id, studentId: omar.id, status: 'present' }).run();
    const res = await admin.get<StudentDetail>(`/api/students/${layla.id}`);
    expect(res.body.attendance.total).toBe(0);
  });

  it('404s an unknown or malformed id', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    expect((await admin.get('/api/students/9999')).status).toBe(404);
    expect((await admin.get('/api/students/abc')).status).toBe(404);
    expect((await admin.get('/api/students/0')).status).toBe(404);
  });
});

describe('PATCH /api/students/:id', () => {
  it('updates only the fields sent', async () => {
    const t = await makeTestContext();
    const { admin, layla } = await seedPeople(t);
    const res = await admin.patch<Student>(`/api/students/${layla.id}`, { status: 'paused', mediaConsent: true, notes: 'Back in spring' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(STUDENT_KEYS);
    expect(res.body).toMatchObject({
      status: 'paused',
      mediaConsent: true,
      notes: 'Back in spring',
      firstName: 'Layla',
      email: 'layla@example.com',
      phone: '+971 50 123 4567',
    });
  });

  it('clears optional fields sent blank', async () => {
    const t = await makeTestContext();
    const { admin, layla } = await seedPeople(t);
    const res = await admin.patch<Student>(`/api/students/${layla.id}`, { email: '', phone: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: null, phone: null, firstName: 'Layla' });
  });

  it('answers the unchanged student for an empty patch', async () => {
    const t = await makeTestContext();
    const { admin, layla } = await seedPeople(t);
    const res = await admin.patch<Student>(`/api/students/${layla.id}`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: layla.id, firstName: 'Layla', status: 'active' });
  });

  it('validates input, including required names that are sent', async () => {
    const t = await makeTestContext();
    const { admin, layla } = await seedPeople(t);
    const res = await admin.patch(`/api/students/${layla.id}`, { firstName: ' ', status: null, guardianEmail: 'nope' });
    expect(res.status).toBe(400);
    const paths = res.body.error.issues.map((i: { path: string[] }) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['firstName', 'status', 'guardianEmail']));
    expect((await admin.get<Student>(`/api/students/${layla.id}`)).body.firstName).toBe('Layla');
  });

  it('checks photoFileId the same way as create', async () => {
    const t = await makeTestContext();
    const { admin, layla } = await seedPeople(t);
    const bad = await admin.patch(`/api/students/${layla.id}`, { photoFileId: '0b7f1a7e-8f1e-4c1b-9f3e-2a2b3c4d5e6f' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0]).toMatchObject({ path: ['photoFileId'] });

    const photo = await uploadPng(admin);
    const ok = await admin.patch<Student>(`/api/students/${layla.id}`, { photoFileId: photo });
    expect(ok.status).toBe(200);
    expect(ok.body.photoFileId).toBe(photo);

    const removed = await admin.patch<Student>(`/api/students/${layla.id}`, { photoFileId: null });
    expect(removed.body.photoFileId).toBeNull();
  });

  it('404s an unknown student', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    expect((await admin.patch('/api/students/9999', { status: 'paused' })).status).toBe(404);
  });
});

describe('DELETE /api/students/:id', () => {
  it('deletes the student, cascading enrollments and attendance and unlinking talent', async () => {
    const t = await makeTestContext();
    const { admin, layla, omar } = await seedPeople(t);
    const course = insertCourse(t, 'Acting I');
    t.db
      .insert(enrollments)
      .values([
        { courseId: course.id, studentId: layla.id, enrolledOn: '2026-01-05' },
        { courseId: course.id, studentId: omar.id, enrolledOn: '2026-01-05' },
      ])
      .run();
    const s = insertSession(t, course.id, '2026-01-12');
    t.db
      .insert(attendance)
      .values([
        { sessionId: s.id, studentId: layla.id, status: 'present' },
        { sessionId: s.id, studentId: omar.id, status: 'late' },
      ])
      .run();
    const tal = t.db.insert(talent).values({ studentId: layla.id, firstName: 'Layla', lastName: 'Haddad' }).returning().get()!;

    const res = await admin.delete(`/api/students/${layla.id}`);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();

    expect((await admin.get(`/api/students/${layla.id}`)).status).toBe(404);
    expect(t.db.select().from(enrollments).where(eq(enrollments.studentId, layla.id)).all()).toEqual([]);
    expect(t.db.select().from(attendance).where(eq(attendance.studentId, layla.id)).all()).toEqual([]);
    // Other students and the course are untouched; the talent profile survives, unlinked.
    expect(t.db.select().from(enrollments).all()).toHaveLength(1);
    expect(t.db.select().from(attendance).all()).toHaveLength(1);
    expect(t.db.select().from(courses).all()).toHaveLength(1);
    expect(t.db.select().from(talent).where(eq(talent.id, tal.id)).get()?.studentId).toBeNull();
    expect((await admin.get('/api/students')).body.items).toHaveLength(3);
  });

  it('404s an unknown student', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    expect((await admin.delete('/api/students/9999')).status).toBe(404);
  });
});

describe('access control', () => {
  it('401s every route when signed out', async () => {
    const t = await makeTestContext();
    const { layla } = await seedPeople(t);
    expect((await t.anon.get('/api/students')).status).toBe(401);
    expect((await t.anon.get(`/api/students/${layla.id}`)).status).toBe(401);
    expect((await t.anon.post('/api/students', { firstName: 'A', lastName: 'B' })).status).toBe(401);
    expect((await t.anon.patch(`/api/students/${layla.id}`, { status: 'paused' })).status).toBe(401);
    expect((await t.anon.delete(`/api/students/${layla.id}`)).status).toBe(401);
  });

  it.each(['owner', 'admin', 'teacher', 'agent'] as const)('%s can read the list and a student', async (role) => {
    const t = await makeTestContext();
    const { layla } = await seedPeople(t);
    const me = await t.as(role);
    const list = await me.get('/api/students');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(4);
    expect((await me.get(`/api/students/${layla.id}`)).status).toBe(200);
  });

  it.each(['teacher', 'agent'] as const)('%s cannot create, update or delete', async (role) => {
    const t = await makeTestContext();
    const { layla } = await seedPeople(t);
    const me = await t.as(role);
    const created = await me.post('/api/students', { firstName: 'A', lastName: 'B' });
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe('forbidden');
    expect((await me.patch(`/api/students/${layla.id}`, { status: 'paused' })).status).toBe(403);
    expect((await me.delete(`/api/students/${layla.id}`)).status).toBe(403);
    // Nothing changed.
    expect(t.db.select().from(students).all()).toHaveLength(4);
    expect(t.db.select().from(students).where(eq(students.id, layla.id)).get()?.status).toBe('active');
  });

  it('owner can create, update and delete', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const created = await owner.post<Student>('/api/students', { firstName: 'A', lastName: 'B' });
    expect(created.status).toBe(201);
    expect((await owner.patch(`/api/students/${created.body.id}`, { lastName: 'C' })).body.lastName).toBe('C');
    expect((await owner.delete(`/api/students/${created.body.id}`)).status).toBe(204);
  });

  it('requires the X-Requested-With header on writes', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const res = await admin.raw('/api/students', {
      method: 'POST',
      headers: { cookie: admin.cookie!, 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'A', lastName: 'B' }),
    });
    expect(res.status).toBe(403);
  });
});
