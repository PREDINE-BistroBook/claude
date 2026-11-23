import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from '../../src/shared/dates';
import { BUILT_IN_POSITIONS } from '../../src/shared/permissions';
import { classSessions, enrollments, students, users } from '../../src/server/db/schema';
import { daysBetween, generateDates, mayMarkAttendance, planRegeneration, sameSchedule } from '../../src/server/lib/classSessions';
import { makeTestContext, type Client, todayISO } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const today = todayISO();
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '10:00', endTime: '11:00' }));

function mkStudent(t: Ctx, firstName: string, lastName: string) {
  return t.db.insert(students).values({ firstName, lastName }).returning().get()!;
}

function courseBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Scene Study',
    startDate: '2031-03-03', // a Monday
    endDate: '2031-03-30', // a Sunday (4 weeks)
    schedule: [
      { weekday: 2, startTime: '18:00', endTime: '20:00' },
      { weekday: 4, startTime: '18:00', endTime: '20:00' },
    ],
    ...overrides,
  };
}

async function mkCourse(client: Client, overrides: Record<string, unknown> = {}) {
  const res = await client.post('/api/courses', courseBody(overrides));
  if (res.status !== 201) throw new Error(`create course failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function sessionOn(course: { sessions: any[] }, date: string, startTime?: string) {
  const s = course.sessions.find((x: any) => x.date === date && (!startTime || x.startTime === startTime));
  if (!s) throw new Error(`no session on ${date} ${startTime ?? ''}`);
  return s;
}

// ── Pure generator ──────────────────────────────────────────────────────────

describe('generateDates (unit)', () => {
  it('produces every matching weekday in the inclusive range, sorted', () => {
    const out = generateDates(
      [
        { weekday: 4, startTime: '18:00', endTime: '20:00' },
        { weekday: 2, startTime: '18:00', endTime: '20:00' },
      ],
      '2031-03-03',
      '2031-03-30',
    );
    expect(out.map((o) => o.date)).toEqual([
      '2031-03-04',
      '2031-03-06',
      '2031-03-11',
      '2031-03-13',
      '2031-03-18',
      '2031-03-20',
      '2031-03-25',
      '2031-03-27',
    ]);
    expect(out.every((o) => [2, 4].includes(weekdayOf(o.date)))).toBe(true);
    expect(out[0]).toEqual({ date: '2031-03-04', startTime: '18:00', endTime: '20:00' });
  });

  it('includes both range ends and handles several slots on one day', () => {
    const out = generateDates(
      [
        { weekday: 1, startTime: '14:00', endTime: '15:00' },
        { weekday: 1, startTime: '09:00', endTime: '10:00' },
        { weekday: 0, startTime: '12:00', endTime: '13:00' },
      ],
      '2031-03-03', // Monday
      '2031-03-10', // Monday
    );
    expect(out).toEqual([
      { date: '2031-03-03', startTime: '09:00', endTime: '10:00' },
      { date: '2031-03-03', startTime: '14:00', endTime: '15:00' },
      { date: '2031-03-09', startTime: '12:00', endTime: '13:00' },
      { date: '2031-03-10', startTime: '09:00', endTime: '10:00' },
      { date: '2031-03-10', startTime: '14:00', endTime: '15:00' },
    ]);
  });

  it('crosses month, year and leap-day boundaries correctly', () => {
    const out = generateDates([{ weekday: 6, startTime: '10:00', endTime: '12:00' }], '2031-12-20', '2032-03-06');
    expect(out).toHaveLength(12);
    expect(out.every((o) => weekdayOf(o.date) === 6)).toBe(true);
    expect(out.map((o) => o.date)).toContain('2032-01-03');
    expect(out.map((o) => o.date)).toContain('2032-02-28');
    expect(out.at(-1)!.date).toBe('2032-03-06');
    // Every gap is exactly one week.
    for (let i = 1; i < out.length; i++) expect(daysBetween(out[i - 1]!.date, out[i]!.date)).toBe(7);
  });

  it('returns nothing for no slots or a reversed range, and drops duplicate start times', () => {
    expect(generateDates([], '2031-01-01', '2031-12-31')).toEqual([]);
    expect(generateDates(ALL_WEEK, '2031-02-01', '2031-01-01')).toEqual([]);
    const dup = generateDates(
      [
        { weekday: 3, startTime: '10:00', endTime: '11:00' },
        { weekday: 3, startTime: '10:00', endTime: '12:00' },
      ],
      '2031-03-03',
      '2031-03-09',
    );
    expect(dup).toHaveLength(1);
  });

  it('daysBetween counts whole days', () => {
    expect(daysBetween('2031-01-01', '2031-01-01')).toBe(0);
    expect(daysBetween('2031-01-01', '2033-01-01')).toBe(731);
    expect(daysBetween('2031-03-20', '2031-04-10')).toBe(21);
    expect(daysBetween('2031-01-10', '2031-01-01')).toBe(-9);
  });

  it('sameSchedule ignores order', () => {
    const a = [
      { weekday: 1, startTime: '10:00', endTime: '11:00' },
      { weekday: 3, startTime: '10:00', endTime: '11:00' },
    ];
    expect(sameSchedule(a, [...a].reverse())).toBe(true);
    expect(sameSchedule(a, [a[0]!])).toBe(false);
  });
});

describe('planRegeneration (unit)', () => {
  const slots = [{ weekday: 1, startTime: '10:00', endTime: '11:00' }]; // Mondays
  const range = { startDate: '2031-03-03', endDate: '2031-03-31', today: '2031-03-15' };
  const s = (id: number, date: string, extra = false, marked = false, startTime = '10:00', endTime = '11:00') => ({
    id,
    date,
    startTime,
    endTime,
    extra,
    marked,
  });

  it('keeps past + marked + extras, deletes stale upcoming, inserts missing', () => {
    const existing = [
      s(1, '2031-03-04'), // past Tuesday (old schedule): untouched
      s(2, '2031-03-18'), // upcoming Tuesday, unmarked: deleted
      s(3, '2031-03-25', false, true), // upcoming Tuesday, marked: kept
      s(4, '2031-03-20', true), // extra: kept
      s(5, '2031-03-17'), // upcoming Monday matching the schedule: kept
      s(6, '2031-04-15'), // after the end: deleted
      s(7, '2031-02-01'), // before the start, unmarked: deleted
      s(8, '2031-02-02', false, true), // before the start, marked: kept
    ];
    const plan = planRegeneration(existing, slots, range);
    expect(plan.deleteIds.sort()).toEqual([2, 6, 7]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts.map((o) => o.date)).toEqual(['2031-03-24', '2031-03-31']);
  });

  it('updates the end time of kept sessions and never inserts over an extra', () => {
    const plan = planRegeneration([s(1, '2031-03-17', false, false, '10:00', '10:30'), s(2, '2031-03-24', true)], slots, range);
    expect(plan.updates).toEqual([{ id: 1, endTime: '11:00' }]);
    expect(plan.inserts.map((o) => o.date)).toEqual(['2031-03-31']);
  });

  it('only generates from today when the course started earlier', () => {
    const plan = planRegeneration([], slots, range);
    expect(plan.inserts.every((o) => o.date >= range.today)).toBe(true);
  });
});

describe('mayMarkAttendance (unit)', () => {
  it('attendance.write + classes.all: any session; attendance.write alone: only their own; no attendance.write: never', () => {
    const everyone = BUILT_IN_POSITIONS.find((p) => p.key === 'ceo')!.permissions;
    const director = BUILT_IN_POSITIONS.find((p) => p.key === 'executive_director')!.permissions;
    const coach = BUILT_IN_POSITIONS.find((p) => p.key === 'acting_coach')!.permissions;
    const casting = BUILT_IN_POSITIONS.find((p) => p.key === 'head_of_casting')!.permissions;
    expect(mayMarkAttendance({ id: 1, permissions: [...everyone] }, null)).toBe(true);
    expect(mayMarkAttendance({ id: 1, permissions: [...director] }, 99)).toBe(true);
    expect(mayMarkAttendance({ id: 5, permissions: [...coach] }, 5)).toBe(true);
    expect(mayMarkAttendance({ id: 5, permissions: [...coach] }, 6)).toBe(false);
    expect(mayMarkAttendance({ id: 5, permissions: [...coach] }, null)).toBe(false);
    expect(mayMarkAttendance({ id: 5, permissions: [...casting] }, 5)).toBe(false);
    // Coach + finance: finance brings classes.all, so the coach may mark any session.
    expect(mayMarkAttendance({ id: 5, permissions: [...coach, 'classes.all'] }, 6)).toBe(true);
    // Marking needs the roster, so courses.read too.
    expect(mayMarkAttendance({ id: 5, permissions: ['attendance.write', 'classes.all'] }, 5)).toBe(false);
  });
});

// ── API ─────────────────────────────────────────────────────────────────────

describe('courses: create & read', () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await makeTestContext();
  });

  it('creates a class with its slots and generated sessions', async () => {
    const admin = await t.as('admin');
    const teacher = await t.createUser('teacher', { name: 'Tina Teacher' });
    const res = await admin.post(
      '/api/courses',
      courseBody({ teacherId: teacher.id, room: 'Studio A', capacity: 12, level: 'beginner', color: 'sky', description: '' }),
    );
    expect(res.status).toBe(201);
    const c = res.body;
    expect(c).toMatchObject({
      name: 'Scene Study',
      status: 'active',
      teacherId: teacher.id,
      teacherName: 'Tina Teacher',
      room: 'Studio A',
      capacity: 12,
      level: 'beginner',
      color: 'sky',
      description: null,
      enrolledCount: 0,
      enrollments: [],
    });
    expect(c.schedule).toEqual([
      { weekday: 2, startTime: '18:00', endTime: '20:00' },
      { weekday: 4, startTime: '18:00', endTime: '20:00' },
    ]);
    expect(c.sessions).toHaveLength(8);
    expect(c.sessions.every((s: any) => s.extra === false && s.status === 'scheduled' && s.attendanceTaken === false)).toBe(true);
    expect(c.sessions[0]).toMatchObject({
      courseId: c.id,
      courseName: 'Scene Study',
      color: 'sky',
      date: '2031-03-04',
      startTime: '18:00',
      endTime: '20:00',
      room: 'Studio A',
      teacherId: teacher.id,
      teacherName: 'Tina Teacher',
      topic: null,
      notes: null,
    });
    expect(c.nextSession).toEqual({ id: c.sessions[0].id, date: '2031-03-04', startTime: '18:00' });
    expect(typeof c.createdAt).toBe('number');

    const got = await admin.get(`/api/courses/${c.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(c);
  });

  it('allows a class with no weekly slots (sessions added by hand)', async () => {
    const admin = await t.as('owner');
    const c = await mkCourse(admin, { schedule: [] });
    expect(c.sessions).toEqual([]);
    expect(c.nextSession).toBeNull();
  });

  it('validates the body', async () => {
    const admin = await t.as('admin');
    const bad = await admin.post('/api/courses', { name: '', startDate: '2031-02-30', endDate: 'x', schedule: [{ weekday: 7, startTime: '25:00', endTime: '10:00' }] });
    expect(bad.status).toBe(400);
    const paths = bad.body.error.issues.map((i: any) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'startDate', 'endDate', 'schedule.0.weekday', 'schedule.0.startTime']));

    const order = await admin.post('/api/courses', courseBody({ startDate: '2031-03-10', endDate: '2031-03-01' }));
    expect(order.status).toBe(400);
    expect(order.body.error.issues[0]).toMatchObject({ path: ['endDate'], message: 'errors.endBeforeStart' });

    const slot = await admin.post('/api/courses', courseBody({ schedule: [{ weekday: 1, startTime: '18:00', endTime: '18:00' }] }));
    expect(slot.status).toBe(400);
    expect(slot.body.error.issues[0].path).toEqual(['schedule', 0, 'endTime']);
  });

  it('limits the date span to 731 days', async () => {
    const admin = await t.as('admin');
    const ok = await admin.post('/api/courses', courseBody({ startDate: '2031-01-01', endDate: '2033-01-01', schedule: [] }));
    expect(ok.status).toBe(201);
    const tooLong = await admin.post('/api/courses', courseBody({ startDate: '2031-01-01', endDate: '2033-01-02' }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.issues).toEqual([{ path: ['endDate'], code: 'custom', message: 'errors.dateRangeTooLong' }]);
  });

  it('requires the teacher to be an existing, active staff member', async () => {
    const admin = await t.as('admin');
    const gone = await t.createUser('teacher', { active: false });
    for (const teacherId of [9999, gone.id]) {
      const res = await admin.post('/api/courses', courseBody({ teacherId }));
      expect(res.status).toBe(400);
      expect(res.body.error.issues[0]).toMatchObject({ path: ['teacherId'], message: 'classes:errors.teacherInvalid' });
    }
  });

  it('enforces permissions: read with courses.read (own classes only without classes.all), write with courses.write', async () => {
    const admin = await t.as('admin');
    const teacher = await t.as('teacher');
    const c = await mkCourse(admin);
    const own = await mkCourse(admin, { name: 'Own', teacherId: teacher.user.id });
    expect((await t.anon.get('/api/courses')).status).toBe(401);
    expect((await t.anon.get(`/api/courses/${c.id}`)).status).toBe(401);
    // Head of casting has classes.all: sees every class, can't change any.
    const agent = await t.as('agent');
    expect((await agent.get('/api/courses')).body.items.map((x: any) => x.id).sort()).toEqual([c.id, own.id].sort());
    // A coach sees only the classes they teach; anyone else's is a 404.
    expect((await teacher.get('/api/courses')).body.items.map((x: any) => x.id)).toEqual([own.id]);
    expect((await teacher.get(`/api/courses/${own.id}`)).status).toBe(200);
    expect((await teacher.get(`/api/courses/${c.id}`)).status).toBe(404);
    for (const [u, course] of [
      [agent, c],
      [teacher, own],
    ] as const) {
      expect((await u.get(`/api/courses/${course.id}`)).status).toBe(200);
      expect((await u.post('/api/courses', courseBody())).status).toBe(403);
      expect((await u.patch(`/api/courses/${course.id}`, { name: 'X' })).status).toBe(403);
      expect((await u.delete(`/api/courses/${course.id}`)).status).toBe(403);
      expect((await u.post(`/api/courses/${course.id}/sessions`, { date: '2031-03-05', startTime: '10:00', endTime: '11:00' })).status).toBe(403);
    }
    // No courses.read at all (casting team): 403.
    expect((await (await t.as('casting_team')).get('/api/courses')).status).toBe(403);
  });

  it('answers 404 for unknown classes', async () => {
    const admin = await t.as('admin');
    expect((await admin.get('/api/courses/999')).status).toBe(404);
    expect((await admin.get('/api/courses/abc')).status).toBe(404);
    expect((await admin.patch('/api/courses/999', { name: 'X' })).status).toBe(404);
    expect((await admin.delete('/api/courses/999')).status).toBe(404);
    expect((await admin.post('/api/courses/999/enrollments', { studentId: 1 })).status).toBe(404);
    expect((await admin.post('/api/courses/999/sessions', { date: '2031-03-05', startTime: '10:00', endTime: '11:00' })).status).toBe(404);
  });
});

