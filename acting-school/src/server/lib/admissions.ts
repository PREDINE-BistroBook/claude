/**
 * Admissions read models and helpers shared by the leads router, the schedule
 * and the dashboard, plus lead creation (createLead: the one path every new
 * lead takes — POST /api/leads and the website's enquiry form,
 * createWebsiteLead). Every loader runs a fixed number of queries per request.
 */
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { splitDateTime, timeToMinutes } from '../../shared/dates';
import { OPEN_LEAD_STATUSES, type InterviewStatus } from '../../shared/enums';
import { internationalPhone } from '../../shared/phone';
import type { DuplicateMatch, Interview, LeadActivity, LeadDetail, LeadListItem } from '../../shared/schemas/admissions';
import type { SessionUser } from '../../shared/schemas/auth';
import type { InterviewEvent } from '../../shared/schemas/schedule';
import type { SiteApplyInput, SiteExperienceLevel, SiteHeardFrom } from '../../shared/schemas/site';
import type { DB } from '../db/database';
import { courses, interviews, leadActivities, leads, students, users } from '../db/schema';
import { maySeeStudent, type Conn } from './access';
import { notFound } from './errors';
import { withPhoneDigits } from './phone';
import { getSettings } from './settings';
import { findPublicWorkshop } from './siteContent';
import { inChunks } from './sqlLimits';

export type LeadRow = typeof leads.$inferSelect;
export type InterviewRow = typeof interviews.$inferSelect;

/** "First Last" of a lead (SQL). */
export const leadName = sql<string>`${leads.firstName} || ' ' || ${leads.lastName}`;

/** WHERE: the lead is open (not enrolled/declined/lost). */
export const leadIsOpen = inArray(leads.status, [...OPEN_LEAD_STATUSES]);

/** WHERE: an open lead whose follow-up is due on or before `today`. */
export const followUpDue = (today: string) => and(leadIsOpen, lte(leads.nextFollowUpOn, today));

/** Display names of these users, in one query. */
export function userNames(db: Pick<DB, 'select'>, ids: readonly (number | null)[]): Map<number, string> {
  const unique = [...new Set(ids.filter((v): v is number => v !== null))];
  if (!unique.length) return new Map();
  return new Map(inChunks(unique, (ids) => db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)).all()).map((u) => [u.id, u.name]));
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** The soonest still-scheduled interview of the lead in the outer query (explicit "leads"."id": see access.ts notAnOwner). */
const nextInterviewId = sql<number | null>`(select ni.id from ${interviews} ni where ni.lead_id = "leads"."id" and ni.status = 'scheduled' order by ni.scheduled_at, ni.id limit 1)`;
const nextInterviewAt = sql<string | null>`(select ni.scheduled_at from ${interviews} ni where ni.lead_id = "leads"."id" and ni.status = 'scheduled' order by ni.scheduled_at, ni.id limit 1)`;

/** Follow-up soonest first (none last), then newest first. */
export const leadListOrder: SQL[] = [
  sql`case when ${leads.nextFollowUpOn} is null then 1 else 0 end`,
  asc(leads.nextFollowUpOn),
  desc(leads.createdAt),
  desc(leads.id),
];

export function loadLeadListItems(db: DB, where: SQL | undefined, opts: { order?: SQL[]; limit?: number } = {}): LeadListItem[] {
  const q = db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      phone: leads.phone,
      email: leads.email,
      dateOfBirth: leads.dateOfBirth,
      source: leads.source,
      sourceDetail: leads.sourceDetail,
      status: leads.status,
      lostReason: leads.lostReason,
      assignedToId: leads.assignedToId,
      assignedToName: users.name,
      nextFollowUpOn: leads.nextFollowUpOn,
      preferredCourseId: leads.preferredCourseId,
      preferredCourseName: courses.name,
      nextInterviewId,
      nextInterviewAt,
      studentId: leads.studentId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedToId))
    .leftJoin(courses, eq(courses.id, leads.preferredCourseId))
    .where(where)
    .orderBy(...(opts.order ?? leadListOrder));
  const rows = opts.limit ? q.limit(opts.limit).all() : q.all();
  return rows.map(({ nextInterviewId: ivId, nextInterviewAt: ivAt, ...r }) => ({
    ...r,
    nextInterview: ivId !== null && ivAt !== null ? { id: ivId, scheduledAt: ivAt } : null,
  }));
}

// ── Detail ──────────────────────────────────────────────────────────────────

