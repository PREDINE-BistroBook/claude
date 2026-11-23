import { z } from 'zod';
import {
  COURSE_LEVELS,
  GENDERS,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_SCORE_MAX,
  INTERVIEW_SCORE_MIN,
  INTERVIEW_STATUSES,
  LEAD_CONTACT_TYPES,
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type CourseLevel,
  type CourseStatus,
  type Gender,
  type InterviewRecommendation,
  type InterviewStatus,
  type LeadActivityType,
  type LeadLostReason,
  type LeadSource,
  type LeadStatus,
} from '../enums';
import { MIN_PHONE_DIGITS, phoneDigits } from '../phone';
import type { CourseListItem } from './courses';
import { dateTimeStr, id, optDate, optEmail, optEnum, optId, optText, reqText } from './common';

/**
 * Admissions: enquiries ("leads") → follow-ups → interview → decision →
 * enrolled student. API under /api/leads (interviews nested under their lead).
 *
 * Permissions: admissions.read sees everything here (leads are not
 * class-scoped, contact details included); admissions.write adds/edits leads,
 * logs contacts, schedules/reschedules/cancels interviews, marks no-shows,
 * closes/reopens; admissions.decide records assessments, accepts/declines,
 * enrols, deletes leads.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────

/** A phone number with at least 7 digits (any spacing, "+", Arabic digits). */
const phone = reqText(50).refine((v) => phoneDigits(v).length >= MIN_PHONE_DIGITS, { message: 'admissions:errors.invalidPhone' });
const optPhone = optText(50).refine((v) => v == null || phoneDigits(v).length >= MIN_PHONE_DIGITS, { message: 'admissions:errors.invalidPhone' });

const leadFields = z.object({
  firstName: reqText(100),
  lastName: reqText(100),
  phone,
  email: optEmail,
  dateOfBirth: optDate,
  gender: optEnum(GENDERS),
  city: optText(100),
  /** For minors (the form shows the guardian fields when under 18). */
  guardianName: optText(200),
  guardianPhone: optPhone,
  /** Defaults to 'other' on create. */
  source: z.enum(LEAD_SOURCES).optional(),
  sourceDetail: optText(200),
  interest: optText(2000),
  experience: optText(2000),
  preferredCourseId: optId,
  /**
   * Defaults to 'new' on create. Manual changes need admissions.write, except:
   * 'accepted'/'declined' need admissions.decide; 'enrolled' only via
   * POST /:id/enrol; 'lost' needs lostReason. An enrolled lead's status is final.
   */
  status: z.enum(LEAD_STATUSES).optional(),
  /** Required when status is 'lost'; cleared whenever the status isn't 'lost'. */
  lostReason: optEnum(LEAD_LOST_REASONS),
  /** An active staff member (never a hidden owner for a non-owner). Defaults to the creator on create. */
  assignedToId: optId,
  /** Open leads only: refused (400) when the resulting status is closed; cleared when a lead is closed. */
  nextFollowUpOn: optDate,
  notes: optText(5000),
});

/** POST /api/leads */
export const leadInput = leadFields;
export type LeadInput = z.infer<typeof leadInput>;
/** PATCH /api/leads/:id */
export const leadUpdateInput = leadFields.partial();
export type LeadUpdateInput = z.infer<typeof leadUpdateInput>;

/**
 * Tabs on the admissions screen (?group=):
 * - open: new, contacted, interview_scheduled, interviewed, accepted;
 * - closed: enrolled, declined, lost;
 * - follow_up_due: open leads with nextFollowUpOn on or before today;
 * - interviews: interview_scheduled or interviewed (awaiting interview / decision).
 */
export const LEAD_GROUPS = ['open', 'closed', 'follow_up_due', 'interviews'] as const;
export type LeadGroup = (typeof LEAD_GROUPS)[number];

/** GET /api/leads — every filter optional; `q` matches names, email and phone digits. */
export const leadListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  group: z.enum(LEAD_GROUPS).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  assignedToId: id.optional(),
});
export type LeadListQuery = z.infer<typeof leadListQuery>;

/** GET /api/leads/duplicates — at least one of phone / email; `excludeLeadId` leaves the lead being edited out. */
export const leadDuplicatesQuery = z.object({
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().max(254).optional(),
  excludeLeadId: id.optional(),
});
export type LeadDuplicatesQuery = z.infer<typeof leadDuplicatesQuery>;

/**
 * POST /api/leads/:id/activities — log a contact or a note.
 * - type call/whatsapp/email/meeting on a 'new' lead moves it to 'contacted' (unless `status` is given);
 * - nextFollowUpOn: a date sets it, null clears it, omitted leaves it as it is;
 * - status/lostReason: same rules as PATCH /api/leads/:id.
 */
