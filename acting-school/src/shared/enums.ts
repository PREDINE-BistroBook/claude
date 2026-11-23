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

// ── Admissions ──────────────────────────────────────────────────────────────

/** Where an enquiry (lead) came from. */
export const LEAD_SOURCES = [
  'whatsapp',
  'phone_call',
  'email',
  'walk_in',
  'instagram',
  'facebook',
  'tiktok',
  'referral',
  'google_form',
  'website',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * A lead's journey: new → contacted → interview_scheduled → interviewed →
 * accepted → enrolled. `enrolled`, `declined` and `lost` close the lead.
 */
export const LEAD_STATUSES = ['new', 'contacted', 'interview_scheduled', 'interviewed', 'accepted', 'enrolled', 'declined', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Statuses that still need someone to act (follow-ups apply only to these). */
export const OPEN_LEAD_STATUSES = ['new', 'contacted', 'interview_scheduled', 'interviewed', 'accepted'] as const satisfies readonly LeadStatus[];
/** Closed leads have no follow-up date. */
export const CLOSED_LEAD_STATUSES = ['enrolled', 'declined', 'lost'] as const satisfies readonly LeadStatus[];

export function isClosedLeadStatus(status: LeadStatus): boolean {
  return (CLOSED_LEAD_STATUSES as readonly LeadStatus[]).includes(status);
}

/** Why a lead was closed as lost (required exactly when status is 'lost'). */
export const LEAD_LOST_REASONS = ['no_response', 'not_interested', 'too_expensive', 'schedule_conflict', 'too_young', 'chose_another_school', 'other'] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

/** Entries on a lead's timeline. The last four are written by the app, never logged by hand. */
export const LEAD_ACTIVITY_TYPES = ['note', 'call', 'whatsapp', 'email', 'meeting', 'status_change', 'interview_scheduled', 'interview_recorded', 'enrolled'] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

/** What staff can log by hand (POST /api/leads/:id/activities). All but 'note' count as contacting the person. */
export const LEAD_CONTACT_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'note'] as const satisfies readonly LeadActivityType[];
export type LeadContactType = (typeof LEAD_CONTACT_TYPES)[number];

export const INTERVIEW_STATUSES = ['scheduled', 'done', 'no_show', 'cancelled'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_RECOMMENDATIONS = ['accept', 'maybe', 'decline'] as const;
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

/** Interview scores run from 1 (weak) to 5 (excellent). */
export const INTERVIEW_SCORE_MIN = 1;
export const INTERVIEW_SCORE_MAX = 5;
