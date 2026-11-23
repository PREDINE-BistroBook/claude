import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays } from '../../src/shared/dates';
import type { CourseColor, EnrollmentStatus, SessionStatus, SubmissionStatus } from '../../src/shared/enums';
import type { DashboardData } from '../../src/shared/schemas/dashboard';
import type { ScheduleEvent } from '../../src/shared/schemas/schedule';
import {
  attendance,
  castingApplications,
  castingRoles,
  castings,
  classSessions,
  courses,
  enrollments,
  leads,
  students,
  submissions,
  talent,
} from '../../src/server/db/schema';
import { makeTestContext, todayISO, schoolTimeToday } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

/** Insert helpers: direct rows, sensible defaults, overrides win. */
function seed(t: Ctx) {
  const today = todayISO();
  let n = 0;
  return {
    course(o: Partial<typeof courses.$inferInsert> = {}) {
      n++;
      return t.db
        .insert(courses)
        .values({ name: `Course ${n}`, startDate: addDays(today, -60), endDate: addDays(today, 60), ...o })
        .returning()
        .get()!;
    },
    session(courseId: number, o: Partial<typeof classSessions.$inferInsert> = {}) {
      return t.db
        .insert(classSessions)
        .values({ courseId, date: today, startTime: '10:00', endTime: '11:00', ...o })
        .returning()
        .get()!;
    },
    student(o: Partial<typeof students.$inferInsert> = {}) {
      n++;
      return t.db.insert(students).values({ firstName: `Stu${n}`, lastName: 'Dent', ...o }).returning().get()!;
    },
    enroll(courseId: number, studentId: number, status: EnrollmentStatus = 'enrolled', enrolledOn = addDays(today, -60)) {
      return t.db.insert(enrollments).values({ courseId, studentId, status, enrolledOn }).returning().get()!;
    },
    mark(sessionId: number, studentId: number) {
      return t.db.insert(attendance).values({ sessionId, studentId, status: 'present' }).returning().get()!;
    },
    talent(o: Partial<typeof talent.$inferInsert> = {}) {
      n++;
      return t.db.insert(talent).values({ firstName: `Tal${n}`, lastName: 'Ent', ...o }).returning().get()!;
    },
    casting(o: Partial<typeof castings.$inferInsert> = {}) {
      n++;
      return t.db.insert(castings).values({ title: `Casting ${n}`, ...o }).returning().get()!;
    },
    role(castingId: number, name = 'Lead') {
      return t.db.insert(castingRoles).values({ castingId, name }).returning().get()!;
    },
    submission(roleId: number, talentId: number, o: Partial<typeof submissions.$inferInsert> = {}) {
      return t.db.insert(submissions).values({ roleId, talentId, ...o }).returning().get()!;
    },
  };
}

const range = (from: string, to: string) => `/api/schedule?from=${from}&to=${to}`;
const classes = (items: ScheduleEvent[]) => items.filter((e) => e.kind === 'class');
const auditions = (items: ScheduleEvent[]) => items.filter((e) => e.kind === 'audition');

// ── Schedule ────────────────────────────────────────────────────────────────