export const leadActivityInput = z
  .object({
    type: z.enum(LEAD_CONTACT_TYPES),
    body: optText(5000),
    nextFollowUpOn: optDate,
    status: z.enum(LEAD_STATUSES).optional(),
    lostReason: optEnum(LEAD_LOST_REASONS),
  })
  .refine((v) => v.type !== 'note' || !!v.body, { path: ['body'], message: 'admissions:errors.noteRequired' });
export type LeadActivityInput = z.infer<typeof leadActivityInput>;

export const DEFAULT_INTERVIEW_MINUTES = 30;
export const MIN_INTERVIEW_MINUTES = 5;
export const MAX_INTERVIEW_MINUTES = 480;
const durationMinutes = z.number().int().min(MIN_INTERVIEW_MINUTES).max(MAX_INTERVIEW_MINUTES);

/** POST /api/leads/:id/interviews (admissions.write) — the lead moves to 'interview_scheduled'. */
export const interviewScheduleInput = z.object({
  scheduledAt: dateTimeStr,
  /** Defaults to DEFAULT_INTERVIEW_MINUTES. */
  durationMinutes: durationMinutes.optional(),
  room: optText(100),
  /** An active staff member (never a hidden owner for a non-owner). Defaults to nobody. */
  interviewerId: optId,
  notes: optText(5000),
});
export type InterviewScheduleInput = z.infer<typeof interviewScheduleInput>;

/** { criterionKey: 1..5 }. Keys must be current criteria (settings) or already stored on this interview. */
export const interviewScores = z.record(
  z.string().trim().min(1).max(40),
  z.number().int().min(INTERVIEW_SCORE_MIN, { message: 'admissions:errors.scoreRange' }).max(INTERVIEW_SCORE_MAX, { message: 'admissions:errors.scoreRange' }),
);

/**
 * PATCH /api/leads/:id/interviews/:interviewId. Who may change what:
 * - scheduledAt, durationMinutes, room, interviewerId (only while the interview
 *   is scheduled), status 'cancelled' / 'no_show' / back to 'scheduled', and
 *   notes on an interview that isn't done → admissions.write;
 * - the assessment (scores, strengths, areasToWork, recommendation,
 *   recommendedLevel, recommendedCourseId), status 'done', and any change to a
 *   done interview → admissions.decide. Sending assessment fields without a
 *   status records the interview as done.
 * Lead status follows: done → interviewed; no_show/cancelled → contacted (when
 * no other interview is still scheduled); back to scheduled → interview_scheduled.
 */
export const interviewUpdateInput = z
  .object({
    scheduledAt: dateTimeStr,
    durationMinutes,
    room: optText(100),
    interviewerId: optId,
    status: z.enum(INTERVIEW_STATUSES),
    /** Replaces the stored scores; null clears them. */
    scores: interviewScores.nullable(),
    strengths: optText(5000),
    areasToWork: optText(5000),
    notes: optText(5000),
    recommendation: optEnum(INTERVIEW_RECOMMENDATIONS),
    recommendedLevel: optEnum(COURSE_LEVELS),
    /** An active (not archived) class; the enrol screen preselects it. */
    recommendedCourseId: optId,
  })
  .partial();
export type InterviewUpdateInput = z.infer<typeof interviewUpdateInput>;

/** The interview fields that make up the assessment (recording needs admissions.decide). */
export const INTERVIEW_ASSESSMENT_FIELDS = ['scores', 'strengths', 'areasToWork', 'recommendation', 'recommendedLevel', 'recommendedCourseId'] as const;

/**
 * POST /api/leads/:id/enrol (admissions.decide) — creates the student from the
 * lead and enrols them in the class, in one transaction. If a student with the
 * same phone (compared as international digits) or email already exists, the
 * answer is 409 possible_duplicate with details.matches, unless the body says
 * linkStudentId (enrol that existing student instead) or createNew: true.
 */
export const enrolInput = z
  .object({
    courseId: id,
    /** The student's joined-on date and the enrollment date. Defaults to today. */
    joinedOn: optDate,
    linkStudentId: id.optional(),
    createNew: z.boolean().optional(),
  })
  .refine((v) => !(v.linkStudentId && v.createNew), { path: ['createNew'], message: 'admissions:errors.linkOrCreate' });
export type EnrolInput = z.infer<typeof enrolInput>;

// ── Responses ───────────────────────────────────────────────────────────────

/** Extra data on timeline entries. Which keys are set depends on the type. */
export interface LeadActivityMeta {
  /** status_change */
  from?: LeadStatus;
  to?: LeadStatus;
  lostReason?: LeadLostReason | null;
  /** interview_scheduled / interview_recorded */
  interviewId?: number;
  scheduledAt?: string;
  /** interview_scheduled when rescheduled */
  previousScheduledAt?: string;
  /** interview_recorded: done, no_show or cancelled */
  interviewStatus?: InterviewStatus;
  recommendation?: InterviewRecommendation | null;
  /** enrolled */
  courseId?: number;
  courseName?: string;
  studentId?: number;
  /** enrolled: an existing student was linked instead of creating one */
  linkedExistingStudent?: boolean;
  /** contact entries: the follow-up date set with the contact (null = cleared) */
  nextFollowUpOn?: string | null;
}

