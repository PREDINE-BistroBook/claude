import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { todayISO } from '../../shared/dates';
import {
  COURSE_ERROR_CODES,
  MAX_COURSE_SPAN_DAYS,
  courseInput,
  courseListQuery,
  courseUpdateInput,
  enrollmentInput,
  enrollmentUpdateInput,
  sessionCreateInput,
  type ScheduleSlot,
} from '../../shared/schemas/courses';
import type { ListResponse } from '../../shared/schemas/common';
import type { CourseListItem } from '../../shared/schemas/courses';
import type { DB } from '../db/client';
import { attendance, classSessions, courseSlots, courses, enrollments, students, users } from '../db/schema';
import type { AppEnv } from '../env';
import {
  daysBetween,
  generateDates,
  loadCourseDetail,
  loadCourseListItems,
  loadEnrollments,
  loadSession,
  planRegeneration,
  sameSchedule,
} from '../lib/classSessions';
import type { SessionUser } from '../../shared/schemas/auth';
import { canSeeStudent, courseScope } from '../lib/access';
import { ApiError, notFound } from '../lib/errors';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Classes ("courses"): CRUD, weekly schedule → generated sessions, enrollments
 * and one-off extra sessions. Reading needs courses.read; everything that
 * changes a class needs courses.write. Without classes.all a person only sees
 * (and can only change) the classes they teach — as the course's teacher or as
 * the substitute on any of its sessions; any other class is a 404.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const read = requirePermission('courses.read');
const write = requirePermission('courses.write');

/** 400 with one field issue — same shape as a zod validation error. */
export function fieldError(path: (string | number)[], message: string): ApiError {
  return new ApiError(400, 'validation', 'Some fields are missing or invalid', [{ path, code: 'custom', message }]);
}

/** A teacher (or substitute) must be an existing, active staff account. */
export function assertActiveStaff(db: DB, userId: number, path: (string | number)[] = ['teacherId']) {
  const row = db.select({ active: users.active }).from(users).where(eq(users.id, userId)).get();
  if (!row?.active) throw fieldError(path, 'classes:errors.teacherInvalid');
}

function assertSpan(startDate: string, endDate: string) {
  if (endDate < startDate) throw fieldError(['endDate'], 'errors.endBeforeStart');
  if (daysBetween(startDate, endDate) > MAX_COURSE_SPAN_DAYS) throw fieldError(['endDate'], 'errors.dateRangeTooLong');
}

/** The course, if this person may see it; a 404 otherwise. */
function requireCourse(db: DB, id: number, user: SessionUser) {
  const course = db
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), courseScope(user)))
    .get();
  if (!course) throw notFound('Class not found');
  return course;
}

function enrolledCount(db: Pick<DB, 'select'>, courseId: number): number {
  return (
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, 'enrolled')))
      .get()?.n ?? 0
  );
}

function classFull(): ApiError {
  return new ApiError(409, COURSE_ERROR_CODES.classFull, 'This class is full');
}

// ── Courses ─────────────────────────────────────────────────────────────────

router.get('/', read, (c) => {
  const q = query(c, courseListQuery);
  const filters = [
    courseScope(currentUser(c)),
    q.status ? eq(courses.status, q.status) : undefined,
    q.teacherId ? eq(courses.teacherId, q.teacherId) : undefined,
  ];
  const items: CourseListItem[] = loadCourseListItems(c.get('db'), and(...filters), todayISO()).map(
    ({ description: _d, createdAt: _c, updatedAt: _u, ...item }) => item,
  );
  return c.json<ListResponse<CourseListItem>>({ items });
});

