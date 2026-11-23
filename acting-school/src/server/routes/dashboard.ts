import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { addDays, startOfWeek } from '../../shared/dates';
import type { ClassSession } from '../../shared/schemas/courses';
import {
  ATTENDANCE_TODO_LOOKBACK_DAYS,
  ATTENDANCE_TODO_MAX,
  CLOSING_CASTINGS_DAYS,
  FOLLOW_UPS_DUE_MAX,
  UPCOMING_AUDITIONS_DAYS,
  UPCOMING_AUDITIONS_MAX,
  UPCOMING_INTERVIEWS_DAYS,
  UPCOMING_INTERVIEWS_MAX,
  type DashboardData,
} from '../../shared/schemas/dashboard';
import type { DB } from '../db/database';
import { attendance, castingApplications, castings, classSessions, courses, enrollments, leads, students, talent, users } from '../db/schema';
import type { AppEnv } from '../env';
import { epochAt, schoolNowTime, schoolToday } from '../lib/clock';
import { courseScope, seesAllClasses, studentScope, takesAttendance } from '../lib/access';
import { followUpDue, leadIsOpen, loadInterviewEvents, loadLeadListItems } from '../lib/admissions';
import { getSettings } from '../lib/settings';
import { currentUser, requireAuth, userCan } from '../middleware/auth';
import { loadAuditionEvents } from './schedule';

/**
 * Home screen data, shaped by permissions: a section the caller can't see is
 * left out of the JSON entirely (not sent empty) — except the two website
 * counts (newWebsiteLeads: admissions.read, newCastingApplications:
 * talent.read), always present and null when not permitted. Admissions blocks (open and
 * new-this-week lead counts, follow-ups due, upcoming interviews) need
 * admissions.read. Without classes.all the
 * counts cover only the classes you teach (and their students), and the
 * session lists only the sessions you teach yourself (your substitute sessions
 * included, ones handed to a substitute excluded).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const effectiveTeacherId = sql<number | null>`coalesce(${classSessions.teacherId}, ${courses.teacherId})`;
const effectiveRoom = sql<string | null>`coalesce(${classSessions.room}, ${courses.room})`;
const hasMarks = sql`exists (select 1 from ${attendance} where ${attendance.sessionId} = ${classSessions.id})`;

/** Sessions in the shared ClassSession shape, filtered by `where`, in the given order. */
function loadClassSessions(db: DB, where: SQL | undefined, order: SQL[]): ClassSession[] {
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
      attendanceTaken: sql<boolean>`${hasMarks}`.mapWith((v) => Boolean(v)),
    })
    .from(classSessions)
    .innerJoin(courses, eq(courses.id, classSessions.courseId))
    .leftJoin(users, eq(users.id, effectiveTeacherId))
    .where(where)
    .orderBy(...order)
    .all();
}

const countWhere = (db: DB, table: typeof students | typeof courses | typeof talent | typeof castings | typeof leads | typeof castingApplications, where: SQL) =>
  db.select({ n: count() }).from(table).where(where).get()?.n ?? 0;

