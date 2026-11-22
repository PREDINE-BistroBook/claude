import { z } from 'zod';
import { parseDate } from '../dates';
import type { CourseColor, SessionStatus, SubmissionStatus } from '../enums';
import { dateStr } from './common';

export const scheduleQuery = z
  .object({ from: dateStr, to: dateStr })
  .refine((q) => q.to >= q.from, { message: 'errors.endBeforeStart', path: ['to'] });

/**
 * GET /api/schedule?from&to → { items: ScheduleEvent[] }, sorted by date then time.
 * Classes are visible to every role with courses.read; auditions only to roles
 * with castings.read (teachers never see them).
 */
export type ScheduleEvent =
  | {
      kind: 'class';
      /** class session id */
      id: number;
      courseId: number;
      title: string;
      color: CourseColor | null;
      date: string;
      startTime: string;
      endTime: string;
      room: string | null;
      teacherId: number | null;
      teacherName: string | null;
      status: SessionStatus;
      enrolledCount: number;
    }
  | {
      kind: 'audition';
      /** submission id */
      id: number;
      castingId: number;
      title: string;
      roleName: string;
      talentId: number;
      talentName: string;
      date: string;
      startTime: string;
      location: string | null;
      status: SubmissionStatus;
    };

// ── Additions (schedule module) ─────────────────────────────────────────────

/** GET /api/schedule answers at most this many days (to − from) at once. */
export const MAX_SCHEDULE_RANGE_DAYS = 62;

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). DST-safe. */
export function daySpan(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

/**
 * What GET /api/schedule validates: scheduleQuery plus the range limit
 * (a 400 issue on 'to' with 'errors.dateRangeTooLong').
 */
export const scheduleRangeQuery = scheduleQuery.refine((q) => daySpan(q.from, q.to) <= MAX_SCHEDULE_RANGE_DAYS, {
  message: 'errors.dateRangeTooLong',
  path: ['to'],
});
export type ScheduleQuery = z.infer<typeof scheduleQuery>;

export type ClassEvent = Extract<ScheduleEvent, { kind: 'class' }>;
export type AuditionEvent = Extract<ScheduleEvent, { kind: 'audition' }>;

/** Filter on the schedule screen (?show=). 'auditions' and 'all' need castings.read. */
export const SCHEDULE_FILTERS = ['all', 'classes', 'auditions'] as const;
export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number];