describe('courses: list', () => {
  it('sorts active first then by name, counts enrolled, filters by status and teacher', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const tina = await t.createUser('teacher', { name: 'Tina' });
    const tom = await t.createUser('teacher', { name: 'Tom' });
    const zed = await mkCourse(admin, { name: 'Zed Improv', teacherId: tina.id });
    const alpha = await mkCourse(admin, { name: 'alpha Voice', teacherId: tom.id });
    const archived = await mkCourse(admin, { name: 'Archived Mime', status: 'archived', teacherId: tina.id });

    const s1 = mkStudent(t, 'A', 'One');
    const s2 = mkStudent(t, 'B', 'Two');
    await admin.post(`/api/courses/${zed.id}/enrollments`, { studentId: s1.id });
    const e2 = await admin.post(`/api/courses/${zed.id}/enrollments`, { studentId: s2.id });
    await admin.patch(`/api/courses/${zed.id}/enrollments/${e2.body.id}`, { status: 'withdrawn' });

    const all = await admin.get('/api/courses');
    expect(all.status).toBe(200);
    expect(all.body.items.map((c: any) => c.name)).toEqual(['alpha Voice', 'Zed Improv', 'Archived Mime']);
    const zedItem = all.body.items.find((c: any) => c.id === zed.id);
    expect(zedItem).toMatchObject({ enrolledCount: 1, teacherName: 'Tina', schedule: zed.schedule });
    expect(zedItem.nextSession).toMatchObject({ date: '2031-03-04', startTime: '18:00' });
    // List items don't carry the detail-only fields.
    expect(zedItem.sessions).toBeUndefined();
    expect(zedItem.enrollments).toBeUndefined();

    const active = await admin.get('/api/courses?status=active');
    expect(active.body.items.map((c: any) => c.id)).toEqual([alpha.id, zed.id]);
    const arch = await admin.get('/api/courses?status=archived');
    expect(arch.body.items.map((c: any) => c.id)).toEqual([archived.id]);
    const mine = await admin.get(`/api/courses?teacherId=${tina.id}`);
    expect(mine.body.items.map((c: any) => c.id)).toEqual([zed.id, archived.id]);
    expect((await admin.get('/api/courses?status=bogus')).status).toBe(400);
  });

  it('nextSession skips past and cancelled sessions', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const c = await mkCourse(admin, { startDate: addDays(today, -10), endDate: addDays(today, 20), schedule: ALL_WEEK });
    const todays = sessionOn(c, today);
    await admin.patch(`/api/sessions/${todays.id}`, { status: 'cancelled' });
    const list = await admin.get('/api/courses');
    const tomorrow = sessionOn(c, addDays(today, 1));
    expect(list.body.items[0].nextSession).toEqual({ id: tomorrow.id, date: tomorrow.date, startTime: '10:00' });
  });
});

