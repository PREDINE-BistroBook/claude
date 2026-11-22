import type { ClassSession } from './courses';
import type { ScheduleEvent } from './schedule';

/**
 * GET /api/dashboard — shaped by role: sections the caller can't access are
 * omitted (undefined), not empty. Teachers get their own sessions only.
 */
export interface DashboardData {
  today: string;
  counts: {
    activeStudents?: number;
    activeCourses?: number;
    activeTalent?: number;
    openCastings?: number;
  };
  /** Today's class sessions (teacher: only theirs). */
  todaySessions?: ClassSession[];
  /** Past sessions in the last 14 days with no attendance yet (teacher: only theirs). */
  attendanceToDo?: ClassSession[];
  /** (Added) Total sessions needing attendance before the ATTENDANCE_TODO_MAX cap; present exactly when attendanceToDo is. */
  attendanceToDoCount?: number;
  /** Auditions in the next 14 days. */
  upcomingAuditions?: Extract<ScheduleEvent, { kind: 'audition' }>[];
  /** Castings whose submission deadline is within 7 days and are still open. */
  closingCastings?: { id: number; title: string; submissionDeadline: string }[];
}

// ── Additions (dashboard module) ────────────────────────────────────────────

/**
 * Windows and caps behind GET /api/dashboard (all dates school-local, inclusive):
 * - attendanceToDo: scheduled sessions dated today − 14 … today (today's only once
 *   they have ended), with no marks yet and at least one student enrolled on or
 *   before the session date; newest first, at most ATTENDANCE_TODO_MAX.
 * - upcomingAuditions: auditionAt dated today … today + 14, status not
 *   withdrawn/rejected; soonest first, at most UPCOMING_AUDITIONS_MAX.
 * - closingCastings: open castings with submissionDeadline today … today + 7.
 */
export const ATTENDANCE_TODO_LOOKBACK_DAYS = 14;
export const ATTENDANCE_TODO_MAX = 10;
export const UPCOMING_AUDITIONS_DAYS = 14;
export const UPCOMING_AUDITIONS_MAX = 10;
export const CLOSING_CASTINGS_DAYS = 7;

export type DashboardAudition = NonNullable<DashboardData['upcomingAuditions']>[number];
export type ClosingCasting = NonNullable<DashboardData['closingCastings']>[number];