export function toInterview(r: InterviewRow, names: Map<number, string>, courseNames: Map<number, string>): Interview {
  return {
    id: r.id,
    leadId: r.leadId,
    scheduledAt: r.scheduledAt,
    durationMinutes: r.durationMinutes,
    room: r.room,
    interviewerId: r.interviewerId,
    interviewerName: r.interviewerId !== null ? (names.get(r.interviewerId) ?? null) : null,
    status: r.status,
    scores: r.scores ?? {},
    strengths: r.strengths,
    areasToWork: r.areasToWork,
    notes: r.notes,
    recommendation: r.recommendation,
    recommendedLevel: r.recommendedLevel,
    recommendedCourseId: r.recommendedCourseId,
    recommendedCourseName: r.recommendedCourseId !== null ? (courseNames.get(r.recommendedCourseId) ?? null) : null,
    recordedById: r.recordedById,
    recordedByName: r.recordedById !== null ? (names.get(r.recordedById) ?? null) : null,
    recordedAt: r.recordedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function courseNameMap(db: Pick<DB, 'select'>, ids: readonly (number | null)[]): Map<number, string> {
  const unique = [...new Set(ids.filter((v): v is number => v !== null))];
  if (!unique.length) return new Map();
  return new Map(
    inChunks(unique, (ids) => db.select({ id: courses.id, name: courses.name }).from(courses).where(inArray(courses.id, ids)).all()).map((c) => [c.id, c.name]),
  );
}

/** Interviews of a lead (or one interview), newest scheduledAt first. */
export function loadInterviews(db: DB, where: SQL): Interview[] {
  const rows = db.select().from(interviews).where(where).orderBy(desc(interviews.scheduledAt), desc(interviews.id)).all();
  const names = userNames(
    db,
    rows.flatMap((r) => [r.interviewerId, r.recordedById]),
  );
  const courseNames = courseNameMap(
    db,
    rows.map((r) => r.recommendedCourseId),
  );
  return rows.map((r) => toInterview(r, names, courseNames));
}

/** Has the lead an interview recorded as done (an assessment)? */
export function leadHasDoneInterview(db: Pick<DB, 'select'>, leadId: number): boolean {
  return !!db
    .select({ id: interviews.id })
    .from(interviews)
    .where(and(eq(interviews.leadId, leadId), eq(interviews.status, 'done')))
    .get();
}

export function loadInterview(db: DB, id: number): Interview | null {
  return loadInterviews(db, eq(interviews.id, id))[0] ?? null;
}

export function toActivity(r: typeof leadActivities.$inferSelect, names: Map<number, string>): LeadActivity {
  return {
    id: r.id,
    leadId: r.leadId,
    type: r.type,
    body: r.body,
    meta: r.meta ?? null,
    createdById: r.createdById,
    createdByName: r.createdById !== null ? (names.get(r.createdById) ?? null) : null,
    createdAt: r.createdAt,
  };
}

/** The lead with interviews, timeline and names; null when missing. */
export function loadLeadDetail(db: DB, id: number, viewer: Pick<SessionUser, 'id' | 'permissions'>): LeadDetail | null {
  const row = db.select().from(leads).where(eq(leads.id, id)).get();
  if (!row) return null;
  // phone_digits is for matching in SQL only, not part of the API shape.
  const { phoneDigits: _digits, ...lead } = row;
  const activityRows = db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.createdAt), desc(leadActivities.id))
    .all();
  const names = userNames(db, [lead.assignedToId, lead.createdById, ...activityRows.map((a) => a.createdById)]);
  const preferred = lead.preferredCourseId
    ? (db
        .select({
          id: courses.id,
          name: courses.name,
          level: courses.level,
          status: courses.status,
          teacherId: courses.teacherId,
          teacherName: users.name,
        })
        .from(courses)
        .leftJoin(users, eq(users.id, courses.teacherId))
        .where(eq(courses.id, lead.preferredCourseId))
        .get() ?? null)
    : null;
  return {
    ...lead,
    assignedToName: lead.assignedToId !== null ? (names.get(lead.assignedToId) ?? null) : null,
    createdByName: lead.createdById !== null ? (names.get(lead.createdById) ?? null) : null,
    preferredCourse: preferred,
    student: lead.studentId !== null ? { id: lead.studentId, visible: maySeeStudent(db, viewer, lead.studentId) } : null,
    interviews: loadInterviews(db, eq(interviews.leadId, id)),
    activities: activityRows.map((a) => toActivity(a, names)),
  };
}

// ── Duplicates ──────────────────────────────────────────────────────────────

/**
 * Students with the same phone (as international digits) or email. SQL narrows
 * by the last 7 digits (the stored phone_digits: Arabic digits read, marks ignored);
 * the exact comparison runs here, so "010…" matches "+20 10…". Names only.
 */