describe('courses: update & regeneration', () => {
  let t: Ctx;
  let admin: Client & { user: { id: number } };
  beforeEach(async () => {
    t = await makeTestContext();
    admin = await t.as('admin');
  });

  async function setup() {
    // Every day at 10:00, from two weeks ago to four weeks ahead.
    const c = await mkCourse(admin, { startDate: addDays(today, -14), endDate: addDays(today, 27), schedule: ALL_WEEK });
    const st = mkStudent(t, 'Sam', 'Student');
    await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    t.db.update(enrollments).set({ enrolledOn: addDays(today, -30) }).run();
    const markedFuture = sessionOn(c, addDays(today, 3));
    const markedPast = sessionOn(c, addDays(today, -10));
    for (const s of [markedFuture, markedPast]) {
      const r = await admin.put(`/api/sessions/${s.id}/attendance`, { records: [{ studentId: st.id, status: 'excused' }] });
      expect(r.status).toBe(200);
    }
    const extra = await admin.post(`/api/courses/${c.id}/sessions`, { date: addDays(today, 20), startTime: '15:00', endTime: '16:00', topic: 'Showcase' });
    expect(extra.status).toBe(201);
    return { c, st, markedFuture, markedPast, extra: extra.body };
  }

  it('replaces upcoming unmarked sessions, keeps marked ones, past ones and extras', async () => {
    const { c, markedFuture, markedPast, extra } = await setup();
    const pastIds = c.sessions.filter((s: any) => s.date < today).map((s: any) => s.id);
    const res = await admin.patch(`/api/courses/${c.id}`, { schedule: ALL_WEEK.map((s) => ({ ...s, startTime: '12:00', endTime: '13:00' })) });
    expect(res.status).toBe(200);
    const sessions = res.body.sessions;
    // Past: untouched (same ids, still 10:00).
    expect(sessions.filter((s: any) => s.date < today).map((s: any) => s.id)).toEqual(pastIds);
    // Upcoming 10:00 sessions are gone except the marked one.
    const upcoming10 = sessions.filter((s: any) => s.date >= today && s.startTime === '10:00');
    expect(upcoming10.map((s: any) => s.id)).toEqual([markedFuture.id]);
    // A 12:00 session for each day from today to the end.
    const upcoming12 = sessions.filter((s: any) => s.startTime === '12:00');
    expect(upcoming12).toHaveLength(28);
    expect(upcoming12[0].date).toBe(today);
    expect(upcoming12.every((s: any) => s.extra === false)).toBe(true);
    // Extra kept.
    expect(sessions.find((s: any) => s.id === extra.id)).toMatchObject({ extra: true, topic: 'Showcase' });
    expect(sessions.find((s: any) => s.id === markedPast.id)).toBeTruthy();
    expect(res.body.schedule.every((s: any) => s.startTime === '12:00')).toBe(true);
  });

  it('shortening or moving the date range removes unmarked sessions outside it only', async () => {
    const { c, markedPast, extra } = await setup();
    const res = await admin.patch(`/api/courses/${c.id}`, { startDate: addDays(today, -5), endDate: addDays(today, 10) });
    expect(res.status).toBe(200);
    const sessions = res.body.sessions;
    const generated = sessions.filter((s: any) => !s.extra);
    // Marked session before the new start survives; nothing else outside the range.
    expect(generated.filter((s: any) => s.date < addDays(today, -5)).map((s: any) => s.id)).toEqual([markedPast.id]);
    expect(generated.filter((s: any) => s.date > addDays(today, 10))).toEqual([]);
    expect(generated.filter((s: any) => s.date >= addDays(today, -5))).toHaveLength(16);
    // Extras are never removed, even outside the range.
    expect(sessions.find((s: any) => s.id === extra.id)).toBeTruthy();

    // Extending again regenerates the future days.
    const ext = await admin.patch(`/api/courses/${c.id}`, { endDate: addDays(today, 13) });
    expect(ext.body.sessions.filter((s: any) => !s.extra && s.date > addDays(today, 10))).toHaveLength(3);
  });

  it('keeps upcoming sessions that still match (topic and cancellation survive), adjusting the end time', async () => {
    const { c } = await setup();
    const s5 = sessionOn(c, addDays(today, 5));
    const s6 = sessionOn(c, addDays(today, 6));
    await admin.patch(`/api/sessions/${s5.id}`, { topic: 'Monologues' });
    await admin.patch(`/api/sessions/${s6.id}`, { status: 'cancelled' });
    const res = await admin.patch(`/api/courses/${c.id}`, { schedule: ALL_WEEK.map((s) => ({ ...s, endTime: '11:30' })) });
    expect(res.body.sessions.find((s: any) => s.id === s5.id)).toMatchObject({ topic: 'Monologues', endTime: '11:30' });
    expect(res.body.sessions.find((s: any) => s.id === s6.id)).toMatchObject({ status: 'cancelled', endTime: '11:30' });
    // Past sessions keep their old end time.
    expect(res.body.sessions.find((s: any) => s.date === addDays(today, -1)).endTime).toBe('11:00');
  });

  it('leaves sessions alone when neither schedule nor dates change', async () => {
    const { c } = await setup();
    const before = (await admin.get(`/api/courses/${c.id}`)).body.sessions.map((s: any) => s.id);
    const res = await admin.patch(`/api/courses/${c.id}`, {
      name: 'Renamed',
      room: 'Studio B',
      status: 'archived',
      schedule: [...ALL_WEEK].reverse(),
      startDate: c.startDate,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed', room: 'Studio B', status: 'archived' });
    expect(res.body.sessions.map((s: any) => s.id)).toEqual(before);
    expect(res.body.sessions[0].room).toBe('Studio B');
  });

  it('validates merged dates, span and teacher on update', async () => {
    const c = await mkCourse(admin);
    const order = await admin.patch(`/api/courses/${c.id}`, { endDate: '2031-03-01' });
    expect(order.status).toBe(400);
    expect(order.body.error.issues[0]).toMatchObject({ path: ['endDate'], message: 'errors.endBeforeStart' });
    const span = await admin.patch(`/api/courses/${c.id}`, { endDate: '2033-03-04' });
    expect(span.status).toBe(400);
    expect(span.body.error.issues[0].message).toBe('errors.dateRangeTooLong');
    expect((await admin.patch(`/api/courses/${c.id}`, { teacherId: 4242 })).status).toBe(400);
    expect((await admin.patch(`/api/courses/${c.id}`, { name: '' })).status).toBe(400);
    // Clearing the teacher is allowed.
    const teacher = await t.createUser('teacher');
    await admin.patch(`/api/courses/${c.id}`, { teacherId: teacher.id });
    const cleared = await admin.patch(`/api/courses/${c.id}`, { teacherId: null });
    expect(cleared.body).toMatchObject({ teacherId: null, teacherName: null });
  });

  it('keeps a deactivated teacher when patching other fields', async () => {
    const teacher = await t.createUser('teacher');
    const c = await mkCourse(admin, { teacherId: teacher.id });
    t.db.update(users).set({ active: false }).where(eq(users.id, teacher.id)).run();
    const res = await admin.patch(`/api/courses/${c.id}`, { teacherId: teacher.id, name: 'Still here' });
    expect(res.status).toBe(200);
  });

  it('deletes a class with its sessions, enrollments and attendance', async () => {
    const { c } = await setup();
    const res = await admin.delete(`/api/courses/${c.id}`);
    expect(res.status).toBe(204);
    expect((await admin.get(`/api/courses/${c.id}`)).status).toBe(404);
    expect(t.db.select().from(classSessions).all()).toEqual([]);
    expect(t.db.select().from(enrollments).all()).toEqual([]);
  });
});

describe('enrollments', () => {
  let t: Ctx;
  let admin: Client;
  beforeEach(async () => {
    t = await makeTestContext();
    admin = await t.as('admin');
  });

  it('enrolls a student and returns the enrollment', async () => {
    const c = await mkCourse(admin);
    const st = mkStudent(t, 'Layla', 'Haddad');
    const res = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      studentId: st.id,
      firstName: 'Layla',
      lastName: 'Haddad',
      photoFileId: null,
      status: 'enrolled',
      enrolledOn: today,
      attendanceRate: null,
    });
    const detail = await admin.get(`/api/courses/${c.id}`);
    expect(detail.body.enrolledCount).toBe(1);
    expect(detail.body.enrollments).toEqual([res.body]);
  });

  it('refuses duplicates and asks to re-enroll former students', async () => {
    const c = await mkCourse(admin);
    const st = mkStudent(t, 'A', 'B');
    const first = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    const dup = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_enrolled');
    await admin.patch(`/api/courses/${c.id}/enrollments/${first.body.id}`, { status: 'completed' });
    const again = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('previously_enrolled');
  });

  it('enforces capacity on enrol and re-enrol', async () => {
    const c = await mkCourse(admin, { capacity: 2 });
    const [a, b, d] = [mkStudent(t, 'A', 'A'), mkStudent(t, 'B', 'B'), mkStudent(t, 'D', 'D')];
    const ea = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: a.id });
    await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: b.id });
    const full = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: d.id });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('class_full');

    // Withdrawing frees a seat…
    const w = await admin.patch(`/api/courses/${c.id}/enrollments/${ea.body.id}`, { status: 'withdrawn' });
    expect(w.status).toBe(200);
    expect(w.body.status).toBe('withdrawn');
    expect((await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: d.id })).status).toBe(201);
    // …which is then taken, so re-enrolling A fails.
    const re = await admin.patch(`/api/courses/${c.id}/enrollments/${ea.body.id}`, { status: 'enrolled' });
    expect(re.status).toBe(409);
    expect(re.body.error.code).toBe('class_full');

    // Raising capacity lets them back in.
    await admin.patch(`/api/courses/${c.id}`, { capacity: 3 });
    const ok = await admin.patch(`/api/courses/${c.id}/enrollments/${ea.body.id}`, { status: 'enrolled' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('enrolled');
  });

  it('validates the student and the status', async () => {
    const c = await mkCourse(admin);
    const missing = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: 999 });
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues[0]).toMatchObject({ path: ['studentId'], message: 'classes:errors.studentNotFound' });
    expect((await admin.post(`/api/courses/${c.id}/enrollments`, {})).status).toBe(400);
    const st = mkStudent(t, 'A', 'B');
    const e = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    expect((await admin.patch(`/api/courses/${c.id}/enrollments/${e.body.id}`, { status: 'graduated' })).status).toBe(400);
  });

  it('removes an enrollment (attendance history stays) and 404s on wrong ids', async () => {
    const c = await mkCourse(admin, { startDate: addDays(today, -7), endDate: addDays(today, 7), schedule: ALL_WEEK });
    const other = await mkCourse(admin, { name: 'Other' });
    const st = mkStudent(t, 'A', 'B');
    const e = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    const s = sessionOn(c, today);
    await admin.put(`/api/sessions/${s.id}/attendance`, { records: [{ studentId: st.id, status: 'present' }] });

    expect((await admin.patch(`/api/courses/${other.id}/enrollments/${e.body.id}`, { status: 'withdrawn' })).status).toBe(404);
    expect((await admin.delete(`/api/courses/${other.id}/enrollments/${e.body.id}`)).status).toBe(404);
    expect((await admin.delete(`/api/courses/${c.id}/enrollments/9999`)).status).toBe(404);

    expect((await admin.delete(`/api/courses/${c.id}/enrollments/${e.body.id}`)).status).toBe(204);
    const detail = await admin.get(`/api/courses/${c.id}`);
    expect(detail.body.enrollments).toEqual([]);
    // The mark is still on the session, so the student is still on its roster.
    const sess = await admin.get(`/api/sessions/${s.id}`);
    expect(sess.body.roster).toMatchObject([{ studentId: st.id, status: 'present' }]);
  });

  it('is owner/admin only', async () => {
    const c = await mkCourse(admin);
    const st = mkStudent(t, 'A', 'B');
    const e = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    for (const role of ['teacher', 'agent'] as const) {
      const u = await t.as(role);
      expect((await u.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id })).status).toBe(403);
      expect((await u.patch(`/api/courses/${c.id}/enrollments/${e.body.id}`, { status: 'withdrawn' })).status).toBe(403);
      expect((await u.delete(`/api/courses/${c.id}/enrollments/${e.body.id}`)).status).toBe(403);
    }
    expect((await t.anon.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id })).status).toBe(401);
  });

  it('computes the attendance rate over held, non-cancelled sessions since enrolment', async () => {
    const c = await mkCourse(admin, { startDate: addDays(today, -9), endDate: addDays(today, 5), schedule: ALL_WEEK });
    const st = mkStudent(t, 'A', 'B');
    const e = await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: st.id });
    t.db.update(enrollments).set({ enrolledOn: addDays(today, -4) }).where(eq(enrollments.id, e.body.id)).run();
    // Held since enrolment: today-4 … today = 5 sessions; cancel one → 4.
    await admin.patch(`/api/sessions/${sessionOn(c, addDays(today, -1)).id}`, { status: 'cancelled' });
    const mark = (offset: number, status: string) =>
      admin.put(`/api/sessions/${sessionOn(c, addDays(today, offset)).id}/attendance`, { records: [{ studentId: st.id, status }] });
    await mark(-4, 'present');
    await mark(-3, 'late');
    await mark(-2, 'absent');
    await mark(-6, 'present'); // before enrolment: ignored
    await mark(2, 'excused'); // future: ignored
    const detail = await admin.get(`/api/courses/${c.id}`);
    expect(detail.body.enrollments[0].attendanceRate).toBeCloseTo(2 / 4);
  });
});