describe('GET /api/schedule', () => {
  it('401 when signed out', async () => {
    const t = await makeTestContext();
    const res = await t.anon.get(range(todayISO(), todayISO()));
    expect(res.status).toBe(401);
  });

  it('validates the range', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const today = todayISO();

    const missing = await owner.get('/api/schedule');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('validation');
    expect(missing.body.error.issues.map((i: any) => i.path[0])).toEqual(expect.arrayContaining(['from', 'to']));

    const bad = await owner.get(range('2026-02-30', today));
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0]).toMatchObject({ path: ['from'], message: 'errors.invalidDate' });

    const reversed = await owner.get(range(today, addDays(today, -1)));
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.issues).toEqual([expect.objectContaining({ path: ['to'], message: 'errors.endBeforeStart' })]);

    const tooLong = await owner.get(range(today, addDays(today, 63)));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.issues).toEqual([expect.objectContaining({ path: ['to'], message: 'errors.dateRangeTooLong' })]);

    expect((await owner.get(range(today, addDays(today, 62)))).status).toBe(200);
    expect((await owner.get(range(today, today))).status).toBe(200);
  });

  it('lists class sessions with room/teacher fallbacks, cancelled ones and enrolled counts', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const owner = await t.as('owner');
    const mainTeacher = await t.createUser('teacher', { name: 'Layla Haddad' });
    const sub = await t.createUser('teacher', { name: 'Omar Sub' });
    const today = todayISO();
    const from = addDays(today, -3);
    const to = addDays(today, 3);

    const course = s.course({ name: 'Scene Study', color: 'violet' as CourseColor, room: 'Studio A', teacherId: mainTeacher.id });
    const bare = s.course({ name: 'Voice', room: null, teacherId: null });
    // Enrollments: 2 enrolled, 1 withdrawn, 1 completed → enrolledCount 2.
    for (const status of ['enrolled', 'enrolled', 'withdrawn', 'completed'] as EnrollmentStatus[]) s.enroll(course.id, s.student().id, status);

    const plain = s.session(course.id, { date: today, startTime: '18:00', endTime: '20:00' });
    const overridden = s.session(course.id, { date: addDays(today, 1), startTime: '09:00', endTime: '10:00', room: 'Hall', teacherId: sub.id });
    const cancelled = s.session(course.id, { date: addDays(today, -1), startTime: '18:00', endTime: '20:00', status: 'cancelled' as SessionStatus });
    const noRoom = s.session(bare.id, { date: today, startTime: '08:30', endTime: '09:30' });
    s.session(course.id, { date: addDays(today, 4) }); // outside the range
    s.session(course.id, { date: addDays(today, -4) }); // outside the range

    const res = await owner.get<{ items: ScheduleEvent[] }>(range(from, to));
    expect(res.status).toBe(200);
    const items = res.body.items;
    expect(items.map((e) => e.id)).toEqual([cancelled.id, noRoom.id, plain.id, overridden.id]);

    expect(items.find((e) => e.id === plain.id)).toEqual({
      kind: 'class',
      id: plain.id,
      courseId: course.id,
      title: 'Scene Study',
      color: 'violet',
      date: today,
      startTime: '18:00',
      endTime: '20:00',
      room: 'Studio A',
      teacherId: mainTeacher.id,
      teacherName: 'Layla Haddad',
      status: 'scheduled',
      enrolledCount: 2,
    });
    expect(items.find((e) => e.id === overridden.id)).toMatchObject({ room: 'Hall', teacherId: sub.id, teacherName: 'Omar Sub', enrolledCount: 2 });
    expect(items.find((e) => e.id === cancelled.id)).toMatchObject({ status: 'cancelled' });
    expect(items.find((e) => e.id === noRoom.id)).toMatchObject({ room: null, teacherId: null, teacherName: null, color: null, enrolledCount: 0 });
  });

  it('lists auditions (not withdrawn, with an audition time) and sorts everything by date then time', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const owner = await t.as('owner');
    const today = todayISO();
    const tomorrow = addDays(today, 1);

    const course = s.course({ name: 'Movement' });
    const morning = s.session(course.id, { date: tomorrow, startTime: '09:00', endTime: '10:00' });
    const evening = s.session(course.id, { date: tomorrow, startTime: '18:00', endTime: '19:00' });

    const casting = s.casting({ title: 'Desert Rose' });
    const lead = s.role(casting.id, 'Lead');
    const extra = s.role(casting.id, 'Extra');
    const staged = s.talent({ firstName: 'Nour', lastName: 'Saleh', stageName: 'Nour S.' });
    const plainName = s.talent({ firstName: 'Karim', lastName: 'Aziz', stageName: '  ' });
    const other = s.talent();

    const a1 = s.submission(lead.id, staged.id, { status: 'audition', auditionAt: `${tomorrow}T12:30`, auditionLocation: 'Studio 5' });
    const a2 = s.submission(extra.id, plainName.id, { status: 'callback', auditionAt: `${today}T23:00` });
    const rejected = s.submission(lead.id, plainName.id, { status: 'rejected', auditionAt: `${tomorrow}T09:00` });
    s.submission(extra.id, staged.id, { status: 'withdrawn', auditionAt: `${tomorrow}T14:00` });
    s.submission(lead.id, other.id, { status: 'submitted' }); // no audition yet
    s.submission(extra.id, other.id, { status: 'audition', auditionAt: `${addDays(today, 2)}T10:00` }); // outside the range

    const res = await owner.get<{ items: ScheduleEvent[] }>(range(today, tomorrow));
    expect(res.status).toBe(200);
    // Same minute (tomorrow 09:00): the class comes before the audition.
    expect(res.body.items.map((e) => `${e.kind}:${e.id}`)).toEqual([
      `audition:${a2.id}`,
      `class:${morning.id}`,
      `audition:${rejected.id}`,
      `audition:${a1.id}`,
      `class:${evening.id}`,
    ]);
    expect(res.body.items.find((e) => e.kind === 'audition' && e.id === a1.id)).toEqual({
      kind: 'audition',
      id: a1.id,
      castingId: casting.id,
      title: 'Desert Rose',
      roleName: 'Lead',
      talentId: staged.id,
      talentName: 'Nour S.',
      date: tomorrow,
      startTime: '12:30',
      location: 'Studio 5',
      status: 'audition',
    });
    expect(res.body.items.find((e) => e.kind === 'audition' && e.id === a2.id)).toMatchObject({
      talentName: 'Karim Aziz',
      date: today,
      startTime: '23:00',
      location: null,
      roleName: 'Extra',
    });
  });

  it('never shows auditions to coaches (no castings.read); casting and the director see both kinds', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const today = todayISO();
    const teacher = await t.as('teacher');
    s.session(s.course({ teacherId: teacher.user.id }).id, { date: today });
    const role = s.role(s.casting().id);
    s.submission(role.id, s.talent().id, { status: 'audition', auditionAt: `${today}T15:00` });

    const tRes = await teacher.get<{ items: ScheduleEvent[] }>(range(today, today));
    expect(tRes.status).toBe(200);
    expect(classes(tRes.body.items)).toHaveLength(1);
    expect(auditions(tRes.body.items)).toHaveLength(0);

    for (const role of ['agent', 'admin'] as const) {
      const client = await t.as(role);
      const res = await client.get<{ items: ScheduleEvent[] }>(range(today, today));
      expect(res.status).toBe(200);
      expect(classes(res.body.items)).toHaveLength(1);
      expect(auditions(res.body.items)).toHaveLength(1);
    }
  });

  it('answers an empty list for a quiet range', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const res = await owner.get(range('2030-01-01', '2030-01-07'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });
});