export function findStudentMatches(
  db: Pick<DB, 'select'>,
  phone: string | null | undefined,
  email: string | null | undefined,
  countryCode: string,
): { id: number; name: string }[] {
  const intl = internationalPhone(phone, countryCode);
  const mail = email?.trim().toLowerCase() || null;
  const conds: SQL[] = [];
  if (intl) conds.push(sql`${students.phoneDigits} like ${`%${intl.slice(-7)}`}`);
  if (mail) conds.push(sql`lower(${students.email}) = ${mail}`);
  if (!conds.length) return [];
  return db
    .select({ id: students.id, firstName: students.firstName, lastName: students.lastName, phone: students.phone, email: students.email })
    .from(students)
    .where(or(...conds))
    .orderBy(asc(students.id))
    .all()
    .filter((s) => (intl !== null && internationalPhone(s.phone, countryCode) === intl) || (mail !== null && s.email?.toLowerCase() === mail))
    .map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }));
}

/**
 * Open leads and students with the same phone or email. `excludeLeadId` (the
 * lead being edited) leaves out that lead and the student made from it.
 */
export function findDuplicates(
  db: Pick<DB, 'select'>,
  opts: { phone?: string | null; email?: string | null; excludeLeadId?: number; countryCode: string },
): DuplicateMatch[] {
  const intl = internationalPhone(opts.phone, opts.countryCode);
  const mail = opts.email?.trim().toLowerCase() || null;
  const conds: SQL[] = [];
  if (intl) conds.push(sql`${leads.phoneDigits} like ${`%${intl.slice(-7)}`}`);
  if (mail) conds.push(sql`lower(${leads.email}) = ${mail}`);
  const leadMatches: DuplicateMatch[] = conds.length
    ? db
        .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, phone: leads.phone, email: leads.email, status: leads.status })
        .from(leads)
        .where(and(leadIsOpen, or(...conds), opts.excludeLeadId ? ne(leads.id, opts.excludeLeadId) : undefined))
        .orderBy(asc(leads.id))
        .all()
        .filter((l) => (intl !== null && internationalPhone(l.phone, opts.countryCode) === intl) || (mail !== null && l.email?.toLowerCase() === mail))
        .map((l) => ({ kind: 'lead' as const, id: l.id, name: `${l.firstName} ${l.lastName}`, status: l.status }))
    : [];
  const ownStudentId = opts.excludeLeadId
    ? (db.select({ studentId: leads.studentId }).from(leads).where(eq(leads.id, opts.excludeLeadId)).get()?.studentId ?? null)
    : null;
  const studentMatches: DuplicateMatch[] = findStudentMatches(db, opts.phone, opts.email, opts.countryCode)
    .filter((s) => s.id !== ownStudentId)
    .map((s) => ({ kind: 'student' as const, ...s }));
  return [...leadMatches, ...studentMatches];
}

/**
 * Before a student is deleted (students module): an enquiry enrolled as that
 * student goes back to 'accepted' with a status_change on its timeline, so it
 * can be enrolled or linked again instead of staying 'enrolled' with no student
 * (leads.student_id would only be set to NULL). Call inside the delete's transaction.
 */
export function reopenLeadsOfStudent(tx: Conn, studentId: number, userId: number) {
  const linked = tx.select({ id: leads.id, status: leads.status }).from(leads).where(eq(leads.studentId, studentId)).all();
  for (const lead of linked) {
    tx.update(leads).set({ status: 'accepted', studentId: null, updatedAt: Date.now() }).where(eq(leads.id, lead.id)).run();
    if (lead.status !== 'accepted') {
      tx.insert(leadActivities).values({ leadId: lead.id, type: 'status_change', meta: { from: lead.status, to: 'accepted' }, createdById: userId }).run();
    }
  }
}

