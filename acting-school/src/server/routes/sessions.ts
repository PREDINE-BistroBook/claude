import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  COURSE_ERROR_CODES,
  MAX_SESSION_RANGE_DAYS,
  attendanceInput,
  sessionListQuery,
  sessionUpdateInput,
  type ClassSession,
} from '../../shared/schemas/courses';
import type { ListResponse } from '../../shared/schemas/common';
import { attendance, classSessions, courses, enrollments } from '../db/schema';
import type { AppEnv } from '../env';
import type { SessionUser } from '../../shared/schemas/auth';
import { courseScope } from '../lib/access';
import { daysBetween, loadSession, loadSessionDetail, loadSessions, mayMarkAttendance } from '../lib/classSessions';
import { ApiError, forbidden, notFound } from '../lib/errors';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';
import { assertActiveStaff, fieldError } from './courses';

/**
 * Dated class sessions: list by range, detail with roster, edit/cancel/delete
 * (courses.write) and attendance (attendance.write). Without classes.all a
 * person only sees sessions of the classes they teach (others are a 404) and
 * only marks attendance for sessions they teach themselves — the session's
 * substitute, else the course's teacher.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

/** A session's id and course, if this person may see it; a 404 otherwise. */
function requireVisibleSession(db: AppEnv['Variables']['db'], id: number, user: SessionUser) {
  const row = db
    .select({ id: classSessions.id })
    .from(classSessions)
    .innerJoin(courses, eq(courses.id, classSessions.courseId))
    .where(and(eq(classSessions.id, id), courseScope(user)))
    .get();
  if (!row) throw notFound('Session not found');
}

router.get('/', requirePermission('courses.read'), (c) => {
  const q = query(c, sessionListQuery);
  if (q.to < q.from) throw fieldError(['to'], 'errors.endBeforeStart');
  if (daysBetween(q.from, q.to) > MAX_SESSION_RANGE_DAYS) throw fieldError(['to'], 'errors.dateRangeTooLong');
  const items = loadSessions(
    c.get('db'),
    and(
      gte(classSessions.date, q.from),
      lte(classSessions.date, q.to),
      q.courseId ? eq(classSessions.courseId, q.courseId) : undefined,
      q.teacherId ? sql`coalesce(${classSessions.teacherId}, ${courses.teacherId}) = ${q.teacherId}` : undefined,
      courseScope(currentUser(c)),
    ),
  );
  return c.json<ListResponse<ClassSession>>({ items });
});

router.get('/:id', requirePermission('courses.read'), (c) => {
  const me = currentUser(c);
  const detail = loadSessionDetail(c.get('db'), paramId(c), me, courseScope(me));
  if (!detail) throw notFound('Session not found');
  return c.json(detail);
});

router.patch('/:id', requirePermission('courses.write'), async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  requireVisibleSession(db, id, currentUser(c));
  const session = db.select().from(classSessions).where(eq(classSessions.id, id)).get();
  if (!session) throw notFound('Session not found');
  const input = await body(c, sessionUpdateInput);

  const date = input.date ?? session.date;
  const startTime = input.startTime ?? session.startTime;
  const endTime = input.endTime ?? session.endTime;
  if (endTime <= startTime) throw fieldError(['endTime'], 'errors.endBeforeStart');
  if (input.teacherId && input.teacherId !== session.teacherId) assertActiveStaff(db, input.teacherId);

  db.transaction((tx) => {
    if (date !== session.date || startTime !== session.startTime) {
      const clash = tx
        .select({ id: classSessions.id })
        .from(classSessions)
        .where(
          and(
            eq(classSessions.courseId, session.courseId),
            eq(classSessions.date, date),
            eq(classSessions.startTime, startTime),
            ne(classSessions.id, id),
          ),
        )
        .get();
      if (clash) throw new ApiError(409, COURSE_ERROR_CODES.sessionExists, 'This class already has a session at that date and time');
    }
    if (Object.keys(input).length) tx.update(classSessions).set(input).where(eq(classSessions.id, id)).run();
  });
  return c.json(loadSession(db, id));
});

router.delete('/:id', requirePermission('courses.write'), (c) => {
  const id = paramId(c);
  const db = c.get('db');
  requireVisibleSession(db, id, currentUser(c));
  const res = db.delete(classSessions).where(eq(classSessions.id, id)).run();
  if (res.changes === 0) throw notFound('Session not found');
  return c.body(null, 204);
});

router.put('/:id/attendance', requirePermission('attendance.write'), async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const me = currentUser(c);
  requireVisibleSession(db, id, me);
  const session = loadSession(db, id);
  if (!session) throw notFound('Session not found');
  if (!mayMarkAttendance(me, session.teacherId)) throw forbidden('You can only take attendance for sessions you teach');
  const input = await body(c, attendanceInput);
  if (session.status === 'cancelled') throw new ApiError(409, COURSE_ERROR_CODES.sessionCancelled, 'This session is cancelled');

  // Everyone marked must be (or have been) enrolled in this class.
  const enrolled = new Set(
    db
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(eq(enrollments.courseId, session.courseId))
      .all()
      .map((r) => r.studentId),
  );
  const issues = input.records.flatMap((r, i) =>
    enrolled.has(r.studentId) ? [] : [{ path: ['records', i, 'studentId'], code: 'custom', message: 'classes:errors.notEnrolled' }],
  );
  if (issues.length) throw new ApiError(400, 'validation', 'Some students are not enrolled in this class', issues);

  const now = Date.now();
  db.transaction((tx) => {
    for (const r of input.records) {
      const values = { status: r.status, note: r.note ?? null, markedBy: me.id, markedAt: now };
      tx.insert(attendance)
        .values({ sessionId: id, studentId: r.studentId, ...values })
        .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: values })
        .run();
    }
  });
  return c.json(loadSessionDetail(db, id, me, courseScope(me)));
});

export default router;