// ── Dashboard ───────────────────────────────────────────────────────────────

describe('GET /api/dashboard', () => {
  // Pin the clock to noon at the school so "today, already ended" is deterministic.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(schoolTimeToday('12:00'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('401 when signed out', async () => {
    const t = await makeTestContext();
    const res = await t.anon.get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('counts only active / open records, for roles that can see them', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    s.student({ status: 'active' });
    s.student({ status: 'active' });
    s.student({ status: 'prospect' });
    s.student({ status: 'alumni' });
    s.course({ status: 'active' });
    s.course({ status: 'archived' });
    s.talent({ status: 'active' });
    s.talent({ status: 'on_hold' });
    s.talent({ status: 'former' });
    s.casting({ status: 'open' });
    s.casting({ status: 'open' });
    s.casting({ status: 'closed' });
    s.casting({ status: 'cancelled' });

    const owner = await t.as('owner');
    const res = await owner.get<DashboardData>('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(todayISO());
    expect(res.body.counts).toEqual({
      activeStudents: 2,
      activeCourses: 1,
      activeTalent: 1,
      openCastings: 2,
      openLeads: 0,
      newLeadsThisWeek: 0,
      newWebsiteLeads: 0,
      newCastingApplications: 0,
    });

    // A coach without classes.all counts only their own classes and students: none yet.
    const teacher = await t.as('teacher');
    expect((await teacher.get<DashboardData>('/api/dashboard')).body.counts).toEqual({ activeStudents: 0, activeCourses: 0, newWebsiteLeads: null, newCastingApplications: null });
    // Coach + finance has classes.all (and no talent/castings).
    const moaty = await t.as(['acting_coach', 'finance']);
    expect((await moaty.get<DashboardData>('/api/dashboard')).body.counts).toEqual({ activeStudents: 2, activeCourses: 1, newWebsiteLeads: null, newCastingApplications: null });
  });

  it('newWebsiteLeads / newCastingApplications: only website leads and applications still new, each for whoever may see them', async () => {
    const t = await makeTestContext();
    const lead = (source: typeof leads.$inferInsert.source, status: typeof leads.$inferInsert.status, i: number) =>
      t.db.insert(leads).values({ firstName: 'L', lastName: `${i}`, phone: `0100 000 ${1000 + i}`, source, status }).run();
    lead('website', 'new', 1);
    lead('website', 'new', 2);
    lead('website', 'contacted', 3);
    lead('website', 'lost', 4);
    lead('whatsapp', 'new', 5);
    lead('walk_in', 'new', 6);
    const app = (status: typeof castingApplications.$inferInsert.status, i: number) =>
      t.db.insert(castingApplications).values({ firstName: 'A', lastName: `${i}`, dateOfBirth: '2000-01-01', phone: `0100 111 ${1000 + i}`, status }).run();
    app('new', 1);
    app('new', 2);
    app('new', 3);
    app('reviewing', 4);
    app('accepted', 5);
    app('declined', 6);

    const counts = async (spec: Parameters<typeof t.as>[0]) => (await (await t.as(spec)).get<DashboardData>('/api/dashboard')).body.counts;
    expect(await counts('executive_director')).toMatchObject({ newWebsiteLeads: 2, newCastingApplications: 3 });
    expect(await counts('ceo')).toMatchObject({ newWebsiteLeads: 2, newCastingApplications: 3 });
    // talent.read without admissions.read; admissions.read without talent.read; neither.
    expect(await counts('casting_team')).toMatchObject({ newWebsiteLeads: null, newCastingApplications: 3 });
    expect(await counts({ permissions: ['admissions.read'] })).toMatchObject({ newWebsiteLeads: 2, newCastingApplications: null });
    expect(await counts({ permissions: ['website.manage'] })).toEqual({ newWebsiteLeads: null, newCastingApplications: null });
  });

  it('shapes the answer by role: sections a role cannot see are absent', async () => {
    const t = await makeTestContext();
    const all = [
      'today',
      'counts',
      'todaySessions',
      'attendanceToDo',
      'attendanceToDoCount',
      'upcomingAuditions',
      'closingCastings',
      'followUpsDue',
      'followUpsDueCount',
      'upcomingInterviews',
    ];

    for (const role of ['owner', 'admin'] as const) {
      const client = await t.as(role);
      const body = (await client.get('/api/dashboard')).body;
      expect(Object.keys(body).sort()).toEqual([...all].sort());
      expect(Object.keys(body.counts).sort()).toEqual([
        'activeCourses',
        'activeStudents',
        'activeTalent',
        'newCastingApplications',
        'newLeadsThisWeek',
        'newWebsiteLeads',
        'openCastings',
        'openLeads',
      ]);
      expect(body).toMatchObject({
        todaySessions: [],
        attendanceToDo: [],
        attendanceToDoCount: 0,
        upcomingAuditions: [],
        closingCastings: [],
        followUpsDue: [],
        followUpsDueCount: 0,
        upcomingInterviews: [],
      });
    }

    const teacher = await t.as('teacher');
    const tb = (await teacher.get('/api/dashboard')).body;
    expect(Object.keys(tb).sort()).toEqual(['attendanceToDo', 'attendanceToDoCount', 'counts', 'today', 'todaySessions']);
    expect('activeTalent' in tb.counts).toBe(false);
    expect('openCastings' in tb.counts).toBe(false);
    expect('upcomingAuditions' in tb).toBe(false);
    expect('closingCastings' in tb).toBe(false);

    const agent = await t.as('agent');
    const ab = (await agent.get('/api/dashboard')).body;
    expect(Object.keys(ab).sort()).toEqual(['closingCastings', 'counts', 'today', 'todaySessions', 'upcomingAuditions']);
    expect('attendanceToDo' in ab).toBe(false);
    expect(Object.keys(ab.counts).sort()).toEqual(['activeCourses', 'activeStudents', 'activeTalent', 'newCastingApplications', 'newWebsiteLeads', 'openCastings']);
    // The website counts are always there: null when the position can't see them.
    expect(ab.counts.newWebsiteLeads).toBeNull();
    expect(ab.counts.newCastingApplications).toBe(0);
  });

  it("lists today's sessions in the ClassSession shape, sorted by time", async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const owner = await t.as('owner');
    const teacher = await t.createUser('teacher', { name: 'Rania Teach' });
    const today = todayISO();
    const course = s.course({ name: 'Improv', color: 'teal', room: 'Black Box', teacherId: teacher.id });
    const st = s.student();
    s.enroll(course.id, st.id);

    const late = s.session(course.id, { startTime: '19:00', endTime: '21:00', topic: 'Status games', notes: 'Bring water' });
    const early = s.session(course.id, { startTime: '08:00', endTime: '09:00', extra: true, room: 'Room 2' });
    const cancelled = s.session(course.id, { startTime: '13:00', endTime: '14:00', status: 'cancelled' });
    s.mark(early.id, st.id);
    s.session(course.id, { date: addDays(today, 1) });
    s.session(course.id, { date: addDays(today, -1) });

    const body = (await owner.get<DashboardData>('/api/dashboard')).body;
    expect(body.todaySessions!.map((x) => x.id)).toEqual([early.id, cancelled.id, late.id]);
    expect(body.todaySessions![0]).toEqual({
      id: early.id,
      courseId: course.id,
      courseName: 'Improv',
      color: 'teal',
      date: today,
      startTime: '08:00',
      endTime: '09:00',
      room: 'Room 2',
      teacherId: teacher.id,
      teacherName: 'Rania Teach',
      status: 'scheduled',
      extra: true,
      topic: null,
      notes: null,
      attendanceTaken: true,
    });
    expect(body.todaySessions![1]).toMatchObject({ status: 'cancelled', attendanceTaken: false });
    expect(body.todaySessions![2]).toMatchObject({ room: 'Black Box', topic: 'Status games', notes: 'Bring water', extra: false, attendanceTaken: false });
  });

  it("scopes a teacher's sessions to the ones they teach (substitute rules included)", async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const me = await t.as('teacher');
    const colleague = await t.createUser('teacher');
    const today = todayISO();
    const yesterday = addDays(today, -1);

    const myCourse = s.course({ name: 'Mine', teacherId: me.user.id });
    const theirCourse = s.course({ name: 'Theirs', teacherId: colleague.id });
    const st = s.student();
    s.enroll(myCourse.id, st.id);
    s.enroll(theirCourse.id, st.id);

    // Today's all start after the pinned noon, so none is due for attendance yet.
    const own = s.session(myCourse.id, { startTime: '13:00', endTime: '14:00' });
    const handedOff = s.session(myCourse.id, { startTime: '14:00', endTime: '15:00', teacherId: colleague.id });
    const covering = s.session(theirCourse.id, { startTime: '15:00', endTime: '16:00', teacherId: me.user.id });
    s.session(theirCourse.id, { startTime: '17:00', endTime: '18:00' });

    const ownPast = s.session(myCourse.id, { date: yesterday, startTime: '09:00', endTime: '10:00' });
    s.session(myCourse.id, { date: yesterday, startTime: '11:00', endTime: '12:00', teacherId: colleague.id });
    const coveringPast = s.session(theirCourse.id, { date: yesterday, startTime: '15:00', endTime: '16:00', teacherId: me.user.id });
    s.session(theirCourse.id, { date: yesterday, startTime: '17:00', endTime: '18:00' });

    const mine = (await me.get<DashboardData>('/api/dashboard')).body;
    expect(mine.todaySessions!.map((x) => x.id)).toEqual([own.id, covering.id]);
    expect(mine.attendanceToDo!.map((x) => x.id)).toEqual([coveringPast.id, ownPast.id]);
    expect(mine.attendanceToDoCount).toBe(2);

    // An admin sees every session.
    const admin = await t.as('admin');
    const theirs = (await admin.get<DashboardData>('/api/dashboard')).body;
    expect(theirs.todaySessions!.map((x) => x.id)).toEqual([own.id, handedOff.id, covering.id, expect.any(Number)]);
    expect(theirs.attendanceToDoCount).toBe(4);
  });

  it('attendanceToDo: unmarked, held, non-empty sessions from the last 14 days, newest first', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const owner = await t.as('owner');
    const today = todayISO();
    const course = s.course({ name: 'Acting I' });
    const st = s.student();
    s.enroll(course.id, st.id, 'enrolled', addDays(today, -30));

    const empty = s.course({ name: 'Empty' });
    s.enroll(empty.id, s.student().id, 'withdrawn', addDays(today, -30));
    const lateJoin = s.course({ name: 'Late join' });
    s.enroll(lateJoin.id, s.student().id, 'enrolled', addDays(today, -2));

    const d14 = s.session(course.id, { date: addDays(today, -14), startTime: '10:00' });
    s.session(course.id, { date: addDays(today, -15), startTime: '10:00' }); // too old
    const d3a = s.session(course.id, { date: addDays(today, -3), startTime: '09:00' });
    const d3b = s.session(course.id, { date: addDays(today, -3), startTime: '18:00' });
    const marked = s.session(course.id, { date: addDays(today, -2) });
    s.mark(marked.id, st.id);
    s.session(course.id, { date: addDays(today, -1), status: 'cancelled' }); // cancelled
    const endedToday = s.session(course.id, { date: today, startTime: '10:00', endTime: '12:00' }); // ends at "now" (12:00)
    s.session(course.id, { date: today, startTime: '11:30', endTime: '12:30' }); // still running
    s.session(course.id, { date: today, startTime: '18:00', endTime: '20:00' }); // later today
    s.session(course.id, { date: addDays(today, 1) }); // future
    s.session(empty.id, { date: addDays(today, -1) }); // nobody enrolled
    s.session(lateJoin.id, { date: addDays(today, -5) }); // before the only student joined
    const lateJoinAfter = s.session(lateJoin.id, { date: addDays(today, -1) });

    const body = (await owner.get<DashboardData>('/api/dashboard')).body;
    expect(body.attendanceToDo!.map((x) => x.id)).toEqual([endedToday.id, lateJoinAfter.id, d3b.id, d3a.id, d14.id]);
    expect(body.attendanceToDoCount).toBe(5);
    expect(body.attendanceToDo!.every((x) => x.status === 'scheduled' && !x.attendanceTaken)).toBe(true);
    expect(body.attendanceToDo![0]).toMatchObject({ courseName: 'Acting I', date: today, endTime: '12:00' });
  });

  it('attendanceToDo is capped at 10 but reports the full count', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const owner = await t.as('owner');
    const today = todayISO();
    const course = s.course();
    s.enroll(course.id, s.student().id);
    const ids = [];
    for (let i = 1; i <= 12; i++) ids.push(s.session(course.id, { date: addDays(today, -i) }).id);

    const body = (await owner.get<DashboardData>('/api/dashboard')).body;
    expect(body.attendanceToDo).toHaveLength(10);
    expect(body.attendanceToDo!.map((x) => x.id)).toEqual(ids.slice(0, 10));
    expect(body.attendanceToDoCount).toBe(12);
  });

  it('upcomingAuditions: today … today+14, not withdrawn/rejected, soonest first, at most 10', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const agent = await t.as('agent');
    const today = todayISO();
    const casting = s.casting({ title: 'Night Train' });
    const role = s.role(casting.id, 'Conductor');
    const sub = (at: string | null, status: SubmissionStatus = 'audition') =>
      s.submission(role.id, s.talent({ stageName: `T ${at}` }).id, { status, auditionAt: at, auditionLocation: 'Studio' });

    const earlierToday = sub(`${today}T08:00`);
    const lastDay = sub(`${addDays(today, 14)}T23:59`, 'callback');
    const mid = sub(`${addDays(today, 5)}T10:00`, 'booked');
    sub(`${addDays(today, 15)}T09:00`); // too far
    sub(`${addDays(today, -1)}T18:00`); // past
    sub(`${addDays(today, 2)}T10:00`, 'withdrawn');
    sub(`${addDays(today, 2)}T11:00`, 'rejected');
    sub(null, 'submitted');

    let body = (await agent.get<DashboardData>('/api/dashboard')).body;
    expect(body.upcomingAuditions!.map((a) => a.id)).toEqual([earlierToday.id, mid.id, lastDay.id]);
    expect(body.upcomingAuditions![1]).toEqual({
      kind: 'audition',
      id: mid.id,
      castingId: casting.id,
      title: 'Night Train',
      roleName: 'Conductor',
      talentId: mid.talentId,
      talentName: `T ${addDays(today, 5)}T10:00`,
      date: addDays(today, 5),
      startTime: '10:00',
      location: 'Studio',
      status: 'booked',
    });

    for (let i = 0; i < 10; i++) sub(`${addDays(today, 1)}T${String(8 + i).padStart(2, '0')}:00`);
    body = (await agent.get<DashboardData>('/api/dashboard')).body;
    expect(body.upcomingAuditions).toHaveLength(10);
    expect(body.upcomingAuditions![0]!.id).toBe(earlierToday.id);
    expect(body.upcomingAuditions!.map((a) => a.id)).not.toContain(lastDay.id);
  });

  it('closingCastings: open castings with a deadline today … today+7, soonest first', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const owner = await t.as('owner');
    const today = todayISO();
    const todayDeadline = s.casting({ title: 'Today', submissionDeadline: today });
    const week = s.casting({ title: 'Week', submissionDeadline: addDays(today, 7) });
    const soon = s.casting({ title: 'Soon', submissionDeadline: addDays(today, 3) });
    s.casting({ title: 'Too far', submissionDeadline: addDays(today, 8) });
    s.casting({ title: 'Passed', submissionDeadline: addDays(today, -1) });
    s.casting({ title: 'Closed', status: 'closed', submissionDeadline: addDays(today, 2) });
    s.casting({ title: 'Cancelled', status: 'cancelled', submissionDeadline: addDays(today, 2) });
    s.casting({ title: 'No deadline' });

    const body = (await owner.get<DashboardData>('/api/dashboard')).body;
    expect(body.closingCastings).toEqual([
      { id: todayDeadline.id, title: 'Today', submissionDeadline: today },
      { id: soon.id, title: 'Soon', submissionDeadline: addDays(today, 3) },
      { id: week.id, title: 'Week', submissionDeadline: addDays(today, 7) },
    ]);
  });
});

