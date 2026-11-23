/**
 * The whole database. One SQLite database: a file (data/app.db) on the Node
 * server, the Durable Object's own SQLite on Cloudflare. Conventions:
 * - dates "YYYY-MM-DD", times "HH:MM", date-times "YYYY-MM-DDTHH:MM" as TEXT,
 *   local to the school, no time zone (see src/shared/dates.ts);
 * - created_at / updated_at are epoch milliseconds;
 * - deleting a parent cascades to rows that can't exist without it
 *   (a course's sessions, a session's attendance, a casting's roles…);
 *   optional links (a course's teacher, a photo) are set to NULL instead.
 *
 * After changing this file run `npm run db:generate` to add a migration.
 */
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  ATTENDANCE_STATUSES,
  CAFE_CATEGORIES,
  CAFE_ORDER_STATUSES,
  CASTING_APPLICATION_STATUSES,
  CASTING_STATUSES,
  CASTING_TYPES,
  COURSE_COLORS,
  COURSE_LEVELS,
  COURSE_STATUSES,
  ENROLLMENT_STATUSES,
  FILE_KINDS,
  GENDERS,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_STATUSES,
  LEAD_ACTIVITY_TYPES,
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOCALES,
  NOTIFICATION_KINDS,
  SESSION_STATUSES,
  STUDENT_STATUSES,
  SUBMISSION_STATUSES,
  SUMMONS_STATUSES,
  TALENT_STATUSES,
} from '../../shared/enums';
import type { Permission } from '../../shared/permissions';
import type { LeadActivityMeta } from '../../shared/schemas/admissions';

const now = () => Date.now();
const timestamps = () => ({
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
});

// ── Staff & access ──────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /**
   * What the person signs in with (shared/usernames.ts: 3–20 of a–z 0–9 . _ -,
   * starting with a letter; lower-case; unique). The column is nullable only
   * because SQLite can't add a NOT NULL column to a table that has rows: every
   * insert sets it, and initDb fills it for accounts older than the column
   * (backfillUsernames, lib/usernames.ts). Read it through `usernameOf`.
   */
  username: text('username').unique(),
  /** Always stored lower-case. Sign-in accepts it in place of the username. */
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /**
   * The password was set by someone else (a manager adding the person or
   * resetting it, the operator's tool): at the next sign-in the person must
   * choose their own before anything else (requireOwnPassword, middleware/auth.ts).
   */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  phone: text('phone'),
  locale: text('locale', { enum: LOCALES }).notNull().default('en'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: integer('last_login_at'),
  /**
   * Profile photo (PUT /api/auth/photo for your own, PUT /api/staff/:id/photo
   * with staff.manage). Shown beside the person everywhere, owners included
   * (the Team directory's documented exception to owner hiding).
   */
  photoFileId: text('photo_file_id').references((): AnySQLiteColumn => files.id, { onDelete: 'set null' }),
  ...timestamps(),
});

/**
 * Positions (CEO, Acting coach, …): what a staff member may do. A person holds
 * one or more (user_positions) and their permissions add up. Built-in positions
 * have a `key` and are created at startup when missing (ensureBuiltInPositions).
 * `isOwner` positions allow every permission; their stored list is ignored.
 */
export const positions = sqliteTable('positions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Set for built-in positions ('ceo', 'acting_coach', …); NULL for ones the school adds. */
  key: text('key').unique(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
  permissions: text('permissions', { mode: 'json' }).$type<Permission[]>().notNull().$defaultFn(() => []),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
});

export const userPositions = sqliteTable(
  'user_positions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    positionId: integer('position_id')
      .notNull()
      .references(() => positions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.positionId] }), index('user_positions_position_idx').on(t.positionId)],
);

/** Sign-in sessions. `id` is the SHA-256 of the cookie token, never the token itself. */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

