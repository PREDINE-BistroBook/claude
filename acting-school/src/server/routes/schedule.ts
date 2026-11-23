import { and, asc, eq, gte, isNotNull, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { splitDateTime } from '../../shared/dates';
import type { SubmissionStatus } from '../../shared/enums';
import type { ListResponse } from '../../shared/schemas/common';
import { scheduleRangeQuery, type AuditionEvent, type ClassEvent, type ScheduleEvent } from '../../shared/schemas/schedule';
import type { DB } from '../db/database';
import { castingRoles, castings, classSessions, courses, enrollments, submissions, talent, users } from '../db/schema';
import type { AppEnv } from '../env';
import { courseScope } from '../lib/access';
import { loadInterviewEvents } from '../lib/admissions';
import { query } from '../lib/validate';
import { currentUser, requireAuth, userCan } from '../middleware/auth';

/**
 * The combined calendar: class sessions (courses.read; without classes.all only
 * sessions of the classes you teach), auditions (castings.read) and admissions
 * interviews (admissions.read; cancelled ones left out) in one date range.
 * Reads the other modules' tables directly; nothing here writes.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

/** A session's own room / substitute teacher, else the course's. */
const effectiveTeacherId = sql<number | null>`coalesce(${classSessions.teacherId}, ${courses.teacherId})`;
const effectiveRoom = sql<string | null>`coalesce(${classSessions.room}, ${courses.room})`;

/** Stage name when set, else "First Last". */
export const talentDisplayName = sql<string>`coalesce(nullif(trim(${talent.stageName}), ''), ${talent.firstName} || ' ' || ${talent.lastName})`;

/** Every class session dated from…to (cancelled ones too), with its course's enrolled count; `scope` filters courses. */
export function loadClassEvents(db: DB, from: string, to: string, scope?: SQL): ClassEvent[] {
  // One grouped count per course, joined once — not a count per session row.
  const enrolled = db
    .select({ courseId: enrollments.courseId, n: sql<number>`count(*)`.as('n') })
    .from(enrollments)
    .where(eq(enrollments.status, 'enrolled'))
    .groupBy(enrollments.courseId)
    .as('enrolled');
  const rows = db
    .select({
      id: classSessions.id,
      courseId: classSessions.courseId,
      title: courses.name,
      color: courses.color,
      date: classSessions.date,
      startTime: classSessions.startTime,
      endTime: classSessions.endTime,
      room: effectiveRoom,
      teacherId: effectiveTeacherId,
      teacherName: users.name,
      status: classSessions.status,
      enrolledCount: sql<number>`coalesce(${enrolled.n}, 0)`.mapWith(Number),
    })
    .from(classSessions)
    .innerJoin(courses, eq(courses.id, classSessions.courseId))
    .leftJoin(users, eq(users.id, effectiveTeacherId))
    .leftJoin(enrolled, eq(enrolled.courseId, classSessions.courseId))
    .where(and(gte(classSessions.date, from), lte(classSessions.date, to), scope))
    .orderBy(asc(classSessions.date), asc(classSessions.startTime), asc(classSessions.id))
    .all();
  return rows.map((r) => ({ kind: 'class' as const, ...r }));
}

/**
 * Submissions with an audition dated from…to (inclusive), excluding the given
 * statuses; soonest first. `limit` caps the rows (dashboard).
 */
export function loadAuditionEvents(
  db: DB,
  opts: { from: string; to: string; excludeStatuses: SubmissionStatus[]; limit?: number },
): AuditionEvent[] {
  const q = db
    .select({
      id: submissions.id,
      castingId: castingRoles.castingId,
      title: castings.title,
      roleName: castingRoles.name,
      talentId: talent.id,
      talentName: talentDisplayName,
      auditionAt: submissions.auditionAt,
      location: submissions.auditionLocation,
      status: submissions.status,
    })
    .from(submissions)
    .innerJoin(castingRoles, eq(castingRoles.id, submissions.roleId))
    .innerJoin(castings, eq(castings.id, castingRoles.castingId))
    .innerJoin(talent, eq(talent.id, submissions.talentId))
    .where(
      and(
        isNotNull(submissions.auditionAt),
        // "YYYY-MM-DDTHH:MM" sorts as text, so whole days are a plain range (uses the audition index).
        gte(submissions.auditionAt, `${opts.from}T00:00`),
        lte(submissions.auditionAt, `${opts.to}T23:59`),
        opts.excludeStatuses.length ? notInArray(submissions.status, opts.excludeStatuses) : undefined,
      ),
    )
    .orderBy(asc(submissions.auditionAt), asc(submissions.id));
  const rows = opts.limit ? q.limit(opts.limit).all() : q.all();
  return rows.map(({ auditionAt, ...r }) => {
    const { date, time } = splitDateTime(auditionAt!);
    return {
      kind: 'audition' as const,
      id: r.id,
      castingId: r.castingId,
      title: r.title,
      roleName: r.roleName,
      talentId: r.talentId,
      talentName: r.talentName,
      date,
      startTime: time,
      location: r.location,
      status: r.status,
    };
  });
}

const KIND_ORDER: Record<ScheduleEvent['kind'], number> = { class: 0, interview: 1, audition: 2 };

/** Date, then start time; at the same minute classes, then interviews, then auditions; then by title. */
export function compareEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  return (
    a.date.localeCompare(b.date) ||
    a.startTime.localeCompare(b.startTime) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.title.localeCompare(b.title) ||
    a.id - b.id
  );
}

router.get('/', (c) => {
  const { from, to } = query(c, scheduleRangeQuery);
  const db = c.get('db');
  const items: ScheduleEvent[] = [];
  if (userCan(c, 'courses.read')) items.push(...loadClassEvents(db, from, to, courseScope(currentUser(c))));
  if (userCan(c, 'castings.read')) items.push(...loadAuditionEvents(db, { from, to, excludeStatuses: ['withdrawn'] }));
  if (userCan(c, 'admissions.read')) items.push(...loadInterviewEvents(db, { from, to, excludeStatuses: ['cancelled'] }));
  items.sort(compareEvents);
  return c.json<ListResponse<ScheduleEvent>>({ items });
});

export default router;
