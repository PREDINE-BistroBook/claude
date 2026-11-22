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
  /** Auditions in the next 14 days. */
  upcomingAuditions?: Extract<ScheduleEvent, { kind: 'audition' }>[];
  /** Castings whose submission deadline is within 7 days and are still open. */
  closingCastings?: { id: number; title: string; submissionDeadline: string }[];
}