/** Key/value app settings; values are JSON. See AppSettings in shared/schemas/settings.ts. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/**
 * Uploaded files: images (JPEG/PNG/WebP) and documents (PDF, Word, Excel,
 * PowerPoint), the type decided from the bytes (lib/fileTypes.ts). The bytes live in the app's FileStore under `storage_key`
 * (lib/fileStore.ts): DATA_DIR/uploads/ on the Node server; file_chunks below
 * (or R2 when bound) on Cloudflare.
 */
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  originalName: text('original_name'),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

/**
 * File bytes stored in the database itself (the Cloudflare FileStore without
 * R2): each file is split into chunks well under SQLite's row limit, written
 * and deleted in one transaction (lib/fileStore.ts sqliteFileStore).
 */
export const fileChunks = sqliteTable(
  'file_chunks',
  {
    storageKey: text('storage_key').notNull(),
    seq: integer('seq').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.storageKey, t.seq] })],
);

/**
 * The sign-in brakes (lib/signInBrake.ts): failed sign-ins counted per key —
 * an email from one address, an email from anywhere, one address, the whole
 * school — within each brake's window. In the database so a restart (or a
 * Durable Object being evicted) doesn't reset them.
 */
export const loginFailures = sqliteTable(
  'login_failures',
  {
    /** "account:<name>|<address>", "account:<name>", "address:<address>" or "school" — <name> as in `email` below. */
    key: text('key').primaryKey(),
    /**
     * The account the failed sign-ins were for: its email address, whichever of
     * username or email was typed — or its username's automatic address, which
     * counts too (signInBrakeNames, lib/usernames.ts); for a name that is
     * nobody's, what was typed in its email form. null for the address and
     * school brakes.
     */
    email: text('email'),
    count: integer('count').notNull(),
    /** Epoch ms of the first failure in the window. */
    firstAt: integer('first_at').notNull(),
  },
  (t) => [index('login_failures_email_idx').on(t.email)],
);

// ── School ──────────────────────────────────────────────────────────────────

export const students = sqliteTable(
  'students',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    /** phoneDigits(phone), kept in step on every write (lib/phone.ts withPhoneDigits): phone matching and search. */
    phoneDigits: text('phone_digits'),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender', { enum: GENDERS }),
    status: text('status', { enum: STUDENT_STATUSES }).notNull().default('active'),
    joinedOn: text('joined_on'),
    guardianName: text('guardian_name'),
    guardianPhone: text('guardian_phone'),
    guardianEmail: text('guardian_email'),
    emergencyName: text('emergency_name'),
    emergencyPhone: text('emergency_phone'),
    photoFileId: text('photo_file_id').references(() => files.id, { onDelete: 'set null' }),
    /** Photo/filming consent (from the student, or the guardian for minors). */
    mediaConsent: integer('media_consent', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
    /** Who added the student: without classes.all they still see the students they added (lib/access.ts). */
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('students_name_idx').on(t.lastName, t.firstName),
    index('students_status_idx').on(t.status),
    index('students_phone_digits_idx').on(t.phoneDigits),
  ],
);

export const courses = sqliteTable(
  'courses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    description: text('description'),
    level: text('level', { enum: COURSE_LEVELS }),
    teacherId: integer('teacher_id').references(() => users.id, { onDelete: 'set null' }),
    room: text('room'),
    capacity: integer('capacity'),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    color: text('color', { enum: COURSE_COLORS }),
    status: text('status', { enum: COURSE_STATUSES }).notNull().default('active'),
    /** Who created the class: without classes.all they still see the classes they created (lib/access.ts). */
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('courses_status_idx').on(t.status), index('courses_teacher_idx').on(t.teacherId)],
);

/** Weekly recurring slots of a course (weekday 0 = Sunday). */
export const courseSlots = sqliteTable(
  'course_slots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
  },
  (t) => [index('course_slots_course_idx').on(t.courseId)],
);