router.post('/', write, async (c) => {
  const input = await body(c, courseInput);
  const db = c.get('db');
  assertSpan(input.startDate, input.endDate);
  if (input.teacherId) assertActiveStaff(db, input.teacherId);
  const occurrences = generateDates(input.schedule, input.startDate, input.endDate);

  const id = db.transaction((tx) => {
    const course = tx
      .insert(courses)
      .values({
        name: input.name,
        description: input.description ?? null,
        level: input.level ?? null,
        teacherId: input.teacherId ?? null,
        room: input.room ?? null,
        capacity: input.capacity ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        color: input.color ?? null,
        status: input.status ?? 'active',
      })
      .returning({ id: courses.id })
      .get();
    if (input.schedule.length) tx.insert(courseSlots).values(input.schedule.map((s) => ({ ...s, courseId: course.id }))).run();
    if (occurrences.length) tx.insert(classSessions).values(occurrences.map((o) => ({ ...o, courseId: course.id, extra: false }))).run();
    return course.id;
  });
  return c.json(loadCourseDetail(db, id, todayISO()), 201);
});

router.get('/:id', read, (c) => {
  const detail = loadCourseDetail(c.get('db'), paramId(c), todayISO(), courseScope(currentUser(c)));
  if (!detail) throw notFound('Class not found');
  return c.json(detail);
});

router.patch('/:id', write, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const course = requireCourse(db, id, currentUser(c));
  const input = await body(c, courseUpdateInput);

  const startDate = input.startDate ?? course.startDate;
  const endDate = input.endDate ?? course.endDate;
  if (input.startDate !== undefined || input.endDate !== undefined) assertSpan(startDate, endDate);
  if (input.teacherId && input.teacherId !== course.teacherId) assertActiveStaff(db, input.teacherId);

  const storedSlots: ScheduleSlot[] = db
    .select({ weekday: courseSlots.weekday, startTime: courseSlots.startTime, endTime: courseSlots.endTime })
    .from(courseSlots)
    .where(eq(courseSlots.courseId, id))
    .all();
  const slots = input.schedule ?? storedSlots;
  const scheduleChanged = input.schedule !== undefined && !sameSchedule(input.schedule, storedSlots);
  const regenerate = scheduleChanged || startDate !== course.startDate || endDate !== course.endDate;
  const today = todayISO();

  const { schedule: _schedule, ...fields } = input;
  db.transaction((tx) => {
    if (Object.keys(fields).length) tx.update(courses).set(fields).where(eq(courses.id, id)).run();
    else if (regenerate) tx.update(courses).set({ updatedAt: Date.now() }).where(eq(courses.id, id)).run();

    if (scheduleChanged) {
      tx.delete(courseSlots).where(eq(courseSlots.courseId, id)).run();
      if (slots.length) tx.insert(courseSlots).values(slots.map((s) => ({ ...s, courseId: id }))).run();
    }
    if (!regenerate) return;

    const existing = tx
      .select({
        id: classSessions.id,
        date: classSessions.date,
        startTime: classSessions.startTime,
        endTime: classSessions.endTime,
        extra: classSessions.extra,
        // Explicit aliases: drizzle leaves columns unqualified in a single-table select.
        marked: sql<boolean>`exists (select 1 from ${attendance} a where a.session_id = "class_sessions"."id")`.mapWith((v) => Boolean(v)),
      })
      .from(classSessions)
      .where(eq(classSessions.courseId, id))
      .all();
    const plan = planRegeneration(existing, slots, { startDate, endDate, today });
    // Chunk deletes so a long course never exceeds SQLite's variable limit.
    for (let i = 0; i < plan.deleteIds.length; i += 500) {
      tx.delete(classSessions).where(inArray(classSessions.id, plan.deleteIds.slice(i, i + 500))).run();
    }
    for (const u of plan.updates) tx.update(classSessions).set({ endTime: u.endTime }).where(eq(classSessions.id, u.id)).run();
    if (plan.inserts.length) tx.insert(classSessions).values(plan.inserts.map((o) => ({ ...o, courseId: id, extra: false }))).run();
  });

  return c.json(loadCourseDetail(db, id, today));
});

