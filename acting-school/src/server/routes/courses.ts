import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
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
import type { DB } from '../db/database';
import { attendance, classSessions, courseFiles, courseSlots, courses, enrollments, students } from '../db/schema';
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
import { chunk, IN_LIST_CHUNK, insertBatches } from '../lib/sqlLimits';
import { schoolToday } from '../lib/clock';
import { canSeeStudent, courseScope, isVisibleActiveStaff, type Actor } from '../lib/access';
import { addEnrollment, setEnrollmentStatus } from '../lib/enrollments';
import { ApiError, fieldError, notFound } from '../lib/errors';
import { releaseFiles } from '../lib/fileRefs';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Classes ("courses"): CRUD, weekly schedule → generated sessions, enrollments
 * and one-off extra sessions. Reading needs courses.read; everything that
 * changes a class needs courses.write. Without classes.all a person only sees
 * (and can only change) their own classes — as the course's teacher, as the
 * substitute on any of its sessions, or as the person who created it; any
 * other class is a 404.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const read = requirePermission('courses.read');
const write = requirePermission('courses.write');

export { fieldError };

/**
 * A teacher (or substitute) must be an existing, active staff account the
 * actor can see: owner accounts don't exist for non-owners, so naming one gets
 * the same answer as a missing id (otherwise ids would reveal hidden owners
 * and their names).
 */
export function assertActiveStaff(db: DB, actor: Actor, userId: number, path: (string | number)[] = ['teacherId']) {
  if (!isVisibleActiveStaff(db, actor, userId)) throw fieldError(path, 'classes:errors.teacherInvalid');
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

// ── Courses ─────────────────────────────────────────────────────────────────

router.get('/', read, (c) => {
  const q = query(c, courseListQuery);
  const filters = [
    courseScope(currentUser(c)),
    q.status ? eq(courses.status, q.status) : undefined,
    q.teacherId ? eq(courses.teacherId, q.teacherId) : undefined,
  ];
  const items: CourseListItem[] = loadCourseListItems(c.get('db'), and(...filters), schoolToday(c)).map(
    ({ description: _d, createdAt: _c, updatedAt: _u, ...item }) => item,
  );
  return c.json<ListResponse<CourseListItem>>({ items });
});

router.post('/', write, async (c) => {
  const input = await body(c, courseInput);
  const db = c.get('db');
  const me = currentUser(c);
  assertSpan(input.startDate, input.endDate);
  if (input.teacherId) assertActiveStaff(db, me, input.teacherId);
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
        createdBy: me.id,
      })
      .returning({ id: courses.id })
      .get();
    // Batched inserts: a long course has hundreds of sessions (100 bound parameters per statement, lib/sqlLimits.ts).
    for (const batch of insertBatches(courseSlots, input.schedule.map((s) => ({ ...s, courseId: course.id })))) tx.insert(courseSlots).values(batch).run();
    for (const batch of insertBatches(classSessions, occurrences.map((o) => ({ ...o, courseId: course.id, extra: false })))) {
      tx.insert(classSessions).values(batch).run();
    }
    return course.id;
  });
  return c.json(loadCourseDetail(db, id, schoolToday(c)), 201);
});

router.get('/:id', read, (c) => {
  const detail = loadCourseDetail(c.get('db'), paramId(c), schoolToday(c), courseScope(currentUser(c)));
  if (!detail) throw notFound('Class not found');
  return c.json(detail);
});

router.patch('/:id', write, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const me = currentUser(c);
  const course = requireCourse(db, id, me);
  const input = await body(c, courseUpdateInput);

  const startDate = input.startDate ?? course.startDate;
  const endDate = input.endDate ?? course.endDate;
  if (input.startDate !== undefined || input.endDate !== undefined) assertSpan(startDate, endDate);
  if (input.teacherId && input.teacherId !== course.teacherId) assertActiveStaff(db, me, input.teacherId);

  const storedSlots: ScheduleSlot[] = db
    .select({ weekday: courseSlots.weekday, startTime: courseSlots.startTime, endTime: courseSlots.endTime })
    .from(courseSlots)
    .where(eq(courseSlots.courseId, id))
    .all();
  const slots = input.schedule ?? storedSlots;
  const scheduleChanged = input.schedule !== undefined && !sameSchedule(input.schedule, storedSlots);
  const regenerate = scheduleChanged || startDate !== course.startDate || endDate !== course.endDate;
  const today = schoolToday(c);

  const { schedule: _schedule, ...fields } = input;
  db.transaction((tx) => {
    if (Object.keys(fields).length) tx.update(courses).set(fields).where(eq(courses.id, id)).run();
    else if (regenerate) tx.update(courses).set({ updatedAt: Date.now() }).where(eq(courses.id, id)).run();

    if (scheduleChanged) {
      tx.delete(courseSlots).where(eq(courseSlots.courseId, id)).run();
      for (const batch of insertBatches(courseSlots, slots.map((s) => ({ ...s, courseId: id })))) tx.insert(courseSlots).values(batch).run();
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
    // Chunked deletes and batched inserts: a long course never exceeds the bound-parameter limit (lib/sqlLimits.ts).
    for (const ids of chunk(plan.deleteIds, IN_LIST_CHUNK)) tx.delete(classSessions).where(inArray(classSessions.id, ids)).run();
    for (const u of plan.updates) tx.update(classSessions).set({ endTime: u.endTime }).where(eq(classSessions.id, u.id)).run();
    for (const batch of insertBatches(classSessions, plan.inserts.map((o) => ({ ...o, courseId: id, extra: false })))) {
      tx.insert(classSessions).values(batch).run();
    }
  });

  return c.json(loadCourseDetail(db, id, today));
});

router.delete('/:id', write, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  requireCourse(db, id, currentUser(c));
  // Its photos & files go with it (cascade); their stored files too, unless used elsewhere.
  const fileIds = db.select({ fileId: courseFiles.fileId }).from(courseFiles).where(eq(courseFiles.courseId, id)).all().map((r) => r.fileId);
  db.delete(courses).where(eq(courses.id, id)).run();
  await releaseFiles(db, c.get('files'), fileIds);
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
  const today = schoolToday(c);

  const enrollmentId = db.transaction((tx) => addEnrollment(tx, course, input.studentId, today));
  return c.json(loadEnrollments(db, id, today, enrollmentId)[0], 201);
});

router.patch('/:id/enrollments/:enrollmentId', write, async (c) => {
  const id = paramId(c);
  const enrollmentId = paramId(c, 'enrollmentId');
  const db = c.get('db');
  const course = requireCourse(db, id, currentUser(c));
  const input = await body(c, enrollmentUpdateInput);

  db.transaction((tx) => {
    if (!setEnrollmentStatus(tx, course, enrollmentId, input.status)) throw notFound('Enrollment not found');
  });
  return c.json(loadEnrollments(db, id, schoolToday(c), enrollmentId)[0]);
});

router.delete('/:id/enrollments/:enrollmentId', write, (c) => {
  const id = paramId(c);
  const enrollmentId = paramId(c, 'enrollmentId');
  const db = c.get('db');
  requireCourse(db, id, currentUser(c));
  const deleted = db
    .delete(enrollments)
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.courseId, id)))
    .returning({ id: enrollments.id })
    .get();
  if (!deleted) throw notFound('Enrollment not found');
  return c.body(null, 204);
});

// ── Extra sessions ──────────────────────────────────────────────────────────

router.post('/:id/sessions', write, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const me = currentUser(c);
  requireCourse(db, id, me);
  const input = await body(c, sessionCreateInput);
  if (input.teacherId) assertActiveStaff(db, me, input.teacherId);

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
