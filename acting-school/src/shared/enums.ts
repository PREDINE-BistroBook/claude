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

// ── Website ─────────────────────────────────────────────────────────────────

/**
 * A casting application sent from the public website's casting-call form:
 * new → reviewing → accepted (a talent profile was made from it) or declined.
 * `accepted` is final (POST /api/casting-applications/:id/accept).
 */
export const CASTING_APPLICATION_STATUSES = ['new', 'reviewing', 'accepted', 'declined'] as const;
export type CastingApplicationStatus = (typeof CASTING_APPLICATION_STATUSES)[number];

// ── Team: files, chat, "call to the office", notifications ─────────────────

/** What a stored file is, decided from its bytes (POST /api/files): a picture shown inline, or a document downloaded. */
export const FILE_KINDS = ['photo', 'document'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * A "call to the office" (summons): pending until the person answers (on my
 * way / can't come now) or the caller cancels it. A pending one older than
 * SUMMONS_EXPIRY_MS counts as expired: the API shows it as 'expired'
 * (SummonsView.status) without storing that.
 */
export const SUMMONS_STATUSES = ['pending', 'on_my_way', 'cant_now', 'cancelled'] as const;
export type SummonsStatus = (typeof SUMMONS_STATUSES)[number];
/** The answers the person called can give. */
export const SUMMONS_ANSWERS = ['on_my_way', 'cant_now'] as const satisfies readonly SummonsStatus[];
export type SummonsAnswer = (typeof SUMMONS_ANSWERS)[number];
/** A status as the API shows it: a pending summons past its time is 'expired'. */
export const SUMMONS_VIEW_STATUSES = [...SUMMONS_STATUSES, 'expired'] as const;
export type SummonsViewStatus = (typeof SUMMONS_VIEW_STATUSES)[number];
/** A pending summons older than this (2 hours) counts as expired. */
export const SUMMONS_EXPIRY_MS = 2 * 60 * 60 * 1000;

/**
 * In-app notifications (the bell): a new message (one per conversation,
 * updated), a summons, a summons answered; from the cafeteria, a new order
 * (to whoever serves) and what became of an order (to whoever ordered: on the
 * way, delivered, or turned down with a reason — one per order, updated);
 * from the video pipeline (Part L), a new video (to the editors), an edit
 * ready to check (to the reviewers), changes needed (to the editor) and a
 * video approved (to the coach who added it) — one per video and kind, updated.
 */
export const NOTIFICATION_KINDS = [
  'message',
  'summon',
  'summon_answer',
  'cafe_order',
  'cafe_status',
  'video_new',
  'video_review',
  'video_changes',
  'video_approved',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// ── Cafeteria ───────────────────────────────────────────────────────────────

/** How the cafeteria menu is grouped on the order screen, in this order. */
export const CAFE_CATEGORIES = ['hot', 'cold', 'food', 'other'] as const;
export type CafeCategory = (typeof CAFE_CATEGORIES)[number];

/**
 * A cafeteria order: new → on_the_way → delivered, one step at a time, moved by
 * whoever serves (cafeteria.serve). `cancelled`: by the person who ordered
 * while it is still new, or by whoever serves, with a reason, while it is new
 * or on the way. Nothing changes after delivered or cancelled.
 */
export const CAFE_ORDER_STATUSES = ['new', 'on_the_way', 'delivered', 'cancelled'] as const;
export type CafeOrderStatus = (typeof CAFE_ORDER_STATUSES)[number];
/** Orders somebody still has to do something about. */
export const OPEN_CAFE_ORDER_STATUSES = ['new', 'on_the_way'] as const satisfies readonly CafeOrderStatus[];
/** What whoever serves can set through POST /api/cafe/orders/:id/status. */
export const CAFE_SERVE_STATUSES = ['on_the_way', 'delivered', 'cancelled'] as const satisfies readonly CafeOrderStatus[];
export type CafeServeStatus = (typeof CAFE_SERVE_STATUSES)[number];

export function isOpenCafeOrder(status: CafeOrderStatus): boolean {
  return (OPEN_CAFE_ORDER_STATUSES as readonly CafeOrderStatus[]).includes(status);
}

/** The step after `status` on the way to delivered, or null when there is none. */
export function nextCafeStep(status: CafeOrderStatus): 'on_the_way' | 'delivered' | null {
  return status === 'new' ? 'on_the_way' : status === 'on_the_way' ? 'delivered' : null;
}

// ── Videos (Part L): coach → editor → reviewer ─────────────────────────────

/** What a class video is (the coach picks one when adding it). */
export const VIDEO_KINDS = ['scene', 'monologue', 'exercise', 'showreel', 'performance', 'other'] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];

/**
 * A video's way through the pipeline: new (the coach added the link) →
 * editing (an editor took it) → in_review (the edit is done, waiting for the
 * reviewer) → approved, or changes_requested (back to the editor, who takes it
 * again: editing → in_review). An approved video can be reopened by a
 * reviewer, with a note: back to changes_requested.
 */
export const VIDEO_STATUSES = ['new', 'editing', 'in_review', 'changes_requested', 'approved'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** Entries of a video's history (video_events). All but `comment` are written by the app as the video moves. */
export const VIDEO_EVENT_TYPES = ['added', 'taken', 'submitted', 'changes_requested', 'approved', 'reopened', 'comment'] as const;
export type VideoEventType = (typeof VIDEO_EVENT_TYPES)[number];