router.get('/', (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const today = schoolToday(c);
  const now = schoolNowTime(c);
  // Without classes.all: only your own teaching — the substitute if set, else the course's teacher.
  const mine = seesAllClasses(me) ? undefined : sql`${effectiveTeacherId} = ${me.id}`;

  const data: DashboardData = {
    today,
    counts: {
      // The website's new arrivals (section homes): null when the caller may not see them.
      newWebsiteLeads: userCan(c, 'admissions.read') ? countWhere(db, leads, and(eq(leads.source, 'website'), eq(leads.status, 'new'))!) : null,
      newCastingApplications: userCan(c, 'talent.read') ? countWhere(db, castingApplications, eq(castingApplications.status, 'new')) : null,
    },
  };

  if (userCan(c, 'students.read')) data.counts.activeStudents = countWhere(db, students, and(eq(students.status, 'active'), studentScope(me))!);
  if (userCan(c, 'courses.read')) data.counts.activeCourses = countWhere(db, courses, and(eq(courses.status, 'active'), courseScope(me))!);
  if (userCan(c, 'talent.read')) data.counts.activeTalent = countWhere(db, talent, eq(talent.status, 'active'));
  if (userCan(c, 'castings.read')) data.counts.openCastings = countWhere(db, castings, eq(castings.status, 'open'));

  if (userCan(c, 'courses.read')) {
    data.todaySessions = loadClassSessions(db, and(eq(classSessions.date, today), mine), [
      asc(classSessions.startTime),
      asc(classSessions.endTime),
      sql`${courses.name} collate nocase`,
      asc(classSessions.id),
    ]);
  }

  if (takesAttendance(me)) {
    // Bounded by the 15-day window, so fetching the whole set to count it is cheap.
    const todo = loadClassSessions(
      db,
      and(
        eq(classSessions.status, 'scheduled'),
        gte(classSessions.date, addDays(today, -ATTENDANCE_TODO_LOOKBACK_DAYS)),
        sql`(${classSessions.date} < ${today} or (${classSessions.date} = ${today} and ${classSessions.endTime} <= ${now}))`,
        sql`not ${hasMarks}`,
        // Someone to mark: a student enrolled in the class by the session date (the roster's rule).
        sql`exists (select 1 from ${enrollments} where ${enrollments.courseId} = ${classSessions.courseId}
          and ${enrollments.status} = 'enrolled' and ${enrollments.enrolledOn} <= ${classSessions.date})`,
        mine,
      ),
      [desc(classSessions.date), desc(classSessions.startTime), asc(classSessions.id)],
    );
    data.attendanceToDo = todo.slice(0, ATTENDANCE_TODO_MAX);
    data.attendanceToDoCount = todo.length;
  }

  if (userCan(c, 'castings.read')) {
    data.upcomingAuditions = loadAuditionEvents(db, {
      from: today,
      to: addDays(today, UPCOMING_AUDITIONS_DAYS),
      excludeStatuses: ['withdrawn', 'rejected'],
      limit: UPCOMING_AUDITIONS_MAX,
    });
    data.closingCastings = db
      .select({ id: castings.id, title: castings.title, submissionDeadline: sql<string>`${castings.submissionDeadline}` })
      .from(castings)
      .where(
        and(
          eq(castings.status, 'open'),
          gte(castings.submissionDeadline, today),
          lte(castings.submissionDeadline, addDays(today, CLOSING_CASTINGS_DAYS)),
        ),
      )
      .orderBy(asc(castings.submissionDeadline), sql`${castings.title} collate nocase`, asc(castings.id))
      .all();
  }

  if (userCan(c, 'admissions.read')) {
    data.counts.openLeads = countWhere(db, leads, leadIsOpen);
    // Since midnight at the school (its time zone, not the runtime's: Workers run in UTC) on the
    // first day of this week (the school's week start).
    const weekStart = epochAt(c.get('config').timeZone, startOfWeek(today, getSettings(db).weekStartsOn));
    data.counts.newLeadsThisWeek = countWhere(db, leads, gte(leads.createdAt, weekStart));
    data.followUpsDue = loadLeadListItems(db, followUpDue(today), {
      // Most overdue first.
      order: [asc(leads.nextFollowUpOn), asc(leads.createdAt), asc(leads.id)],
      limit: FOLLOW_UPS_DUE_MAX,
    });
    data.followUpsDueCount = countWhere(db, leads, followUpDue(today)!);
    data.upcomingInterviews = loadInterviewEvents(db, {
      from: today,
      to: addDays(today, UPCOMING_INTERVIEWS_DAYS),
      statuses: ['scheduled'],
      limit: UPCOMING_INTERVIEWS_MAX,
    });
  }

  return c.json(data);
});

export default router;
