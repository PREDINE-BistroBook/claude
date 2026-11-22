import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  COURSE_COLORS,
  COURSE_LEVELS,
  COURSE_STATUSES,
  ENROLLMENT_STATUSES,
  SESSION_STATUSES,
  type AttendanceStatus,
  type CourseColor,
  type CourseLevel,
  type CourseStatus,
  type EnrollmentStatus,
  type SessionStatus,
} from '../enums';
import { dateStr, id, optEnum, optId, optInt, optText, reqText, timeStr } from './common';

/** One weekly time slot of a class, e.g. every Tuesday 18:00–20:00. */
export const scheduleSlot = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeStr,
    endTime: timeStr,
  })
  .refine((s) => s.endTime > s.startTime, { message: 'errors.endBeforeStart', path: ['endTime'] });
export type ScheduleSlot = z.infer<typeof scheduleSlot>;

const courseFields = z.object({
  name: reqText(150),
  description: optText(5000),
  level: optEnum(COURSE_LEVELS),
  teacherId: optId,
  room: optText(100),
  capacity: optInt(1, 1000),
  startDate: dateStr,
  endDate: dateStr,
  color: optEnum(COURSE_COLORS),
  /** Defaults to 'active' on create. */
  status: z.enum(COURSE_STATUSES).optional(),
  /** Weekly slots. Sessions are generated from these between startDate and endDate. */
  schedule: z.array(scheduleSlot).max(14),
});

export const courseInput = courseFields.refine((c) => c.endDate >= c.startDate, {
  message: 'errors.endBeforeStart',
  path: ['endDate'],
});
export type CourseInput = z.infer<typeof courseInput>;
/** PATCH: the date-order rule is checked against the stored values in the route. */
export const courseUpdateInput = courseFields.partial();

export const enrollmentInput = z.object({ studentId: id });
export const enrollmentUpdateInput = z.object({ status: z.enum(ENROLLMENT_STATUSES) });

/** POST /api/courses/:id/sessions — a one-off extra session. */
export const sessionCreateInput = z
  .object({
    date: dateStr,
    startTime: timeStr,
    endTime: timeStr,
    room: optText(100),
    teacherId: optId,
    topic: optText(200),
  })
  .refine((s) => s.endTime > s.startTime, { message: 'errors.endBeforeStart', path: ['endTime'] });

/** PATCH /api/sessions/:id */
export const sessionUpdateInput = z
  .object({
    date: dateStr,
    startTime: timeStr,
    endTime: timeStr,
    room: optText(100),
    teacherId: optId,
    status: z.enum(SESSION_STATUSES),
    topic: optText(200),
    notes: optText(5000),
  })
  .partial();

/** PUT /api/sessions/:id/attendance — replaces the marks for the listed students. */
export const attendanceInput = z.object({
  records: z
    .array(
      z.object({
        studentId: id,
        status: z.enum(ATTENDANCE_STATUSES),
        note: optText(500),
      }),
    )
    .max(500),
});

export const sessionListQuery = z.object({
  from: dateStr,
  to: dateStr,
  courseId: id.optional(),
  teacherId: id.optional(),
});

/** GET /api/courses → { items: CourseListItem[] } */
export interface CourseListItem {
  id: number;
  name: string;
  level: CourseLevel | null;
  teacherId: number | null;
  teacherName: string | null;
  room: string | null;
  capacity: number | null;
  startDate: string;
  endDate: string;
  color: CourseColor | null;
  status: CourseStatus;
  schedule: ScheduleSlot[];
  enrolledCount: number;
  nextSession: { id: number; date: string; startTime: string } | null;
}

export interface CourseEnrollment {
  id: number;
  studentId: number;
  firstName: string;
  lastName: string;
  photoFileId: string | null;
  status: EnrollmentStatus;
  enrolledOn: string;
  /** Present + late over sessions held (past, not cancelled) since enrolment; null if none held yet. */
  attendanceRate: number | null;
}

/** GET /api/courses/:id */
export interface CourseDetail extends CourseListItem {
  description: string | null;
  enrollments: CourseEnrollment[];
  sessions: ClassSession[];
  createdAt: number;
  updatedAt: number;
}

/** A dated occurrence of a class. GET /api/sessions?from&to → { items: ClassSession[] } */
export interface ClassSession {
  id: number;
  courseId: number;
  courseName: string;
  color: CourseColor | null;
  date: string;
  startTime: string;
  endTime: string;
  /** Session override, else the course's room. */
  room: string | null;
  /** Session override (substitute), else the course's teacher. */
  teacherId: number | null;
  teacherName: string | null;
  status: SessionStatus;
  /** One-off session added by hand (not from the weekly schedule). */
  extra: boolean;
  topic: string | null;
  notes: string | null;
  /** True once at least one attendance mark exists. */
  attendanceTaken: boolean;
}

/** GET /api/sessions/:id — the session plus everyone enrolled, with their mark. */
export interface SessionDetail extends ClassSession {
  roster: {
    studentId: number;
    firstName: string;
    lastName: string;
    photoFileId: string | null;
    status: AttendanceStatus | null;
    note: string | null;
  }[];
  /** Whether the current user may mark attendance for this session. */
  canMarkAttendance: boolean;
}
