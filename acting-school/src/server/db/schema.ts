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
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import {
  ATTENDANCE_STATUSES,
  CASTING_STATUSES,
  CASTING_TYPES,
  COURSE_COLORS,
  COURSE_LEVELS,
  COURSE_STATUSES,
  ENROLLMENT_STATUSES,
  GENDERS,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_STATUSES,
  LEAD_ACTIVITY_TYPES,
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOCALES,
  SESSION_STATUSES,
  STUDENT_STATUSES,
  SUBMISSION_STATUSES,
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
  /** Always stored lower-case. */
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  phone: text('phone'),
  locale: text('locale', { enum: LOCALES }).notNull().default('en'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: integer('last_login_at'),
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
 * Uploaded images. The bytes live in the app's FileStore under `storage_key`
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
    /** "account:<email>|<address>", "account:<email>", "address:<address>" or "school". */
    key: text('key').primaryKey(),
    /** Lower-cased email as typed at sign-in (the account may not exist); null for the address and school brakes. */
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
