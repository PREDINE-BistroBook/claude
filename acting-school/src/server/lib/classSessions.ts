/**
 * Classes: turning a weekly schedule into dated sessions, and the read models
 * shared by the courses and sessions routes.
 *
 * The first half is pure (no database) so it can be unit-tested directly:
 *   generateDates(slots, from, to)  → every occurrence in the range
 *   planRegeneration(existing, …)   → what to delete / update / insert after a
 *                                     schedule or date change
 * The second half loads the API response shapes with a fixed number of queries
 * per request (never one per row).
 */
import { and, asc, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { addDays, parseDate, weekdayOf } from '../../shared/dates';
import type { SessionUser } from '../../shared/schemas/auth';
import type { ClassSession, CourseDetail, CourseEnrollment, CourseListItem, ScheduleSlot, SessionDetail } from '../../shared/schemas/courses';
import type { DB } from '../db/database';
import { attendance, classSessions, courseSlots, courses, enrollments, students, users } from '../db/schema';
import { mayMarkAttendance } from './access';
import { inChunks } from './sqlLimits';

export { mayMarkAttendance };

// ── Pure generation logic ───────────────────────────────────────────────────

export interface Occurrence {
  date: string;
  startTime: string;
  endTime: string;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). DST-safe. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

const occurrenceKey = (o: { date: string; startTime: string }) => `${o.date} ${o.startTime}`;

/**
 * Every dated occurrence of the weekly `slots` between `from` and `to`
 * (inclusive), sorted by date then start time. Two slots on the same weekday
 * with the same start time would collide on the sessions' unique index, so only
 * the first is kept.
 */
export function generateDates(slots: readonly ScheduleSlot[], from: string, to: string): Occurrence[] {
  if (!slots.length || to < from) return [];
  const byWeekday = new Map<number, ScheduleSlot[]>();
  for (const s of [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
    const list = byWeekday.get(s.weekday) ?? [];
    list.push(s);
    byWeekday.set(s.weekday, list);
  }
  const out: Occurrence[] = [];
  const seen = new Set<string>();
  // Walk each weekday separately: find its first date in range, then step a week.
  const firstWeekday = weekdayOf(from);
  for (const [weekday, daySlots] of byWeekday) {
    let d = addDays(from, (weekday - firstWeekday + 7) % 7);
    while (d <= to) {
      for (const s of daySlots) {
        const key = occurrenceKey({ date: d, startTime: s.startTime });
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ date: d, startTime: s.startTime, endTime: s.endTime });
      }
      d = addDays(d, 7);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/** A stored session, as far as regeneration cares. */
export interface ExistingSession {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  extra: boolean;
  /** At least one attendance mark exists. */
  marked: boolean;
}

export interface RegenerationPlan {
  deleteIds: number[];
  /** Kept sessions whose slot now ends at a different time. */
  updates: { id: number; endTime: string }[];
  inserts: Occurrence[];
}

/**
 * After a course's schedule or dates change, work out how to bring its
 * generated sessions in line. Rules:
 * - sessions with attendance marks and one-off extras are never touched;
 * - generated sessions now outside [startDate, endDate] are deleted;
 * - past generated sessions inside the range are left alone (history);
 * - upcoming (date ≥ today) generated sessions that no longer match the
 *   schedule are deleted; ones that still match are kept (so their topic,
 *   notes, room/teacher override or cancellation survive), with the end time
 *   brought in line with the slot;
 * - missing occurrences from max(today, startDate) to endDate are inserted,
 *   skipping any date + start time already taken by a kept session.
 */
export function planRegeneration(
  existing: readonly ExistingSession[],
  slots: readonly ScheduleSlot[],
  range: { startDate: string; endDate: string; today: string },
): RegenerationPlan {
  const { startDate, endDate, today } = range;
  const from = today > startDate ? today : startDate;
  const wanted = generateDates(slots, from, endDate);
  const wantedByKey = new Map(wanted.map((o) => [occurrenceKey(o), o]));
  const taken = new Set<string>();
  const plan: RegenerationPlan = { deleteIds: [], updates: [], inserts: [] };

  for (const s of existing) {
    const key = occurrenceKey(s);
    if (s.extra || s.marked) {
      taken.add(key);
      continue;
    }
    if (s.date < startDate || s.date > endDate) {
      plan.deleteIds.push(s.id);
      continue;
    }
    if (s.date < today) {
      taken.add(key);
      continue;
    }
    const match = wantedByKey.get(key);
    if (match) {
      taken.add(key);
      if (match.endTime !== s.endTime) plan.updates.push({ id: s.id, endTime: match.endTime });
    } else {
      plan.deleteIds.push(s.id);
    }
  }
  plan.inserts = wanted.filter((o) => !taken.has(occurrenceKey(o)));
  return plan;
}

/** Same weekly schedule? (order-insensitive) */
export function sameSchedule(a: readonly ScheduleSlot[], b: readonly ScheduleSlot[]): boolean {
  const norm = (xs: readonly ScheduleSlot[]) =>
    xs
      .map((s) => `${s.weekday}|${s.startTime}|${s.endTime}`)
      .sort()
      .join(',');
  return norm(a) === norm(b);
}

// ── Read models ─────────────────────────────────────────────────────────────

const nocase = (col: AnyColumn) => sql`${col} collate nocase`;

/** Effective teacher / room of a session: its own override, else the course's. */
const effectiveTeacherId = sql<number | null>`coalesce(${classSessions.teacherId}, ${courses.teacherId})`;
const effectiveRoom = sql<string | null>`coalesce(${classSessions.room}, ${courses.room})`;

/**
 * Sessions joined with their course and effective teacher.
 * `where` filters (on class_sessions / courses columns); sorted by date, time, course.
 */
export function loadSessions(db: DB, where?: SQL): ClassSession[] {
  return db
    .select({
      id: classSessions.id,
      courseId: classSessions.courseId,
      courseName: courses.name,
      color: courses.color,
      date: classSessions.date,
      startTime: classSessions.startTime,
      endTime: classSessions.endTime,
      room: effectiveRoom,
      teacherId: effectiveTeacherId,
      teacherName: users.name,
      status: classSessions.status,
      extra: classSessions.extra,
      topic: classSessions.topic,
      notes: classSessions.notes,
      attendanceTaken: sql<boolean>`exists (select 1 from ${attendance} a where a.session_id = "class_sessions"."id")`.mapWith(
        (v) => Boolean(v),
      ),
    })
    .from(classSessions)
    .innerJoin(courses, eq(courses.id, classSessions.courseId))
    .leftJoin(users, eq(users.id, effectiveTeacherId))
    .where(where)
    .orderBy(asc(classSessions.date), asc(classSessions.startTime), nocase(courses.name))
    .all();
}

export function loadSession(db: DB, id: number): ClassSession | null {
  return loadSessions(db, eq(classSessions.id, id))[0] ?? null;
}

/**
 * The session, its roster (enrolled by that date + anyone already marked) and
 * whether `user` may mark it. `scope` limits which sessions count as found
 * (e.g. courseScope for someone who only sees their own classes).
 */
export function loadSessionDetail(db: DB, id: number, user: Pick<SessionUser, 'id' | 'permissions'>, scope?: SQL): SessionDetail | null {
  const session = loadSessions(db, and(eq(classSessions.id, id), scope))[0];
  if (!session) return null;
  const roster = db
    .select({
      studentId: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      photoFileId: students.photoFileId,
      status: attendance.status,
      note: attendance.note,
    })
    .from(students)
    .leftJoin(attendance, and(eq(attendance.studentId, students.id), eq(attendance.sessionId, id)))
    .where(
      sql`${students.id} in (
        select ${enrollments.studentId} from ${enrollments}
        where ${enrollments.courseId} = ${session.courseId}
          and ${enrollments.status} = 'enrolled'
          and ${enrollments.enrolledOn} <= ${session.date}
        union
        select ${attendance.studentId} from ${attendance} where ${attendance.sessionId} = ${id}
      )`,
    )
    .orderBy(nocase(students.lastName), nocase(students.firstName), asc(students.id))
    .all();
  return {
    ...session,
    roster,
    canMarkAttendance: session.status !== 'cancelled' && mayMarkAttendance(user, session.teacherId),
  };
}

/** Weekly slots per course id, sorted by weekday then start time. */
function loadSlots(db: DB, courseIds: number[]): Map<number, ScheduleSlot[]> {
  const out = new Map<number, ScheduleSlot[]>();
  if (!courseIds.length) return out;
  // In slices: a school can have more classes than one IN (…) may hold (lib/sqlLimits.ts). Order is per course.
  const rows = inChunks(courseIds, (ids) =>
    db
      .select({ courseId: courseSlots.courseId, weekday: courseSlots.weekday, startTime: courseSlots.startTime, endTime: courseSlots.endTime })
      .from(courseSlots)
      .where(inArray(courseSlots.courseId, ids))
      .orderBy(asc(courseSlots.weekday), asc(courseSlots.startTime), asc(courseSlots.id))
      .all(),
  );
  for (const { courseId, ...slot } of rows) {
    const list = out.get(courseId) ?? [];
    list.push(slot);
    out.set(courseId, list);
  }
  return out;
}

/** Earliest scheduled session on or after `today`, per course id (one query, window function). */
function loadNextSessions(db: DB, courseIds: number[], today: string): Map<number, CourseListItem['nextSession']> {
  const out = new Map<number, CourseListItem['nextSession']>();
  if (!courseIds.length) return out;
  // In slices of courses (lib/sqlLimits.ts); the window is per course, so slicing changes nothing.
  const rows = inChunks(courseIds, (ids) =>
    db.all<{ courseId: number; id: number; date: string; startTime: string }>(sql`
      select course_id as courseId, id, date, start_time as startTime from (
        select s.course_id, s.id, s.date, s.start_time,
          row_number() over (partition by s.course_id order by s.date, s.start_time) as rn
        from ${classSessions} s
        where s.status = 'scheduled' and s.date >= ${today}
          and s.course_id in (${sql.join(
            ids.map((cid) => sql`${cid}`),
            sql`, `,
          )})
      ) where rn = 1
    `),
  );
  for (const r of rows) out.set(r.courseId, { id: r.id, date: r.date, startTime: r.startTime });
  return out;
}

/**
 * Courses as list items: teacher name (join), enrolled count (correlated count),
 * slots and next session (one query each for the whole page).
 * Sorted active first, then by name.
 */
export function loadCourseListItems(db: DB, where: SQL | undefined, today: string): (CourseListItem & { description: string | null; createdAt: number; updatedAt: number })[] {
  const rows = db
    .select({
      id: courses.id,
      name: courses.name,
      description: courses.description,
      level: courses.level,
      teacherId: courses.teacherId,
      teacherName: users.name,
      room: courses.room,
      capacity: courses.capacity,
      startDate: courses.startDate,
      endDate: courses.endDate,
      color: courses.color,
      status: courses.status,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      enrolledCount: sql<number>`(select count(*) from ${enrollments} where ${enrollments.courseId} = ${courses.id} and ${enrollments.status} = 'enrolled')`.mapWith(
        Number,
      ),
    })
    .from(courses)
    .leftJoin(users, eq(users.id, courses.teacherId))
    .where(where)
    .orderBy(sql`case ${courses.status} when 'active' then 0 else 1 end`, nocase(courses.name), asc(courses.id))
    .all();
  const ids = rows.map((r) => r.id);
  const slots = loadSlots(db, ids);
  const next = loadNextSessions(db, ids, today);
  return rows.map((r) => ({ ...r, schedule: slots.get(r.id) ?? [], nextSession: next.get(r.id) ?? null }));
}

/**
 * Enrollments of a course with student names and attendance rate. The rate is
 * present + late over the course's scheduled (not cancelled) sessions dated
 * from the enrolment day up to and including today; null when none yet.
 */
export function loadEnrollments(db: DB, courseId: number, today: string, enrollmentId?: number): CourseEnrollment[] {
  const heldFilter = sql`s.course_id = e.course_id and s.status = 'scheduled' and s.date <= ${today} and s.date >= e.enrolled_on`;
  const rows = db.all<{
    id: number;
    studentId: number;
    firstName: string;
    lastName: string;
    photoFileId: string | null;
    status: CourseEnrollment['status'];
    enrolledOn: string;
    held: number;
    attended: number;
  }>(sql`
    select e.id, e.student_id as studentId, st.first_name as firstName, st.last_name as lastName,
      st.photo_file_id as photoFileId, e.status, e.enrolled_on as enrolledOn,
      (select count(*) from ${classSessions} s where ${heldFilter}) as held,
      (select count(*) from ${attendance} a join ${classSessions} s on s.id = a.session_id
        where a.student_id = e.student_id and a.status in ('present', 'late') and ${heldFilter}) as attended
    from ${enrollments} e
    join ${students} st on st.id = e.student_id
    where e.course_id = ${courseId} ${enrollmentId ? sql`and e.id = ${enrollmentId}` : sql``}
    order by case e.status when 'enrolled' then 0 when 'completed' then 1 else 2 end,
      st.last_name collate nocase, st.first_name collate nocase, e.id
  `);
  return rows.map(({ held, attended, ...r }) => ({ ...r, attendanceRate: held > 0 ? attended / held : null }));
}

/** The course with enrollments and sessions; null when missing or outside `scope`. */
export function loadCourseDetail(db: DB, id: number, today: string, scope?: SQL): CourseDetail | null {
  const course = loadCourseListItems(db, and(eq(courses.id, id), scope), today)[0];
  if (!course) return null;
  return {
    ...course,
    enrollments: loadEnrollments(db, id, today),
    sessions: loadSessions(db, eq(classSessions.courseId, id)),
  };
}