// ── Class scope ─────────────────────────────────────────────────────────────

describe('class scope on the schedule and dashboard', () => {
  it('without classes.all the schedule shows only the classes you teach (all their sessions); with it, every class', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const today = todayISO();
    const coach = await t.as('teacher');
    const sub = await t.as('teacher');
    const own = s.course({ name: 'Own', teacherId: coach.user.id });
    const other = s.course({ name: 'Other' });
    const ownSession = s.session(own.id, { date: today });
    s.session(own.id, { date: today, startTime: '12:00', endTime: '13:00', teacherId: sub.user.id });
    s.session(other.id, { date: today });

    const titles = async (c: Awaited<ReturnType<typeof t.as>>) => classes((await c.get<{ items: ScheduleEvent[] }>(range(today, today))).body.items).map((e) => `${e.title} ${e.startTime}`);
    expect(await titles(coach)).toEqual(['Own 10:00', 'Own 12:00']);
    // The substitute covers one session, so the class is theirs to see too.
    expect(await titles(sub)).toEqual(['Own 10:00', 'Own 12:00']);
    expect(await titles(await t.as('video_editor'))).toEqual(['Other 10:00', 'Own 10:00', 'Own 12:00']);
    expect(ownSession).toBeTruthy();
  });

  it('a coach’s dashboard counts only their own active classes and students', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const coach = await t.as('teacher');
    const own = s.course({ teacherId: coach.user.id });
    const other = s.course();
    const archived = s.course({ teacherId: coach.user.id, status: 'archived' });
    const mine = s.student();
    s.enroll(own.id, mine.id);
    s.enroll(archived.id, s.student({ status: 'alumni' }).id);
    s.enroll(other.id, s.student().id);
    s.student();
    expect((await coach.get<DashboardData>('/api/dashboard')).body.counts).toEqual({ activeStudents: 1, activeCourses: 1, newWebsiteLeads: null, newCastingApplications: null });
    expect((await (await t.as('admin')).get<DashboardData>('/api/dashboard')).body.counts).toMatchObject({ activeStudents: 3, activeCourses: 2 });
  });

  it('attendance to-do needs courses.read as well as attendance.write (marking needs the roster)', async () => {
    const t = await makeTestContext();
    const s = seed(t);
    const course = s.course();
    s.session(course.id, { date: addDays(todayISO(), -1) });
    s.enroll(course.id, s.student().id);
    const clerk = await t.as({ permissions: ['attendance.write', 'classes.all'] });
    const data = (await clerk.get<DashboardData>('/api/dashboard')).body;
    expect(data.attendanceToDo).toBeUndefined();
    expect(data.attendanceToDoCount).toBeUndefined();
    const coach = await t.as({ permissions: ['attendance.write', 'classes.all', 'courses.read'] });
    expect((await coach.get<DashboardData>('/api/dashboard')).body.attendanceToDoCount).toBe(1);
  });
});