export interface LeadActivity {
  id: number;
  leadId: number;
  type: LeadActivityType;
  body: string | null;
  meta: LeadActivityMeta | null;
  createdById: number | null;
  createdByName: string | null;
  createdAt: number;
}

export interface Interview {
  id: number;
  leadId: number;
  /** "YYYY-MM-DDTHH:MM" */
  scheduledAt: string;
  durationMinutes: number;
  room: string | null;
  interviewerId: number | null;
  interviewerName: string | null;
  status: InterviewStatus;
  /** { criterionKey: 1..5 }; may include keys of criteria removed from settings since. */
  scores: Record<string, number>;
  strengths: string | null;
  areasToWork: string | null;
  notes: string | null;
  recommendation: InterviewRecommendation | null;
  recommendedLevel: CourseLevel | null;
  recommendedCourseId: number | null;
  recommendedCourseName: string | null;
  recordedById: number | null;
  recordedByName: string | null;
  /** Epoch ms when the outcome was last recorded. */
  recordedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  city: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  interest: string | null;
  experience: string | null;
  preferredCourseId: number | null;
  status: LeadStatus;
  lostReason: LeadLostReason | null;
  assignedToId: number | null;
  nextFollowUpOn: string | null;
  studentId: number | null;
  createdById: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/leads → { items: LeadListItem[] }, sorted by nextFollowUpOn (soonest first, none last), then newest first. */
export interface LeadListItem {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  status: LeadStatus;
  lostReason: LeadLostReason | null;
  assignedToId: number | null;
  assignedToName: string | null;
  nextFollowUpOn: string | null;
  preferredCourseId: number | null;
  preferredCourseName: string | null;
  /** The soonest interview still scheduled, if any. */
  nextInterview: { id: number; scheduledAt: string } | null;
  studentId: number | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/leads/:id (also the answer of POST and PATCH). */
export interface LeadDetail extends Lead {
  assignedToName: string | null;
  createdByName: string | null;
  preferredCourse: {
    id: number;
    name: string;
    level: CourseLevel | null;
    status: CourseStatus;
    teacherId: number | null;
    teacherName: string | null;
  } | null;
  /**
   * The student created (or linked) on enrolment. `visible`: whether the caller
   * may open them — after enrolment the student follows the students module's
   * own rules (students.read and class scope).
   */
  student: { id: number; visible: boolean } | null;
  /** Newest scheduledAt first. */
  interviews: Interview[];
  /** Newest first. */
  activities: LeadActivity[];
}

/** GET /api/leads/counts — numbers for the admissions tabs (same rules as the groups). */
export interface LeadCounts {
  followUpDue: number;
  new: number;
  interviews: number;
  open: number;
  closed: number;
}

/**
 * GET /api/leads/duplicates → { items: DuplicateMatch[] }: open leads and
 * students with the same phone (as international digits) or email. Names only —
 * never a student's contact details.
 */
export type DuplicateMatch = { kind: 'lead'; id: number; name: string; status: LeadStatus } | { kind: 'student'; id: number; name: string };

/**
 * GET /api/leads/course-options → { items }: active classes that haven't ended,
 * for the preferred-class and enrol pickers (admissions.read; not class-scoped).
 * `freePlaces` is null when the class has no capacity limit.
 */
export interface AdmissionsCourseOption extends CourseListItem {
  freePlaces: number | null;
}

/** POST /api/leads/:id/enrol → 201 */
export interface EnrolResult {
  lead: LeadDetail;
  studentId: number;
  enrollmentId: number;
  /** false when an existing student was linked (linkStudentId). */
  createdStudent: boolean;
}

/** error.details of a 409 possible_duplicate from POST /api/leads/:id/enrol. */
export interface PossibleDuplicateDetails {
  matches: { id: number; name: string }[];
}

/**
 * Error codes (error.code) of the admissions API besides the generic ones.
 * Enrolling can also answer the classes module's 409s: already_enrolled,
 * previously_enrolled, class_full (see COURSE_ERROR_CODES).
 */
export const ADMISSIONS_ERROR_CODES = {
  /** 409 — a student with the same phone/email exists; error.details is PossibleDuplicateDetails. */
  possibleDuplicate: 'possible_duplicate',
  /** 409 — the lead is already enrolled (enrol again, change its status, or schedule an interview). */
  leadEnrolled: 'lead_enrolled',
  /** 409 — the lead is lost/declined: reopen it before scheduling an interview. */
  leadClosed: 'lead_closed',
  /** 409 — the class is archived. */
  courseArchived: 'course_archived',
  /** 409 — only a scheduled interview can be rescheduled. */
  interviewNotScheduled: 'interview_not_scheduled',
} as const;