router.delete('/:id', write, (c) => {
  const id = paramId(c);
  const db = c.get('db');
  requireCourse(db, id, currentUser(c));
  db.delete(courses).where(eq(courses.id, id)).run();
  return c.body(null, 204);
});

// ── Enrollments ─────────────────────────────────────────────────────────────

router.post('/:id/enrollments', write, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const course = requireCourse(db, id, currentUser(c));
  const input = await body(c, enrollmentInput);
  const student = db.select({ id: students.id }).from(students).where(eq(students.id, input.studentId)).get();
  if (!student || !canSeeStudent(db, currentUser(c), input.studentId)) throw fieldError(['studentId'], 'classes:errors.studentNotFound');
  const today = todayISO();

  const enrollmentId = db.transaction((tx) => {
    const existing = tx
      .select({ status: enrollments.status })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, id), eq(enrollments.studentId, input.studentId)))
      .get();
    if (existing?.status === 'enrolled') throw new ApiError(409, COURSE_ERROR_CODES.alreadyEnrolled, 'This student is already enrolled');
    if (existing) throw new ApiError(409, COURSE_ERROR_CODES.previouslyEnrolled, 'This student was in this class before; re-enroll them instead');
    if (course.capacity !== null && enrolledCount(tx, id) >= course.capacity) throw classFull();
    return tx
      .insert(enrollments)
      .values({ courseId: id, studentId: input.studentId, status: 'enrolled', enrolledOn: today })
      .returning({ id: enrollments.id })
      .get().id;
  });
  return c.json(loadEnrollments(db, id, today, enrollmentId)[0], 201);
});

router.patch('/:id/enrollments/:enrollmentId', write, async (c) => {
  const id = paramId(c);
  const enrollmentId = paramId(c, 'enrollmentId');
  const db = c.get('db');
  const course = requireCourse(db, id, currentUser(c));
  const input = await body(c, enrollmentUpdateInput);

  db.transaction((tx) => {
    const row = tx
      .select({ status: enrollments.status })
      .from(enrollments)
      .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.courseId, id)))
      .get();
    if (!row) throw notFound('Enrollment not found');
    if (row.status === input.status) return;
    if (input.status === 'enrolled' && course.capacity !== null && enrolledCount(tx, id) >= course.capacity) throw classFull();
    tx.update(enrollments).set({ status: input.status }).where(eq(enrollments.id, enrollmentId)).run();
  });
  return c.json(loadEnrollments(db, id, todayISO(), enrollmentId)[0]);
});

router.delete('/:id/enrollments/:enrollmentId', write, (c) => {
  const id = paramId(c);
  const enrollmentId = paramId(c, 'enrollmentId');
  const db = c.get('db');
  requireCourse(db, id, currentUser(c));
  const res = db
    .delete(enrollments)
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.courseId, id)))
    .run();
  if (res.changes === 0) throw notFound('Enrollment not found');
  return c.body(null, 204);
});

// ── Extra sessions ──────────────────────────────────────────────────────────

router.post('/:id/sessions', write, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  requireCourse(db, id, currentUser(c));
  const input = await body(c, sessionCreateInput);
  if (input.teacherId) assertActiveStaff(db, input.teacherId);

  const sessionId = db.transaction((tx) => {
    const clash = tx
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, id), eq(classSessions.date, input.date), eq(classSessions.startTime, input.startTime)))
      .get();
    if (clash) throw new ApiError(409, COURSE_ERROR_CODES.sessionExists, 'This class already has a session at that date and time');
    return tx
      .insert(classSessions)
      .values({
        courseId: id,
        date: input.date,
        startTime: input.startTime,
        endTime: input.endTime,
        room: input.room ?? null,
        teacherId: input.teacherId ?? null,
        topic: input.topic ?? null,
        status: 'scheduled',
        extra: true,
      })
      .returning({ id: classSessions.id })
      .get().id;
  });
  return c.json(loadSession(db, sessionId), 201);
});

export default router;
