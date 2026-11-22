/** Fixed value lists shared by the database, the API validation and the UI. */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const GENDERS = ['female', 'male', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const STUDENT_STATUSES = ['prospect', 'active', 'paused', 'alumni'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const COURSE_LEVELS = ['beginner', 'intermediate', 'advanced', 'all_levels'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const COURSE_STATUSES = ['active', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** Keys into the course colour palette (src/web/lib/colors.ts). */
export const COURSE_COLORS = ['crimson', 'amber', 'emerald', 'sky', 'violet', 'teal', 'orange', 'slate'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];

export const ENROLLMENT_STATUSES = ['enrolled', 'withdrawn', 'completed'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const SESSION_STATUSES = ['scheduled', 'cancelled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const TALENT_STATUSES = ['active', 'on_hold', 'former'] as const;
export type TalentStatus = (typeof TALENT_STATUSES)[number];

export const CASTING_TYPES = ['film', 'tv', 'commercial', 'theatre', 'music_video', 'voice', 'other'] as const;
export type CastingType = (typeof CASTING_TYPES)[number];

export const CASTING_STATUSES = ['open', 'closed', 'cancelled'] as const;
export type CastingStatus = (typeof CASTING_STATUSES)[number];

/**
 * A talent's journey on one casting role. `shortlisted` is internal (not yet
 * sent to the casting director); `booked`, `rejected` and `withdrawn` are final.
 */
export const SUBMISSION_STATUSES = ['shortlisted', 'submitted', 'audition', 'callback', 'booked', 'rejected', 'withdrawn'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** 0 = Sunday … 6 = Saturday (same as Date#getDay). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];