export const enrollments = sqliteTable(
  'enrollments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ENROLLMENT_STATUSES }).notNull().default('enrolled'),
    enrolledOn: text('enrolled_on').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('enrollments_course_student_uq').on(t.courseId, t.studentId), index('enrollments_student_idx').on(t.studentId)],
);

/** Dated occurrences of a course — generated from course_slots, plus one-off extras. */
export const classSessions = sqliteTable(
  'class_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** NULL = use the course's room. */
    room: text('room'),
    /** NULL = use the course's teacher; set for a substitute. */
    teacherId: integer('teacher_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: SESSION_STATUSES }).notNull().default('scheduled'),
    /** true = a one-off added by hand; false = generated from course_slots (regenerated when the schedule changes). */
    extra: integer('extra', { mode: 'boolean' }).notNull().default(false),
    topic: text('topic'),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('class_sessions_course_date_time_uq').on(t.courseId, t.date, t.startTime),
    index('class_sessions_date_idx').on(t.date),
  ],
);

export const attendance = sqliteTable(
  'attendance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ATTENDANCE_STATUSES }).notNull(),
    note: text('note'),
    markedBy: integer('marked_by').references(() => users.id, { onDelete: 'set null' }),
    markedAt: integer('marked_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('attendance_session_student_uq').on(t.sessionId, t.studentId), index('attendance_student_idx').on(t.studentId)],
);

// ── Agency ──────────────────────────────────────────────────────────────────

export const talent = sqliteTable(
  'talent',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Unique when set: a student is on the roster at most once. */
    studentId: integer('student_id').references(() => students.id, { onDelete: 'set null' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    stageName: text('stage_name'),
    email: text('email'),
    phone: text('phone'),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender', { enum: GENDERS }),
    playingAgeMin: integer('playing_age_min'),
    playingAgeMax: integer('playing_age_max'),
    heightCm: integer('height_cm'),
    eyeColor: text('eye_color'),
    hairColor: text('hair_color'),
    city: text('city'),
    languages: text('languages', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    showreelUrl: text('showreel_url'),
    instagram: text('instagram'),
    headshotFileId: text('headshot_file_id').references(() => files.id, { onDelete: 'set null' }),
    status: text('status', { enum: TALENT_STATUSES }).notNull().default('active'),
    representedSince: text('represented_since'),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('talent_student_uq').on(t.studentId),
    index('talent_name_idx').on(t.lastName, t.firstName),
    index('talent_status_idx').on(t.status),
  ],
);

export const talentPhotos = sqliteTable(
  'talent_photos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    talentId: integer('talent_id')
      .notNull()
      .references(() => talent.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    caption: text('caption'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('talent_photos_talent_idx').on(t.talentId), uniqueIndex('talent_photos_talent_file_uq').on(t.talentId, t.fileId)],
);

export const castings = sqliteTable(
  'castings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    production: text('production'),
    castingDirector: text('casting_director'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    type: text('type', { enum: CASTING_TYPES }),
    location: text('location'),
    description: text('description'),
    status: text('status', { enum: CASTING_STATUSES }).notNull().default('open'),
    submissionDeadline: text('submission_deadline'),
    shootStart: text('shoot_start'),
    shootEnd: text('shoot_end'),
    rate: text('rate'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('castings_status_idx').on(t.status)],
);

export const castingRoles = sqliteTable(
  'casting_roles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    castingId: integer('casting_id')
      .notNull()
      .references(() => castings.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    gender: text('gender', { enum: GENDERS }),
    ageMin: integer('age_min'),
    ageMax: integer('age_max'),
    requirements: text('requirements'),
    ...timestamps(),
  },
  (t) => [index('casting_roles_casting_idx').on(t.castingId)],
);

/** A talent put forward for a casting role, and how far they got. */
export const submissions = sqliteTable(
  'submissions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roleId: integer('role_id')
      .notNull()
      .references(() => castingRoles.id, { onDelete: 'cascade' }),
    talentId: integer('talent_id')
      .notNull()
      .references(() => talent.id, { onDelete: 'cascade' }),
    status: text('status', { enum: SUBMISSION_STATUSES }).notNull().default('shortlisted'),
    auditionAt: text('audition_at'),
    auditionLocation: text('audition_location'),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('submissions_role_talent_uq').on(t.roleId, t.talentId),
    index('submissions_talent_idx').on(t.talentId),
    index('submissions_audition_idx').on(t.auditionAt),
  ],
);

// ── Admissions ──────────────────────────────────────────────────────────────

/**
 * Enquiries: people asking about classes, followed up until they enrol (the
 * student is created then and linked here) or the lead is closed. Not
 * class-scoped: anyone with admissions.read sees every lead, contacts included.
 */
export const leads = sqliteTable(
  'leads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phone: text('phone').notNull(),
    /** phoneDigits(phone), kept in step on every write (lib/phone.ts withPhoneDigits): duplicates and search. */
    phoneDigits: text('phone_digits'),
    email: text('email'),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender', { enum: GENDERS }),
    city: text('city'),
    /** For minors. */
    guardianName: text('guardian_name'),
    guardianPhone: text('guardian_phone'),
    source: text('source', { enum: LEAD_SOURCES }).notNull().default('other'),
    /** Who referred them, which ad, which form… */
    sourceDetail: text('source_detail'),
    /** What they want (free text). */
    interest: text('interest'),
    experience: text('experience'),
    preferredCourseId: integer('preferred_course_id').references(() => courses.id, { onDelete: 'set null' }),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    /** Only when status is 'lost'. */
    lostReason: text('lost_reason', { enum: LEAD_LOST_REASONS }),
    assignedToId: integer('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    /** Open leads only; cleared when the lead is closed (enrolled/declined/lost). */
    nextFollowUpOn: text('next_follow_up_on'),
    /** Set on enrolment. */
    studentId: integer('student_id').references(() => students.id, { onDelete: 'set null' }),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    index('leads_status_idx').on(t.status),
    index('leads_follow_up_idx').on(t.nextFollowUpOn),
    index('leads_phone_idx').on(t.phone),
    index('leads_phone_digits_idx').on(t.phoneDigits),
  ],
);

/** A lead's timeline: contacts logged by staff, plus status changes, interviews and enrolment written by the app. */
export const leadActivities = sqliteTable(
  'lead_activities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    leadId: integer('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    type: text('type', { enum: LEAD_ACTIVITY_TYPES }).notNull(),
    body: text('body'),
    /** E.g. { from, to } for a status change; see LeadActivityMeta. */
    meta: text('meta', { mode: 'json' }).$type<LeadActivityMeta>(),
    createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('lead_activities_lead_idx').on(t.leadId, t.createdAt)],
);

/** Admissions interviews. A lead can have several (e.g. a new one after a no-show). */
export const interviews = sqliteTable(
  'interviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    leadId: integer('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** "YYYY-MM-DDTHH:MM", school-local. */
    scheduledAt: text('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    room: text('room'),
    interviewerId: integer('interviewer_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: INTERVIEW_STATUSES }).notNull().default('scheduled'),
    /** { criterionKey: 1..5 } — keys from settings.interviewCriteria (kept when a criterion is removed). */
    scores: text('scores', { mode: 'json' }).$type<Record<string, number>>().notNull().$defaultFn(() => ({})),
    strengths: text('strengths'),
    areasToWork: text('areas_to_work'),
    notes: text('notes'),
    recommendation: text('recommendation', { enum: INTERVIEW_RECOMMENDATIONS }),
    recommendedLevel: text('recommended_level', { enum: COURSE_LEVELS }),
    recommendedCourseId: integer('recommended_course_id').references(() => courses.id, { onDelete: 'set null' }),
    recordedById: integer('recorded_by_id').references(() => users.id, { onDelete: 'set null' }),
    recordedAt: integer('recorded_at'),
    ...timestamps(),
  },
  (t) => [index('interviews_lead_idx').on(t.leadId), index('interviews_scheduled_idx').on(t.scheduledAt)],
);

// ── Website ─────────────────────────────────────────────────────────────────
// The public site (/site) and what staff with website.manage edit for it. The
// studio texts, contact lines, casting call and custom links are one JSON
// object in settings ('site', lib/siteContent.ts); these tables hold the rest.

/** Coaches shown on the public site, in sort_order. Bilingual texts: '' = not given (the site shows the other language). */
export const siteCoaches = sqliteTable(
  'site_coaches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Optional link to the coach's staff account. */
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    nameEn: text('name_en').notNull().default(''),
    nameAr: text('name_ar').notNull().default(''),
    titleEn: text('title_en').notNull().default(''),
    titleAr: text('title_ar').notNull().default(''),
    bioEn: text('bio_en').notNull().default(''),
    bioAr: text('bio_ar').notNull().default(''),
    /** Public (served by /site/media) while the coach is visible. */
    photoFileId: text('photo_file_id').references(() => files.id, { onDelete: 'set null' }),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [index('site_coaches_sort_idx').on(t.sortOrder)],
);

/**
 * One row per course shown on (or prepared for) the public site. It appears
 * there only while `visible`, the course is active and its end date is on or
 * after the school's today. Empty titles mean "use the course name".
 */
export const siteWorkshops = sqliteTable('site_workshops', {
  courseId: integer('course_id')
    .primaryKey()
    .references(() => courses.id, { onDelete: 'cascade' }),
  visible: integer('visible', { mode: 'boolean' }).notNull().default(false),
  titleEn: text('title_en').notNull().default(''),
  titleAr: text('title_ar').notNull().default(''),
  descriptionEn: text('description_en').notNull().default(''),
  descriptionAr: text('description_ar').notNull().default(''),
  /** Public (served by /site/media) while the workshop appears on the site. */
  coverFileId: text('cover_file_id').references(() => files.id, { onDelete: 'set null' }),
  acceptingApplications: integer('accepting_applications', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
});

/**
 * Answers to the public casting call (lib/castingApplications.ts). Accepting
 * one creates a talent profile (talent_id) with the same photos. Contact
 * fields follow talent.contact.
 */
export const castingApplications = sqliteTable(
  'casting_applications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    gender: text('gender', { enum: GENDERS }),
    dateOfBirth: text('date_of_birth').notNull(),
    phone: text('phone').notNull(),
    /** phoneDigits(phone), kept in step on every write (lib/phone.ts withPhoneDigits): search. */
    phoneDigits: text('phone_digits'),
    email: text('email'),
    city: text('city'),
    heightCm: integer('height_cm'),
    languages: text('languages', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    skills: text('skills', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    experience: text('experience'),
    /** https only, at most 3 (Instagram, showreel…). */
    links: text('links', { mode: 'json' }).$type<string[]>().notNull().$defaultFn(() => []),
    message: text('message'),
    /** Required (with consent) when under 18. */
    guardianName: text('guardian_name'),
    guardianPhone: text('guardian_phone'),
    guardianConsent: integer('guardian_consent', { mode: 'boolean' }).notNull().default(false),
    /** The language of the page they applied from. */
    locale: text('locale', { enum: LOCALES }).notNull().default('en'),
    status: text('status', { enum: CASTING_APPLICATION_STATUSES }).notNull().default('new'),
    reviewedById: integer('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: integer('reviewed_at'),
    /** The talent profile made from it (status accepted). */
    talentId: integer('talent_id').references(() => talent.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('casting_applications_status_idx').on(t.status),
    index('casting_applications_created_idx').on(t.createdAt),
    index('casting_applications_phone_digits_idx').on(t.phoneDigits),
  ],
);

/** A casting application's photos, in order (the first is the headshot). Never public. */
export const castingApplicationPhotos = sqliteTable(
  'casting_application_photos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    applicationId: integer('application_id')
      .notNull()
      .references(() => castingApplications.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('casting_application_photos_application_idx').on(t.applicationId, t.sortOrder), index('casting_application_photos_file_idx').on(t.fileId)],
);

/**
 * Fixed-window counters for the public forms (lib/rateLimit.ts hitRateLimit):
 * per client address, school-wide, and photo bytes per day. Expired rows are
 * deleted as new hits come in.
 */
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  /** Epoch ms when the current window started. */
  windowStart: integer('window_start').notNull(),
});

// ── Team: workshop and casting files, chat, "call to the office", notifications ──
// Every table that points at files is listed in lib/fileRefs.ts (FILE_REFERENCES),
// so deleting a record frees the stored file once nothing else uses it.

/** Photos and documents on a workshop's "Photos & files" tab: seen by whoever can see the workshop. */
export const courseFiles = sqliteTable(
  'course_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    courseId: integer('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    /** From the file's type: images are photos, the rest documents. */
    kind: text('kind', { enum: FILE_KINDS }).notNull(),
    caption: text('caption'),
    uploadedById: integer('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('course_files_course_idx').on(t.courseId, t.createdAt), index('course_files_file_idx').on(t.fileId)],
);

/** A casting's files (breakdowns, sides, contracts, reference photos): castings.read to see, castings.write to add or delete. */
export const castingFiles = sqliteTable(
  'casting_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    castingId: integer('casting_id')
      .notNull()
      .references(() => castings.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: FILE_KINDS }).notNull(),
    caption: text('caption'),
    uploadedById: integer('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('casting_files_casting_idx').on(t.castingId, t.createdAt), index('casting_files_file_idx').on(t.fileId)],
);

/**
 * Internal chat: direct (one-to-one) conversations only for now, one per pair
 * of people (`pair_key` "<smaller user id>:<larger user id>"). Members only:
 * anyone else gets a 404 (routes/chat.ts).
 */
export const conversations = sqliteTable(
  'conversations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Direct chats: "<minUserId>:<maxUserId>". */
    pairKey: text('pair_key').unique(),
    /** Epoch ms of the newest message; null until the first one (such a conversation isn't listed yet). */
    lastMessageAt: integer('last_message_at'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('conversations_last_message_idx').on(t.lastMessageAt)],
);

export const conversationMembers = sqliteTable(
  'conversation_members',
  {
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The newest message this member has seen (their own count as seen); null = none yet. Drives unread counts and "Seen". */
    lastReadMessageId: integer('last_read_message_id'),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conversation_members_user_idx').on(t.userId)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: integer('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Up to 4000 characters; null for a message that is only attachments (or was deleted). */
    body: text('body'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    /** Set when the sender deleted it (within 15 minutes): it shows as "deleted", text and attachments gone. */
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.id), index('messages_sender_idx').on(t.senderId, t.createdAt)],
);

/** A message's photos and documents. A file is attached to one message at most (unique file_id). */
export const messageAttachments = sqliteTable(
  'message_attachments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: FILE_KINDS }).notNull(),
  },
  (t) => [index('message_attachments_message_idx').on(t.messageId), uniqueIndex('message_attachments_file_uq').on(t.fileId)],
);

/**
 * "Call to the office" (staff.summon): one pending summons per caller and
 * person at a time; a pending one older than two hours counts as expired
 * (SUMMONS_EXPIRY_MS, never stored); at most 20 an hour per caller.
 */
export const summons = sqliteTable(
  'summons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fromUserId: integer('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUserId: integer('to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note'),
    status: text('status', { enum: SUMMONS_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    /** When the person answered (on_my_way / cant_now). */
    answeredAt: integer('answered_at'),
  },
  (t) => [index('summons_to_idx').on(t.toUserId, t.status, t.createdAt), index('summons_from_idx').on(t.fromUserId, t.createdAt)],
);

/**
 * The in-app notification bar (the bell). Texts are written in the
 * recipient's language when created (lib/notifications.ts); new messages keep
 * one notification per conversation, updated rather than piled up.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** An app path to open (e.g. "/messages/12"). */
    link: text('link').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    readAt: integer('read_at'),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt), index('notifications_user_link_idx').on(t.userId, t.kind, t.link)],
);

/**
 * Web Push subscriptions, one per browser/phone (endpoint). Deleted when the
 * push service answers 404/410, or after 10 failures in a row (lib/push/send.ts).
 * Each belongs to the sign-in session that turned it on: when that session
 * ends (sign-out, a password reset or deactivation that signs someone out
 * everywhere), the subscription goes with it, so a signed-out phone or a
 * shared office computer stops getting that person's notifications.
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * The auth_sessions id that subscribed. Not a foreign key (a column added
     * later can't carry ON DELETE CASCADE): the code that deletes sessions
     * deletes these rows too, and sending only goes to subscriptions whose
     * session still exists and hasn't expired. Null only for rows from before
     * this column: never sent to.
     */
    sessionId: text('session_id'),
    endpoint: text('endpoint').notNull().unique(),
    /** The browser's P-256 public key (base64url, 65 bytes uncompressed). */
    p256dh: text('p256dh').notNull(),
    /** The browser's auth secret (base64url, 16 bytes). */
    auth: text('auth').notNull(),
    /** Shortened User-Agent, so a person can tell their devices apart. */
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    lastSuccessAt: integer('last_success_at'),
    failures: integer('failures').notNull().default(0),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId), index('push_subscriptions_session_idx').on(t.sessionId)],
);

// ── Cafeteria (Part J) ──────────────────────────────────────────────────────

/** The cafeteria menu. No prices (the school's choice). Shown by category, then sort_order. */
export const cafeItems = sqliteTable(
  'cafe_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    category: text('category', { enum: CAFE_CATEGORIES }).notNull(),
    /** Off: still on the menu, greyed out, can't be ordered. */
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [index('cafe_items_category_idx').on(t.category, t.sortOrder)],
);

/**
 * A cafeteria order: new → on_the_way → delivered, or cancelled (by the person
 * who ordered while it is new; by whoever serves, with a reason, while it is
 * new or on the way). At most 10 an hour per person.
 */
export const cafeOrders = sqliteTable(
  'cafe_orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Who ordered. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Where it should come: a configured place's English name, or what the person typed (≤ 80). */
    place: text('place').notNull(),
    note: text('note'),
    status: text('status', { enum: CAFE_ORDER_STATUSES }).notNull().default('new'),
    /** Who last moved it (took it, delivered it or turned it down). */
    handledById: integer('handled_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Why it can't be done, when whoever serves cancelled it (the person who ordered reads it). */
    cancelReason: text('cancel_reason'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    onTheWayAt: integer('on_the_way_at'),
    deliveredAt: integer('delivered_at'),
    cancelledAt: integer('cancelled_at'),
  },
  (t) => [index('cafe_orders_status_idx').on(t.status, t.createdAt), index('cafe_orders_user_idx').on(t.userId, t.createdAt)],
);

/** An order's lines. The item's names are copied when the order is sent, so renaming or deleting a menu item never changes an old order. */
export const cafeOrderItems = sqliteTable(
  'cafe_order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => cafeOrders.id, { onDelete: 'cascade' }),
    itemId: integer('item_id').references(() => cafeItems.id, { onDelete: 'set null' }),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    /** 1–10. */
    qty: integer('qty').notNull(),
    /** How it is wanted ("no sugar"), ≤ 60. */
    options: text('options'),
  },
  (t) => [index('cafe_order_items_order_idx').on(t.orderId)],
);