describe('extra sessions', () => {
  it('adds a one-off session, refusing a clash', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const sub = await t.createUser('teacher', { name: 'Sub' });
    const c = await mkCourse(admin, { room: 'Studio A' });
    const res = await admin.post(`/api/courses/${c.id}/sessions`, { date: '2031-04-02', startTime: '10:00', endTime: '12:00', teacherId: sub.id, topic: 'Showcase', room: '' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      courseId: c.id,
      date: '2031-04-02',
      extra: true,
      status: 'scheduled',
      teacherId: sub.id,
      teacherName: 'Sub',
      room: 'Studio A',
      topic: 'Showcase',
      attendanceTaken: false,
    });
    const clash = await admin.post(`/api/courses/${c.id}/sessions`, { date: '2031-03-04', startTime: '18:00', endTime: '19:00' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('session_exists');
    const order = await admin.post(`/api/courses/${c.id}/sessions`, { date: '2031-04-03', startTime: '12:00', endTime: '11:00' });
    expect(order.status).toBe(400);
    expect(order.body.error.issues[0].path).toEqual(['endTime']);
    const badTeacher = await admin.post(`/api/courses/${c.id}/sessions`, { date: '2031-04-03', startTime: '10:00', endTime: '11:00', teacherId: 999 });
    expect(badTeacher.status).toBe(400);
  });
});

describe('sessions: list', () => {
  it('filters by range, course and effective teacher', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const tina = await t.createUser('teacher', { name: 'Tina' });
    const sub = await t.createUser('teacher', { name: 'Sub' });
    const a = await mkCourse(admin, { name: 'A', teacherId: tina.id, room: 'Studio A' });
    const b = await mkCourse(admin, { name: 'B', schedule: [{ weekday: 2, startTime: '09:00', endTime: '10:00' }] });
    const subbed = sessionOn(a, '2031-03-11');
    await admin.patch(`/api/sessions/${subbed.id}`, { teacherId: sub.id, room: 'Hall' });

    const res = await admin.get('/api/sessions?from=2031-03-01&to=2031-03-12');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: any) => `${s.courseName} ${s.date} ${s.startTime}`)).toEqual([
      'B 2031-03-04 09:00',
      'A 2031-03-04 18:00',
      'A 2031-03-06 18:00',
      'B 2031-03-11 09:00',
      'A 2031-03-11 18:00',
    ]);
    const subRow = res.body.items.find((s: any) => s.id === subbed.id);
    expect(subRow).toMatchObject({ teacherId: sub.id, teacherName: 'Sub', room: 'Hall' });

    const byCourse = await admin.get(`/api/sessions?from=2031-03-01&to=2031-03-31&courseId=${b.id}`);
    expect(byCourse.body.items).toHaveLength(4);
    const tinas = await admin.get(`/api/sessions?from=2031-03-01&to=2031-03-31&teacherId=${tina.id}`);
    expect(tinas.body.items).toHaveLength(7);
    expect(tinas.body.items.find((s: any) => s.id === subbed.id)).toBeUndefined();
    const subs = await admin.get(`/api/sessions?from=2031-03-01&to=2031-03-31&teacherId=${sub.id}`);
    expect(subs.body.items.map((s: any) => s.id)).toEqual([subbed.id]);
  });

  it('validates the query and needs courses.read', async () => {
    const t = await makeTestContext();
    const agent = await t.as('agent');
    expect((await agent.get('/api/sessions?from=2031-03-01&to=2031-03-31')).status).toBe(200);
    expect((await agent.get('/api/sessions')).status).toBe(400);
    expect((await agent.get('/api/sessions?from=2031-03-10&to=2031-03-01')).status).toBe(400);
    const long = await agent.get('/api/sessions?from=2031-01-01&to=2031-03-05');
    expect(long.status).toBe(400);
    expect(long.body.error.issues[0]).toMatchObject({ path: ['to'], message: 'errors.dateRangeTooLong' });
    expect((await agent.get('/api/sessions?from=2031-01-01&to=2031-03-04')).status).toBe(200);
    expect((await t.anon.get('/api/sessions?from=2031-03-01&to=2031-03-31')).status).toBe(401);
  });
});