describe('dashboard: "new this week" starts at midnight at the school', () => {
  // Workers (and vitest) run in UTC; the school's Monday starts at 22:00 UTC on Sunday in
  // winter (Cairo UTC+2) and at 21:00 UTC in summer (UTC+3, Egypt's summer time).
  it.each([
    { season: 'winter', sundayLate: '2026-11-22T21:30:00Z', mondayEarly: '2026-11-22T22:30:00Z', now: '2026-11-22T23:00:00Z', today: '2026-11-23' },
    { season: 'summer', sundayLate: '2026-07-19T20:30:00Z', mondayEarly: '2026-07-19T21:30:00Z', now: '2026-07-19T23:30:00Z', today: '2026-07-20' },
  ])('counts an enquiry from 00:30 on Monday in Cairo, not one from 23:30 on Sunday ($season)', async ({ sundayLate, mondayEarly, now, today }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(sundayLate));
      const t = await makeTestContext();
      const owner = await t.as('owner');
      expect((await owner.patch('/api/settings', { weekStartsOn: 1 })).status).toBe(200);
      expect((await owner.post('/api/leads', { firstName: 'Sunday', lastName: 'Night', phone: '0100 111 2222' })).status).toBe(201);
      vi.setSystemTime(new Date(mondayEarly));
      expect((await owner.post('/api/leads', { firstName: 'Monday', lastName: 'Early', phone: '0100 333 4444' })).status).toBe(201);

      // 01:00 (winter) / 02:30 (summer) on Monday at the school: the runtime's UTC date is still Sunday.
      vi.setSystemTime(new Date(now));
      const res = await owner.get<DashboardData>('/api/dashboard');
      expect(res.body.today).toBe(today);
      expect(res.body.counts.newLeadsThisWeek).toBe(1);
      expect(res.body.counts.openLeads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