// ── Schedule ────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" + minutes, capped at 23:59 (an interview never runs past midnight on the calendar). */
export function addMinutes(time: string, minutes: number): string {
  const total = Math.min(timeToMinutes(time) + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * Interviews dated from…to (inclusive), soonest first, as schedule events.
 * `statuses` keeps only those; `excludeStatuses` drops those. `limit` caps the rows.
 */
export function loadInterviewEvents(
  db: DB,
  opts: { from: string; to: string; statuses?: InterviewStatus[]; excludeStatuses?: InterviewStatus[]; limit?: number },
): InterviewEvent[] {
  const q = db
    .select({
      id: interviews.id,
      leadId: interviews.leadId,
      title: leadName,
      scheduledAt: interviews.scheduledAt,
      durationMinutes: interviews.durationMinutes,
      room: interviews.room,
      interviewerId: interviews.interviewerId,
      interviewerName: users.name,
      status: interviews.status,
    })
    .from(interviews)
    .innerJoin(leads, eq(leads.id, interviews.leadId))
    .leftJoin(users, eq(users.id, interviews.interviewerId))
    .where(
      and(
        // "YYYY-MM-DDTHH:MM" sorts as text, so whole days are a plain range (uses the index).
        gte(interviews.scheduledAt, `${opts.from}T00:00`),
        lte(interviews.scheduledAt, `${opts.to}T23:59`),
        opts.statuses?.length ? inArray(interviews.status, opts.statuses) : undefined,
        opts.excludeStatuses?.length ? notInArray(interviews.status, opts.excludeStatuses) : undefined,
      ),
    )
    .orderBy(asc(interviews.scheduledAt), asc(interviews.id));
  const rows = opts.limit ? q.limit(opts.limit).all() : q.all();
  return rows.map(({ scheduledAt, ...r }) => {
    const { date, time } = splitDateTime(scheduledAt);
    return {
      kind: 'interview' as const,
      id: r.id,
      leadId: r.leadId,
      title: r.title,
      date,
      startTime: time,
      endTime: addMinutes(time, r.durationMinutes),
      durationMinutes: r.durationMinutes,
      room: r.room,
      interviewerId: r.interviewerId,
      interviewerName: r.interviewerName,
      status: r.status,
    };
  });
}

// ── Creating leads ──────────────────────────────────────────────────────────

/** A new lead's columns (the caller has worked out status, assignee, follow-up…). */
export type NewLead = Omit<typeof leads.$inferInsert, 'id' | 'phoneDigits' | 'createdAt' | 'updatedAt'>;

/**
 * Insert a lead — the one path every new lead takes (POST /api/leads, the
 * website's enquiry form): phone_digits kept in step with the phone, source
 * 'other' and status 'new' unless given. Returns the new id. Inside a
 * transaction for multi-step writes.
 */
export function createLead(db: Pick<DB, 'insert'>, values: NewLead): number {
  return db
    .insert(leads)
    .values(withPhoneDigits({ ...values, source: values.source ?? 'other', status: values.status ?? 'new' }))
    .returning({ id: leads.id })
    .get().id;
}

/** What the website needs to know about an open lead with the same phone: is it the same person? */
export interface OpenLeadMatch {
  id: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nextFollowUpOn: string | null;
}

/**
 * The open leads with this phone (compared as international digits, so "010…"
 * matches "+20 10…"), most recently updated first. SQL narrows by the last 7
 * digits of the stored phone_digits; the exact match runs here.
 */
export function findOpenLeadsByPhone(db: Pick<DB, 'select'>, phone: string, countryCode: string): OpenLeadMatch[] {
  const intl = internationalPhone(phone, countryCode);
  if (!intl) return [];
  return db
    .select({ id: leads.id, phone: leads.phone, firstName: leads.firstName, lastName: leads.lastName, dateOfBirth: leads.dateOfBirth, nextFollowUpOn: leads.nextFollowUpOn })
    .from(leads)
    .where(and(leadIsOpen, sql`${leads.phoneDigits} like ${`%${intl.slice(-7)}`}`))
    .orderBy(desc(leads.updatedAt), desc(leads.id))
    .all()
    .filter((l) => internationalPhone(l.phone, countryCode) === intl)
    .map(({ phone: _phone, ...l }) => l);
}

/** The most recently updated open lead with this phone, or null. */
export function findOpenLeadByPhone(db: Pick<DB, 'select'>, phone: string, countryCode: string): { id: number } | null {
  const match = findOpenLeadsByPhone(db, phone, countryCode)[0];
  return match ? { id: match.id } : null;
}

/** A name for comparing: case, extra spaces, Arabic vowel marks and the usual spelling variants (أ/إ/آ → ا, ى → ي, ة → ه) don't count. */
function nameKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is a new enquiry from the same phone about the person an open lead is
 * already for? A parent's phone serves several children, so the phone alone
 * says nothing. The same first name, and then: the same date of birth when
 * both have one (a different one is someone else); otherwise family names that
 * agree ("M" for "Mostafa" counts — staff shorten them).
 */
export function sameLeadPerson(lead: Pick<OpenLeadMatch, 'firstName' | 'lastName' | 'dateOfBirth'>, person: { firstName: string; lastName: string; dateOfBirth: string | null }): boolean {
  if (nameKey(lead.firstName) !== nameKey(person.firstName)) return false;
  if (lead.dateOfBirth && person.dateOfBirth) return lead.dateOfBirth === person.dateOfBirth;
  const a = nameKey(lead.lastName).replace(/\.$/, '');
  const b = nameKey(person.lastName).replace(/\.$/, '');
  return !a || !b || a.startsWith(b) || b.startsWith(a);
}

/** How the website form's answers read in a lead (staff-facing text). */
export const SITE_EXPERIENCE_TEXT: Record<SiteExperienceLevel, string> = { none: 'No acting experience', some: 'Some acting experience', a_lot: 'A lot of acting experience' };
export const SITE_HEARD_FROM_TEXT: Record<SiteHeardFrom, string> = { instagram: 'Instagram', friend: 'A friend', other: 'Other' };

/** sourceDetail of a website enquiry without a workshop. */
export const WEBSITE_GENERAL_ENQUIRY = 'general';

/**
 * The website's enquiry form → a lead (source 'website', status 'new', nobody
 * assigned, no creator), with a note on its timeline saying where it came from.
 * `courseId`: the workshop applied for — it must appear on the site and accept
 * applications (else 404); null for the general form ("Not sure which
 * workshop? Ask us"). `today`: the school's (schoolToday(c)).
 *
 * The same phone again:
 * - **the same person** as an open lead (sameLeadPerson): no duplicate — a
 *   note "Applied again on the website: …" (with the date of birth and email
 *   given this time) is added to that lead and its follow-up becomes due
 *   today, so it shows up for staff (`created: false`);
 * - **someone else** (a parent enquiring for a second child, a family sharing
 *   one phone): a lead of their own, like any other, whose notes name the
 *   other open enquiry with that phone.
 */
export function createWebsiteLead(db: DB, input: SiteApplyInput, opts: { courseId: number | null; today: string }): { leadId: number; created: boolean } {
  let detail = WEBSITE_GENERAL_ENQUIRY;
  if (opts.courseId !== null) {
    const workshop = findPublicWorkshop(db, opts.courseId, opts.today);
    if (!workshop || !workshop.acceptingApplications) throw notFound('Workshop not found');
    detail = workshop.title.en;
  }
  const countryCode = getSettings(db).defaultCountryCode;
  const facts = [
    `Experience: ${SITE_EXPERIENCE_TEXT[input.experience]}`,
    `How they heard about us: ${SITE_HEARD_FROM_TEXT[input.heardFrom]}`,
    input.minor ? `Under 18 — guardian: ${input.guardianName ?? '?'} (${input.guardianPhone ?? '?'}), consent given` : null,
    `Sent from the ${input.locale === 'ar' ? 'Arabic' : 'English'} website`,
  ].filter((l): l is string => !!l);

  return db.transaction((tx) => {
    const samePhone = findOpenLeadsByPhone(tx, input.phone, countryCode);
    const existing = samePhone.find((l) => sameLeadPerson(l, input));
    if (existing) {
      const body = [
        `Applied again on the website: ${detail}`,
        `${input.firstName} ${input.lastName}`,
        input.message,
        `Date of birth: ${input.dateOfBirth}`,
        input.email ? `Email: ${input.email}` : null,
        ...facts,
      ]
        .filter(Boolean)
        .join('\n');
      tx.insert(leadActivities).values({ leadId: existing.id, type: 'note', body, meta: null, createdById: null }).run();
      // Due today (unless it already is, or was earlier): the lead comes up under "Follow-up due" and on the School home.
      const due = existing.nextFollowUpOn !== null && existing.nextFollowUpOn <= opts.today ? existing.nextFollowUpOn : opts.today;
      tx.update(leads).set({ nextFollowUpOn: due, updatedAt: Date.now() }).where(eq(leads.id, existing.id)).run();
      return { leadId: existing.id, created: false };
    }
    const others = samePhone.slice(0, 3).map((l) => `Same phone as enquiry #${l.id} (${`${l.firstName} ${l.lastName}`.trim()})`);
    const leadId = createLead(tx, {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      dateOfBirth: input.dateOfBirth,
      guardianName: input.guardianName,
      guardianPhone: input.guardianPhone,
      source: 'website',
      sourceDetail: detail,
      experience: SITE_EXPERIENCE_TEXT[input.experience],
      preferredCourseId: opts.courseId,
      status: 'new',
      assignedToId: null,
      createdById: null,
      notes: [input.message, [...facts, ...others].join('\n')].filter(Boolean).join('\n\n'),
    });
    const applied = [`Applied on the website: ${detail}`, ...others].join('\n');
    tx.insert(leadActivities).values({ leadId, type: 'note', body: applied, meta: null, createdById: null }).run();
    return { leadId, created: true };
  });
}