describe('sessions: detail, edit, delete', () => {
  let t: Ctx;
  let admin: Client;
  beforeEach(async () => {
    t = await makeTestContext();
    admin = await t.as('admin');
  });

  it('builds the roster from enrolments on that date plus anyone already marked', async () => {
    const c = await mkCourse(admin);
    const zara = mkStudent(t, 'Zara', 'Zayed');
    const adam = mkStudent(t, 'Adam', 'amir');
    const late = mkStudent(t, 'Late', 'Joiner');
    const gone = mkStudent(t, 'Gone', 'Away');
    const goneMarked = mkStudent(t, 'Was', 'Marked');
    const outsider = mkStudent(t, 'Not', 'Enrolled');
    for (const s of [zara, adam, late, gone, goneMarked]) await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: s.id });
    t.db.update(enrollments).set({ enrolledOn: '2031-03-01' }).run();
    t.db.update(enrollments).set({ enrolledOn: '2031-03-12' }).where(eq(enrollments.studentId, late.id)).run();
    const session = sessionOn(c, '2031-03-11');
    await admin.put(`/api/sessions/${session.id}/attendance`, { records: [{ studentId: goneMarked.id, status: 'absent', note: 'Sick' }] });
    t.db.update(enrollments).set({ status: 'withdrawn' }).where(eq(enrollments.studentId, gone.id)).run();
    t.db.update(enrollments).set({ status: 'withdrawn' }).where(eq(enrollments.studentId, goneMarked.id)).run();

    const res = await admin.get(`/api/sessions/${session.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: session.id, courseName: 'Scene Study', date: '2031-03-11', attendanceTaken: true, canMarkAttendance: true });
    expect(res.body.roster).toEqual([
      { studentId: adam.id, firstName: 'Adam', lastName: 'amir', photoFileId: null, status: null, note: null },
      { studentId: goneMarked.id, firstName: 'Was', lastName: 'Marked', photoFileId: null, status: 'absent', note: 'Sick' },
      { studentId: zara.id, firstName: 'Zara', lastName: 'Zayed', photoFileId: null, status: null, note: null },
    ]);
    expect(res.body.roster.find((r: any) => r.studentId === outsider.id)).toBeUndefined();
    // The late joiner is on later sessions.
    const later = await admin.get(`/api/sessions/${sessionOn(c, '2031-03-13').id}`);
    expect(later.body.roster.map((r: any) => r.studentId)).toContain(late.id);
  });

  it('reports canMarkAttendance per position, teacher and status', async () => {
    const tina = await t.as('teacher');
    const other = await t.as('teacher');
    const agent = await t.as('agent');
    const moaty = await t.as(['acting_coach', 'finance']);
    const c = await mkCourse(admin, { teacherId: tina.user.id });
    const s = sessionOn(c, '2031-03-04');
    expect((await tina.get(`/api/sessions/${s.id}`)).body.canMarkAttendance).toBe(true);
    // Another coach can't even see a class they don't teach.
    expect((await other.get(`/api/sessions/${s.id}`)).status).toBe(404);
    expect((await agent.get(`/api/sessions/${s.id}`)).body.canMarkAttendance).toBe(false);
    // Coach + finance: classes.all from finance, attendance.write from coaching → any session.
    expect((await moaty.get(`/api/sessions/${s.id}`)).body.canMarkAttendance).toBe(true);
    await admin.patch(`/api/sessions/${s.id}`, { status: 'cancelled' });
    expect((await admin.get(`/api/sessions/${s.id}`)).body.canMarkAttendance).toBe(false);
    expect((await tina.get(`/api/sessions/${s.id}`)).body.canMarkAttendance).toBe(false);
  });

  it('edits, cancels/restores, moves (refusing clashes) and deletes a session', async () => {
    const sub = await t.createUser('teacher', { name: 'Sub' });
    const c = await mkCourse(admin, { room: 'Studio A' });
    const s = sessionOn(c, '2031-03-04');
    const edited = await admin.patch(`/api/sessions/${s.id}`, { topic: 'Chekhov', notes: 'Bring scripts', room: 'Hall', teacherId: sub.id });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ topic: 'Chekhov', notes: 'Bring scripts', room: 'Hall', teacherId: sub.id, teacherName: 'Sub' });
    // Clearing the override falls back to the course's room.
    expect((await admin.patch(`/api/sessions/${s.id}`, { room: '' })).body.room).toBe('Studio A');

    expect((await admin.patch(`/api/sessions/${s.id}`, { status: 'cancelled' })).body.status).toBe('cancelled');
    expect((await admin.patch(`/api/sessions/${s.id}`, { status: 'scheduled' })).body.status).toBe('scheduled');

    const clash = await admin.patch(`/api/sessions/${s.id}`, { date: '2031-03-06' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('session_exists');
    const moved = await admin.patch(`/api/sessions/${s.id}`, { date: '2031-03-05', startTime: '17:00', endTime: '19:00' });
    expect(moved.body).toMatchObject({ date: '2031-03-05', startTime: '17:00', endTime: '19:00' });

    const order = await admin.patch(`/api/sessions/${s.id}`, { endTime: '16:00' });
    expect(order.status).toBe(400);
    expect(order.body.error.issues[0]).toMatchObject({ path: ['endTime'], message: 'errors.endBeforeStart' });
    expect((await admin.patch(`/api/sessions/${s.id}`, { status: 'postponed' })).status).toBe(400);
    expect((await admin.patch(`/api/sessions/${s.id}`, { teacherId: 777 })).status).toBe(400);

    expect((await admin.delete(`/api/sessions/${s.id}`)).status).toBe(204);
    expect((await admin.get(`/api/sessions/${s.id}`)).status).toBe(404);
    expect((await admin.delete(`/api/sessions/${s.id}`)).status).toBe(404);
    expect((await admin.patch(`/api/sessions/${s.id}`, { topic: 'x' })).status).toBe(404);
  });

  it('lets only courses.write edit or delete sessions', async () => {
    const teacher = await t.as('teacher');
    const agent = await t.as('agent');
    const c = await mkCourse(admin, { teacherId: teacher.user.id });
    const s = sessionOn(c, '2031-03-04');
    for (const u of [teacher, agent]) {
      expect((await u.get(`/api/sessions/${s.id}`)).status).toBe(200);
      expect((await u.patch(`/api/sessions/${s.id}`, { topic: 'x' })).status).toBe(403);
      expect((await u.delete(`/api/sessions/${s.id}`)).status).toBe(403);
    }
    expect((await t.anon.get(`/api/sessions/${s.id}`)).status).toBe(401);
    expect((await admin.get('/api/sessions/99999')).status).toBe(404);
  });
});

describe('attendance', () => {
  let t: Ctx;
  let admin: Client & { user: { id: number } };
  beforeEach(async () => {
    t = await makeTestContext();
    admin = await t.as('admin');
  });

  async function setup(teacherId?: number) {
    const c = await mkCourse(admin, { teacherId });
    const a = mkStudent(t, 'Amal', 'Aziz');
    const b = mkStudent(t, 'Badr', 'Bakr');
    for (const s of [a, b]) await admin.post(`/api/courses/${c.id}/enrollments`, { studentId: s.id });
    t.db.update(enrollments).set({ enrolledOn: '2031-01-01' }).run();
    return { c, a, b, s: sessionOn(c, '2031-03-04') };
  }

  it('upserts marks and returns the fresh session detail', async () => {
    const { a, b, s } = await setup();
    const first = await admin.put(`/api/sessions/${s.id}/attendance`, {
      records: [
        { studentId: a.id, status: 'present' },
        { studentId: b.id, status: 'late', note: 'Bus' },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body.attendanceTaken).toBe(true);
    expect(first.body.roster.map((r: any) => [r.studentId, r.status, r.note])).toEqual([
      [a.id, 'present', null],
      [b.id, 'late', 'Bus'],
    ]);

    // Second save updates in place; unlisted students keep their mark.
    const second = await admin.put(`/api/sessions/${s.id}/attendance`, { records: [{ studentId: a.id, status: 'absent', note: 'Called in' }] });
    expect(second.body.roster.map((r: any) => [r.studentId, r.status, r.note])).toEqual([
      [a.id, 'absent', 'Called in'],
      [b.id, 'late', 'Bus'],
    ]);
    const { attendance } = await import('../../src/server/db/schema');
    const rows = t.db.select().from(attendance).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.markedBy === admin.user.id)).toBe(true);
  });

  it('applies the teacher rule without classes.all (own and substitute sessions only)', async () => {
    const tina = await t.as('teacher');
    const sub = await t.as('teacher');
    const { a, c, s } = await setup(tina.user.id);
    const body = { records: [{ studentId: a.id, status: 'present' }] };
    expect((await tina.put(`/api/sessions/${s.id}/attendance`, body)).status).toBe(200);
    // Not their class at all: they can't see it.
    expect((await sub.put(`/api/sessions/${s.id}/attendance`, body)).status).toBe(404);

    // With a substitute set on a session, the substitute marks it — not the course teacher.
    const other = sessionOn(c, '2031-03-06');
    await admin.patch(`/api/sessions/${other.id}`, { teacherId: sub.user.id });
    expect((await sub.put(`/api/sessions/${other.id}/attendance`, body)).status).toBe(200);
    expect((await tina.put(`/api/sessions/${other.id}/attendance`, body)).status).toBe(403);
    // The substitute now sees the class, but still only marks the session they cover.
    const denied = await sub.put(`/api/sessions/${s.id}/attendance`, body);
    expect(denied.status).toBe(403);
    // Coach + finance (classes.all) may mark any session.
    expect((await (await t.as(['acting_coach', 'finance'])).put(`/api/sessions/${s.id}/attendance`, body)).status).toBe(200);

    const agent = await t.as('agent');
    expect((await agent.put(`/api/sessions/${s.id}/attendance`, body)).status).toBe(403);
    expect((await t.anon.put(`/api/sessions/${s.id}/attendance`, body)).status).toBe(401);
    const owner = await t.as('owner');
    expect((await owner.put(`/api/sessions/${s.id}/attendance`, body)).status).toBe(200);
  });

  it('refuses cancelled sessions, strangers, bad bodies and unknown sessions', async () => {
    const { a, c, s } = await setup();
    const stranger = mkStudent(t, 'Not', 'Here');
    const res = await admin.put(`/api/sessions/${s.id}/attendance`, {
      records: [
        { studentId: a.id, status: 'present' },
        { studentId: stranger.id, status: 'present' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toEqual([{ path: ['records', 1, 'studentId'], code: 'custom', message: 'classes:errors.notEnrolled' }]);
    // Nothing was written.
    expect((await admin.get(`/api/sessions/${s.id}`)).body.attendanceTaken).toBe(false);

    expect((await admin.put(`/api/sessions/${s.id}/attendance`, { records: [{ studentId: a.id, status: 'asleep' }] })).status).toBe(400);
    expect((await admin.put(`/api/sessions/${s.id}/attendance`, {})).status).toBe(400);

    // Withdrawn students can still be marked (they were enrolled).
    t.db.update(enrollments).set({ status: 'withdrawn' }).where(eq(enrollments.studentId, a.id)).run();
    expect((await admin.put(`/api/sessions/${s.id}/attendance`, { records: [{ studentId: a.id, status: 'excused' }] })).status).toBe(200);

    const cancelled = sessionOn(c, '2031-03-06');
    await admin.patch(`/api/sessions/${cancelled.id}`, { status: 'cancelled' });
    const r = await admin.put(`/api/sessions/${cancelled.id}/attendance`, { records: [{ studentId: a.id, status: 'present' }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('session_cancelled');

    expect((await admin.put('/api/sessions/99999/attendance', { records: [] })).status).toBe(404);
  });
});

// ── Class scope (without classes.all) ───────────────────────────────────────

describe('class scope', () => {
  it('a coach sees only the classes they teach; a substitute also sees the class they cover', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const tina = await t.as('teacher', { name: 'Tina' });
    const sub = await t.as('teacher', { name: 'Sub' });
    const outsider = await t.as('teacher', { name: 'Outsider' });
    const a = await mkCourse(admin, { name: 'A', teacherId: tina.user.id });
    const b = await mkCourse(admin, { name: 'B' });
    const covered = sessionOn(a, '2031-03-11');
    const bSession = sessionOn(b, '2031-03-11');

    const ids = async (c: Client) => (await c.get('/api/courses')).body.items.map((x: any) => x.name);
    expect(await ids(tina)).toEqual(['A']);
    expect(await ids(sub)).toEqual([]);
    expect((await sub.get(`/api/sessions/${covered.id}`)).status).toBe(404);

    await admin.patch(`/api/sessions/${covered.id}`, { teacherId: sub.user.id });
    expect(await ids(sub)).toEqual(['A']);
    expect((await sub.get(`/api/courses/${a.id}`)).status).toBe(200);
    const detail = await sub.get(`/api/sessions/${covered.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canMarkAttendance).toBe(true);
    // The course teacher still sees the class (and the covered session) but doesn't mark it.
    expect((await tina.get(`/api/sessions/${covered.id}`)).body.canMarkAttendance).toBe(false);

    for (const c of [tina, sub, outsider]) {
      expect((await c.get(`/api/courses/${b.id}`)).status).toBe(404);
      expect((await c.get(`/api/sessions/${bSession.id}`)).status).toBe(404);
    }
    expect(await ids(outsider)).toEqual([]);

    // The sessions list is scoped the same way.
    const range = '/api/sessions?from=2031-03-01&to=2031-03-31';
    const courseNames = async (c: Client) => [...new Set((await c.get(range)).body.items.map((s: any) => s.courseName))];
    expect(await courseNames(tina)).toEqual(['A']);
    expect(await courseNames(sub)).toEqual(['A']);
    expect(await courseNames(outsider)).toEqual([]);
    expect(await courseNames(admin)).toEqual(['A', 'B']);
    // Coach + finance has classes.all.
    expect(await ids(await t.as(['acting_coach', 'finance']))).toEqual(['A', 'B']);
  });

  it('courses.write without classes.all only changes the classes it teaches and enrolls only students it can see', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const lead = await t.as({ permissions: ['courses.read', 'courses.write', 'students.read'] });
    const mine = await mkCourse(admin, { name: 'Mine', teacherId: lead.user.id });
    const other = await mkCourse(admin, { name: 'Other' });
    const known = mkStudent(t, 'Known', 'One');
    const stranger = mkStudent(t, 'Not', 'Mine');
    await admin.post(`/api/courses/${mine.id}/enrollments`, { studentId: known.id });
    expect((await lead.patch(`/api/courses/${mine.id}`, { room: 'Hall' })).status).toBe(200);
    expect((await lead.patch(`/api/courses/${other.id}`, { room: 'Hall' })).status).toBe(404);
    expect((await lead.delete(`/api/courses/${other.id}`)).status).toBe(404);
    expect((await lead.patch(`/api/sessions/${sessionOn(other, '2031-03-04').id}`, { topic: 'x' })).status).toBe(404);
    const refused = await lead.post(`/api/courses/${mine.id}/enrollments`, { studentId: stranger.id });
    expect(refused.status).toBe(400);
    expect(refused.body.error.issues[0]).toMatchObject({ path: ['studentId'], message: 'classes:errors.studentNotFound' });
  });

  it('courses.write without classes.all keeps seeing the classes it created, whoever teaches them', async () => {
    const t = await makeTestContext();
    const lead = await t.as({ permissions: ['courses.read', 'courses.write', 'students.read'] });
    const other = await t.createUser('teacher');
    const forOther = await lead.post('/api/courses', courseBody({ name: 'For other', teacherId: other.id }));
    expect(forOther.status).toBe(201);
    const noTeacher = await lead.post('/api/courses', courseBody({ name: 'No teacher' }));
    expect(noTeacher.status).toBe(201);
    for (const c of [forOther.body, noTeacher.body]) {
      expect((await lead.get(`/api/courses/${c.id}`)).status).toBe(200);
      expect((await lead.get(`/api/sessions/${c.sessions[0].id}`)).status).toBe(200);
    }
    expect((await lead.get('/api/courses')).body.items.map((c: any) => c.name)).toEqual(['For other', 'No teacher']);
    // Seeing a class isn't teaching it: attendance stays with the teacher.
    expect((await lead.get(`/api/sessions/${forOther.body.sessions[0].id}`)).body.canMarkAttendance).toBe(false);
  });
});

