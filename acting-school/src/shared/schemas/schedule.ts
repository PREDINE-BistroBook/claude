import { z } from 'zod';
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