describe('owner accounts as teachers', () => {
  it('a non-owner can’t use a hidden owner as teacher or substitute (same answer as a missing id)', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner', { name: 'Ahmed Tamam CEO' });
    const director = await t.as('admin');
    const course = await mkCourse(director);
    const session = course.sessions[0];
    const missing = await director.patch(`/api/courses/${course.id}`, { teacherId: 9999 });
    expect(missing.status).toBe(400);
    const hidden = await director.patch(`/api/courses/${course.id}`, { teacherId: owner.user.id });
    expect([hidden.status, hidden.body]).toEqual([missing.status, missing.body]);
    const created = await director.post('/api/courses', courseBody({ teacherId: owner.user.id }));
    expect([created.status, created.body]).toEqual([missing.status, missing.body]);
    const sub = await director.patch(`/api/sessions/${session.id}`, { teacherId: owner.user.id });
    expect([sub.status, sub.body]).toEqual([missing.status, missing.body]);
    const extra = await director.post(`/api/courses/${course.id}/sessions`, { date: '2031-03-05', startTime: '10:00', endTime: '11:00', teacherId: owner.user.id });
    expect([extra.status, extra.body]).toEqual([missing.status, missing.body]);
    expect(t.db.select().from(classSessions).where(eq(classSessions.date, '2031-03-05')).all()).toHaveLength(0);
    // Owners may; a class an owner already teaches stays editable for the director.
    expect((await owner.patch(`/api/courses/${course.id}`, { teacherId: owner.user.id })).status).toBe(200);
    const edit = await director.patch(`/api/courses/${course.id}`, { room: 'Hall', teacherId: owner.user.id });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ room: 'Hall', teacherId: owner.user.id });
  });
});

describe('attendance needs courses.read too', () => {
  it('attendance.write without courses.read can’t read a roster through PUT', async () => {
    const t = await makeTestContext();
    const admin = await t.as('admin');
    const c = await mkCourse(admin);
    const s = mkStudent(t, 'Roster', 'Kid');
    t.db.insert(enrollments).values({ courseId: c.id, studentId: s.id, status: 'enrolled', enrolledOn: '2031-01-01' }).run();
    const clerk = await t.as({ permissions: ['attendance.write', 'classes.all'] });
    expect((await clerk.get(`/api/sessions/${c.sessions[0].id}`)).status).toBe(403);
    for (const records of [[], [{ studentId: s.id, status: 'present' }]]) {
      const put = await clerk.put(`/api/sessions/${c.sessions[0].id}/attendance`, { records });
      expect(put.status).toBe(403);
      expect(put.body?.roster).toBeUndefined();
    }
    // With courses.read as well it works.
    const coach = await t.as({ permissions: ['attendance.write', 'classes.all', 'courses.read'] });
    expect((await coach.put(`/api/sessions/${c.sessions[0].id}/attendance`, { records: [{ studentId: s.id, status: 'present' }] })).status).toBe(200);
  });
});
