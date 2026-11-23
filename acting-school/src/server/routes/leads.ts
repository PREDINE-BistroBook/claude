import { and, eq, gte, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { CLOSED_LEAD_STATUSES, OPEN_LEAD_STATUSES, isClosedLeadStatus, type InterviewStatus, type LeadLostReason, type LeadStatus } from '../../shared/enums';
import {
  ADMISSIONS_ERROR_CODES,
  DEFAULT_INTERVIEW_MINUTES,
  INTERVIEW_ASSESSMENT_FIELDS,
  enrolInput,
  interviewScheduleInput,
  interviewUpdateInput,
  leadActivityInput,
  leadDuplicatesQuery,
  leadInput,
  leadListQuery,
  leadUpdateInput,
  type AdmissionsCourseOption,
  type DuplicateMatch,
  type EnrolResult,
  type LeadActivityMeta,
  type LeadCounts,
  type LeadDetail,
  type LeadListItem,
  type LeadUpdateInput,
  type PossibleDuplicateDetails,
} from '../../shared/schemas/admissions';
import type { SessionUser } from '../../shared/schemas/auth';
import type { ListResponse } from '../../shared/schemas/common';
import type { DB } from '../db/database';
import { courses, interviews, leadActivities, leads, students } from '../db/schema';
import type { AppEnv } from '../env';
import { schoolToday } from '../lib/clock';
import { hasPermission, isVisibleActiveStaff, type Conn } from '../lib/access';
import {
  createLead,
  findDuplicates,
  findStudentMatches,
  followUpDue,
  leadIsOpen,
  loadInterview,
  loadLeadDetail,
  loadLeadListItems,
  leadHasDoneInterview,
  toActivity,
  userNames,
  type LeadRow,
} from '../lib/admissions';
import { loadCourseListItems } from '../lib/classSessions';
import { addEnrollment, ensureEnrolled } from '../lib/enrollments';
import { ApiError, fieldError, forbidden, notFound } from '../lib/errors';
import { getSettings } from '../lib/settings';
import { body, paramId, query } from '../lib/validate';
import { phoneSearchDigits, withPhoneDigits } from '../lib/phone';
import { contains } from '../lib/sqlLimits';
import { currentUser, requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Admissions: enquiries ("leads") → follow-ups → interviews → decision →
 * enrolled student. Every route needs admissions.read; leads are not
 * class-scoped and their contact details are visible to anyone who may read
 * them (they have to call them). Writes need admissions.write; recording an
 * interview assessment, accepting/declining, enrolling and deleting need
 * admissions.decide — which on its own (without admissions.write) is enough
 * for those decisions, nothing else. Enrolling creates the student and the
 * enrollment even without students.write / courses.write (linking only a
 * student the possible_duplicate answer named); afterwards the student follows
 * the students module's own rules.
 *
 * Status moves on its own: logging a contact on a new lead → contacted;
 * scheduling an interview → interview_scheduled (an accepted lead keeps its
 * decision); recording it done → interviewed; a no-show (or cancelling the
 * last scheduled interview) → back to interviewed if an interview is done,
 * else contacted; enrolling → enrolled. Every status change writes a
 * status_change activity { from, to }. Closing a lead (enrolled/declined/lost)
 * clears its follow-up date and cancels interviews still scheduled.
 *
 * Writes read the request body first and only then the lead, inside their
 * transaction: nothing awaits in between, so a slow upload can't write back a
 * status read before someone else's change (e.g. an enrol).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('admissions.read');
const canWrite = requirePermission('admissions.write');
const canDecide = requirePermission('admissions.decide');
/** Editing a lead / an interview: admissions.write, or admissions.decide alone for decisions (checked in the handler). */
const canWriteOrDecide = requireAnyPermission('admissions.write', 'admissions.decide');

router.use(canRead);

const decides = (me: SessionUser) => hasPermission(me, 'admissions.decide');
const writes = (me: SessionUser) => hasPermission(me, 'admissions.write');

const leadEnrolledError = () => new ApiError(409, ADMISSIONS_ERROR_CODES.leadEnrolled, 'This lead is already enrolled');
const leadClosedError = () => new ApiError(409, ADMISSIONS_ERROR_CODES.leadClosed, 'This lead is closed; reopen it first');

function findLead(db: Pick<DB, 'select'>, id: number): LeadRow {
  const row = db.select().from(leads).where(eq(leads.id, id)).get();
  if (!row) throw notFound('Lead not found');
  return row;
}

/** Assignees and interviewers: an active staff member the caller may see (hidden owners answer like missing ids). */
function assertStaff(db: Pick<DB, 'select'>, me: SessionUser, userId: number, path: string, message: string) {
  if (!isVisibleActiveStaff(db, me, userId)) throw fieldError([path], message);
}

/** A class that exists and isn't archived (for preferred / recommended class). */
function assertCourseAvailable(db: Pick<DB, 'select'>, courseId: number, path: string) {
  const course = db.select({ status: courses.status }).from(courses).where(eq(courses.id, courseId)).get();
  if (!course) throw fieldError([path], 'admissions:errors.courseNotFound');
  if (course.status === 'archived') throw fieldError([path], 'admissions:errors.courseArchived');
}

// ── Status rules ────────────────────────────────────────────────────────────

interface StatusPlan {
  status: LeadStatus;
  lostReason: LeadLostReason | null;
  /** undefined: leave the stored follow-up as it is. */
  nextFollowUpOn: string | null | undefined;
}

/**
 * Where a lead ends up after a create / edit / logged contact, enforcing the
 * manual rules: an enrolled lead's status is final; 'enrolled' only through
 * the enrol action; 'accepted'/'declined' need admissions.decide; 'lost' needs
 * a reason (cleared for any other status); closed leads have no follow-up.
 * `auto` is the status the action implies when none was asked for.
 */
function planStatus(
  me: SessionUser,
  existing: Pick<LeadRow, 'status' | 'lostReason'> | null,
  input: { status?: LeadStatus; lostReason?: LeadLostReason | null; nextFollowUpOn?: string | null },
  auto?: LeadStatus,
): StatusPlan {
  const from = existing?.status ?? null;
  if (input.status !== undefined && input.status !== from) {
    if (from === 'enrolled') throw new ApiError(409, ADMISSIONS_ERROR_CODES.leadEnrolled, 'An enrolled lead’s status can’t be changed');
    if (input.status === 'enrolled') throw fieldError(['status'], 'admissions:errors.enrolViaAction');
    if ((input.status === 'accepted' || input.status === 'declined') && !decides(me)) {
      throw forbidden('Accepting or declining needs the admissions decisions permission');
    }
  }
  const status = input.status ?? auto ?? from ?? 'new';
  let lostReason: LeadLostReason | null = null;
  if (status === 'lost') {
    lostReason = input.lostReason !== undefined ? input.lostReason : from === 'lost' ? (existing?.lostReason ?? null) : null;
    if (!lostReason) throw fieldError(['lostReason'], 'admissions:errors.lostReasonRequired');
  }
  let nextFollowUpOn = input.nextFollowUpOn;
  if (isClosedLeadStatus(status)) {
    if (nextFollowUpOn) throw fieldError(['nextFollowUpOn'], 'admissions:errors.followUpClosed');
    nextFollowUpOn = null;
  }
  return { status, lostReason, nextFollowUpOn };
}

function logActivity(tx: Conn, leadId: number, me: SessionUser, type: (typeof leadActivities.$inferInsert)['type'], meta: LeadActivityMeta | null, text: string | null = null) {
  return tx
    .insert(leadActivities)
    .values({ leadId, type, body: text, meta, createdById: me.id })
    .returning()
    .get();
}

function logStatusChange(tx: Conn, leadId: number, me: SessionUser, from: LeadStatus, to: LeadStatus, lostReason: LeadLostReason | null = null) {
  logActivity(tx, leadId, me, 'status_change', to === 'lost' ? { from, to, lostReason } : { from, to });
}

/** Closing a lead cancels its interviews still scheduled (each one noted on the timeline). */
function cancelScheduledInterviews(tx: Conn, leadId: number, me: SessionUser) {
  const open = tx
    .select({ id: interviews.id, scheduledAt: interviews.scheduledAt })
    .from(interviews)
    .where(and(eq(interviews.leadId, leadId), eq(interviews.status, 'scheduled')))
    .all();
  for (const iv of open) {
    tx.update(interviews).set({ status: 'cancelled' }).where(eq(interviews.id, iv.id)).run();
    logActivity(tx, leadId, me, 'interview_recorded', { interviewId: iv.id, scheduledAt: iv.scheduledAt, interviewStatus: 'cancelled' });
  }
}

/** After a planned status has been stored on the lead: its timeline entry, and closing's side effect. No-op when the status didn't change. */
function applyStatus(tx: Conn, lead: Pick<LeadRow, 'id' | 'status'>, plan: StatusPlan, me: SessionUser) {
  if (plan.status !== lead.status) {
    logStatusChange(tx, lead.id, me, lead.status, plan.status, plan.lostReason);
    if (isClosedLeadStatus(plan.status)) cancelScheduledInterviews(tx, lead.id, me);
  }
}

function moveStatus(tx: Conn, lead: Pick<LeadRow, 'id' | 'status'>, to: LeadStatus, me: SessionUser) {
  if (lead.status === to) return;
  tx.update(leads).set({ status: to }).where(eq(leads.id, lead.id)).run();
  logStatusChange(tx, lead.id, me, lead.status, to);
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Names, email and phone (digits in any format: "010 123" finds "+20 10123…", "+20 100…" finds "0100…").
 * Substring matches with instr, not LIKE (lib/sqlLimits.ts).
 */
function searchCondition(q: string, countryCode: string): SQL {
  const term = q.replace(/\s+/g, ' ');
  const parts: SQL[] = [
    contains(leads.firstName, term),
    contains(leads.lastName, term),
    contains(sql`(${leads.firstName} || ' ' || ${leads.lastName})`, term),
    contains(sql`(${leads.lastName} || ' ' || ${leads.firstName})`, term),
    contains(leads.email, term),
    contains(leads.phone, term),
  ];
  for (const digits of phoneSearchDigits(term, countryCode) ?? []) parts.push(contains(leads.phoneDigits, digits));
  return or(...parts)!;
}

const GROUP_WHERE: Record<string, (today: string) => SQL | undefined> = {
  open: () => leadIsOpen,
  closed: () => inArray(leads.status, [...CLOSED_LEAD_STATUSES]),
  follow_up_due: (today) => followUpDue(today),
  interviews: () => inArray(leads.status, ['interview_scheduled', 'interviewed']),
};

// ── Lists and lookups (registered before /:id) ──────────────────────────────

router.get('/', (c) => {
  const q = query(c, leadListQuery);
  const today = schoolToday(c);
  const where = and(
    q.status ? eq(leads.status, q.status) : undefined,
    q.group ? GROUP_WHERE[q.group]!(today) : undefined,
    q.source ? eq(leads.source, q.source) : undefined,
    q.assignedToId ? eq(leads.assignedToId, q.assignedToId) : undefined,
    q.q ? searchCondition(q.q, getSettings(c.get('db')).defaultCountryCode) : undefined,
  );
  return c.json<ListResponse<LeadListItem>>({ items: loadLeadListItems(c.get('db'), where) });
});

router.get('/counts', (c) => {
  const today = schoolToday(c);
  const open = sql.join(
    OPEN_LEAD_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const row = c
    .get('db')
    .get<{ followUpDue: number | null; new: number | null; interviews: number | null; open: number | null; closed: number | null }>(sql`
      select
        sum(case when status in (${open}) and next_follow_up_on <= ${today} then 1 else 0 end) as followUpDue,
        sum(case when status = 'new' then 1 else 0 end) as new,
        sum(case when status in ('interview_scheduled', 'interviewed') then 1 else 0 end) as interviews,
        sum(case when status in (${open}) then 1 else 0 end) as open,
        sum(case when status not in (${open}) then 1 else 0 end) as closed
      from ${leads}
    `);
  const res: LeadCounts = {
    followUpDue: row?.followUpDue ?? 0,
    new: row?.new ?? 0,
    interviews: row?.interviews ?? 0,
    open: row?.open ?? 0,
    closed: row?.closed ?? 0,
  };
  return c.json(res);
});

router.get('/duplicates', (c) => {
  const q = query(c, leadDuplicatesQuery);
  const db = c.get('db');
  const items = findDuplicates(db, { phone: q.phone, email: q.email, excludeLeadId: q.excludeLeadId, countryCode: getSettings(db).defaultCountryCode });
  return c.json<ListResponse<DuplicateMatch>>({ items });
});

router.get('/course-options', (c) => {
  const today = schoolToday(c);
  const items: AdmissionsCourseOption[] = loadCourseListItems(c.get('db'), and(eq(courses.status, 'active'), gte(courses.endDate, today)), today).map(
    ({ description: _d, createdAt: _c, updatedAt: _u, ...course }) => ({
      ...course,
      freePlaces: course.capacity === null ? null : Math.max(0, course.capacity - course.enrolledCount),
    }),
  );
  return c.json<ListResponse<AdmissionsCourseOption>>({ items });
});

// ── Leads ───────────────────────────────────────────────────────────────────

function detail(db: DB, id: number, me: SessionUser): LeadDetail {
  const d = loadLeadDetail(db, id, me);
  if (!d) throw notFound('Lead not found');
  return d;
}

router.post('/', canWrite, async (c) => {
  const me = currentUser(c);
  const db = c.get('db');
  const input = await body(c, leadInput);
  if (input.assignedToId) assertStaff(db, me, input.assignedToId, 'assignedToId', 'admissions:errors.assigneeInvalid');
  if (input.preferredCourseId) assertCourseAvailable(db, input.preferredCourseId, 'preferredCourseId');
  const plan = planStatus(me, null, input);
  const { status: _s, lostReason: _l, nextFollowUpOn: _n, ...fields } = input;
  const createdId = createLead(db, {
    ...fields,
    source: input.source ?? 'other',
    // The creator unless someone (or nobody: null) was named.
    assignedToId: input.assignedToId === undefined ? me.id : input.assignedToId,
    status: plan.status,
    lostReason: plan.lostReason,
    nextFollowUpOn: plan.nextFollowUpOn ?? null,
    createdById: me.id,
  });
  return c.json(detail(db, createdId, me), 201);
});

router.get('/:id', (c) => c.json(detail(c.get('db'), paramId(c), currentUser(c))));

/** admissions.decide without admissions.write: PATCH /:id may only accept or decline. */
function assertDecisionOnly(input: LeadUpdateInput) {
  const sent = Object.keys(input).filter((k) => input[k as keyof LeadUpdateInput] !== undefined);
  const decision = input.status === undefined || input.status === 'accepted' || input.status === 'declined';
  if (!decision || sent.some((k) => k !== 'status')) throw forbidden('Editing leads needs the admissions write permission');
}

/** The status / lost reason / follow-up columns a plan changes (unchanged ones aren't written). */
function statusColumns(existing: Pick<LeadRow, 'status' | 'lostReason'>, plan: StatusPlan): Partial<typeof leads.$inferInsert> {
  return {
    ...(plan.status !== existing.status ? { status: plan.status } : {}),
    ...(plan.lostReason !== existing.lostReason ? { lostReason: plan.lostReason } : {}),
    ...(plan.nextFollowUpOn !== undefined ? { nextFollowUpOn: plan.nextFollowUpOn } : {}),
  };
}

router.patch('/:id', canWriteOrDecide, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const input = await body(c, leadUpdateInput);
  if (!writes(me)) assertDecisionOnly(input);
  db.transaction((tx) => {
    const existing = findLead(tx, id);
    if (input.assignedToId && input.assignedToId !== existing.assignedToId) {
      assertStaff(tx, me, input.assignedToId, 'assignedToId', 'admissions:errors.assigneeInvalid');
    }
    if (input.preferredCourseId && input.preferredCourseId !== existing.preferredCourseId) {
      assertCourseAvailable(tx, input.preferredCourseId, 'preferredCourseId');
    }
    const plan = planStatus(me, existing, input);
    const { status: _s, lostReason: _l, nextFollowUpOn: _n, ...rest } = input;
    const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<typeof leads.$inferInsert>;
    tx.update(leads)
      .set(withPhoneDigits({ ...fields, ...statusColumns(existing, plan), updatedAt: Date.now() }))
      .where(eq(leads.id, id))
      .run();
    applyStatus(tx, existing, plan, me);
  });
  return c.json(detail(db, id, me));
});

router.delete('/:id', canDecide, (c) => {
  const id = paramId(c);
  const db = c.get('db');
  findLead(db, id);
  // Activities and interviews cascade; an enrolled student is kept.
  db.delete(leads).where(eq(leads.id, id)).run();
  return c.body(null, 204);
});

// ── Timeline ────────────────────────────────────────────────────────────────

router.post('/:id/activities', canWrite, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const input = await body(c, leadActivityInput);
  const activity = db.transaction((tx) => {
    const lead = findLead(tx, id);
    // Contacting a new lead means they've been contacted (a note alone doesn't).
    const auto = input.status === undefined && input.type !== 'note' && lead.status === 'new' ? 'contacted' : undefined;
    const plan = planStatus(me, lead, input, auto);
    const row = logActivity(
      tx,
      id,
      me,
      input.type,
      input.nextFollowUpOn !== undefined ? { nextFollowUpOn: plan.nextFollowUpOn ?? null } : null,
      input.body ?? null,
    );
    tx.update(leads)
      .set({ ...statusColumns(lead, plan), updatedAt: Date.now() })
      .where(eq(leads.id, id))
      .run();
    applyStatus(tx, lead, plan, me);
    return row;
  });
  return c.json(toActivity(activity, userNames(db, [me.id])), 201);
});

// ── Interviews ──────────────────────────────────────────────────────────────

function assertCanSchedule(lead: Pick<LeadRow, 'status'>) {
  if (lead.status === 'enrolled') throw leadEnrolledError();
  if (isClosedLeadStatus(lead.status)) throw leadClosedError();
}

/** Statuses that scheduling an interview moves to interview_scheduled (an accepted lead keeps its decision). */
const MOVES_TO_INTERVIEW_SCHEDULED: readonly LeadStatus[] = ['new', 'contacted', 'interviewed'];

router.post('/:id/interviews', canWrite, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const input = await body(c, interviewScheduleInput);
  const interviewId = db.transaction((tx) => {
    const lead = findLead(tx, id);
    assertCanSchedule(lead);
    if (input.interviewerId) assertStaff(tx, me, input.interviewerId, 'interviewerId', 'admissions:errors.interviewerInvalid');
    const created = tx
      .insert(interviews)
      .values({
        leadId: id,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES,
        room: input.room ?? null,
        interviewerId: input.interviewerId ?? null,
        notes: input.notes ?? null,
        status: 'scheduled',
      })
      .returning({ id: interviews.id })
      .get();
    logActivity(tx, id, me, 'interview_scheduled', { interviewId: created.id, scheduledAt: input.scheduledAt });
    if (MOVES_TO_INTERVIEW_SCHEDULED.includes(lead.status)) moveStatus(tx, lead, 'interview_scheduled', me);
    tx.update(leads).set({ updatedAt: Date.now() }).where(eq(leads.id, id)).run();
    return created.id;
  });
  return c.json(loadInterview(db, interviewId), 201);
});

router.patch('/:id/interviews/:interviewId', canWriteOrDecide, async (c) => {
  const leadId = paramId(c);
  const interviewId = paramId(c, 'interviewId');
  const me = currentUser(c);
  const db = c.get('db');
  const input = await body(c, interviewUpdateInput);
  const criteria = getSettings(db).interviewCriteria;

  db.transaction((tx) => {
    const lead = findLead(tx, leadId);
    const iv = tx
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.leadId, leadId)))
      .get();
    if (!iv) throw notFound('Interview not found');

    const assessment = INTERVIEW_ASSESSMENT_FIELDS.some((f) => input[f] !== undefined);
    // Sending an assessment records the interview as done.
    const nextStatus: InterviewStatus = input.status ?? (assessment ? 'done' : iv.status);
    if (assessment && nextStatus !== 'done') throw fieldError(['status'], 'admissions:errors.assessmentNeedsDone');
    const statusChanged = nextStatus !== iv.status;
    const touchesAnything = Object.values(input).some((v) => v !== undefined);
    const rescheduled =
      (input.scheduledAt !== undefined && input.scheduledAt !== iv.scheduledAt) ||
      (input.durationMinutes !== undefined && input.durationMinutes !== iv.durationMinutes);

    // Who may: the assessment, recording done, and any change to a done interview need admissions.decide …
    const needsDecide = assessment || (statusChanged && (nextStatus === 'done' || iv.status === 'done')) || (iv.status === 'done' && touchesAnything);
    if (needsDecide && !decides(me)) throw forbidden('Recording interview assessments needs the admissions decisions permission');
    // … the time, room, interviewer, cancelling / no-show / back to scheduled, and notes outside an assessment need admissions.write.
    const recording = assessment || nextStatus === 'done' || iv.status === 'done';
    const changes = (k: 'room' | 'interviewerId' | 'notes') => input[k] !== undefined && input[k] !== iv[k];
    const needsWrite = rescheduled || changes('room') || changes('interviewerId') || (statusChanged && nextStatus !== 'done') || (changes('notes') && !recording);
    if (needsWrite && !writes(me)) throw forbidden('Rescheduling or cancelling interviews needs the admissions write permission');

    // Only a scheduled interview has a time to change.
    if (rescheduled && nextStatus !== 'scheduled') {
      throw new ApiError(409, ADMISSIONS_ERROR_CODES.interviewNotScheduled, 'Only a scheduled interview can be rescheduled');
    }
    // A closed lead gets no interview back on the calendar.
    if (nextStatus === 'scheduled' && (statusChanged || rescheduled)) assertCanSchedule(lead);

    if (input.interviewerId && input.interviewerId !== iv.interviewerId) {
      assertStaff(tx, me, input.interviewerId, 'interviewerId', 'admissions:errors.interviewerInvalid');
    }
    if (input.recommendedCourseId && input.recommendedCourseId !== iv.recommendedCourseId) {
      assertCourseAvailable(tx, input.recommendedCourseId, 'recommendedCourseId');
    }
    if (input.scores) {
      // Current criteria, plus keys already stored here (scores of a removed criterion are kept).
      const allowed = new Set([...criteria.map((cr) => cr.key), ...Object.keys(iv.scores ?? {})]);
      for (const key of Object.keys(input.scores)) {
        if (!allowed.has(key)) throw fieldError(['scores', key], 'admissions:errors.unknownCriterion');
      }
    }

    const patch: Partial<typeof interviews.$inferInsert> = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (input.scores === null) patch.scores = {};
    patch.status = nextStatus;
    if (assessment || (statusChanged && (nextStatus === 'done' || nextStatus === 'no_show'))) {
      patch.recordedById = me.id;
      patch.recordedAt = Date.now();
    }

    tx.update(interviews).set(patch).where(eq(interviews.id, interviewId)).run();
    const scheduledAt = input.scheduledAt ?? iv.scheduledAt;
    if (statusChanged && nextStatus === 'scheduled') {
      logActivity(tx, leadId, me, 'interview_scheduled', { interviewId, scheduledAt });
    } else if (statusChanged) {
      const meta: LeadActivityMeta = { interviewId, scheduledAt, interviewStatus: nextStatus };
      if (nextStatus === 'done') meta.recommendation = input.recommendation !== undefined ? input.recommendation : iv.recommendation;
      logActivity(tx, leadId, me, 'interview_recorded', meta);
    } else if (rescheduled && input.scheduledAt !== undefined && input.scheduledAt !== iv.scheduledAt) {
      logActivity(tx, leadId, me, 'interview_scheduled', { interviewId, scheduledAt, previousScheduledAt: iv.scheduledAt });
    }

    // The lead follows its interviews while it is open (an accepted lead keeps its decision).
    if (statusChanged && !isClosedLeadStatus(lead.status)) {
      if (nextStatus === 'done' && ['new', 'contacted', 'interview_scheduled'].includes(lead.status)) {
        moveStatus(tx, lead, 'interviewed', me);
      } else if ((nextStatus === 'no_show' || nextStatus === 'cancelled') && lead.status === 'interview_scheduled') {
        const stillScheduled = tx
          .select({ id: interviews.id })
          .from(interviews)
          .where(and(eq(interviews.leadId, leadId), eq(interviews.status, 'scheduled'), ne(interviews.id, interviewId)))
          .get();
        // Back to where it was before this interview: assessed already, or just contacted.
        if (!stillScheduled) moveStatus(tx, lead, leadHasDoneInterview(tx, leadId) ? 'interviewed' : 'contacted', me);
      } else if (nextStatus === 'scheduled' && MOVES_TO_INTERVIEW_SCHEDULED.includes(lead.status)) {
        moveStatus(tx, lead, 'interview_scheduled', me);
      }
    }
    tx.update(leads).set({ updatedAt: Date.now() }).where(eq(leads.id, leadId)).run();
  });
  return c.json(loadInterview(db, interviewId));
});

// ── Enrol ───────────────────────────────────────────────────────────────────

router.post('/:id/enrol', canDecide, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const input = await body(c, enrolInput);
  const countryCode = getSettings(db).defaultCountryCode;
  const joinedOn = input.joinedOn ?? schoolToday(c);

  const result = db.transaction((tx) => {
    // Read inside the transaction: two enrol requests must not both win.
    const lead = findLead(tx, id);
    if (lead.status === 'enrolled' || lead.studentId !== null) throw leadEnrolledError();

    const course = tx.select().from(courses).where(eq(courses.id, input.courseId)).get();
    if (!course) throw fieldError(['courseId'], 'admissions:errors.courseNotFound');
    if (course.status === 'archived') throw new ApiError(409, ADMISSIONS_ERROR_CODES.courseArchived, 'This class is archived');

    const matches = input.createNew ? [] : findStudentMatches(tx, lead.phone, lead.email, countryCode);
    let linked: { id: number; status: (typeof students.$inferSelect)['status'] } | undefined;
    if (input.linkStudentId) {
      // Only a student the possible_duplicate answer names (same phone or email); any other id answers like a
      // missing one, so admissions.decide can't enrol or reactivate arbitrary students, nor probe which ids exist.
      if (!matches.some((m) => m.id === input.linkStudentId)) throw fieldError(['linkStudentId'], 'admissions:errors.studentNotFound');
      linked = tx.select({ id: students.id, status: students.status }).from(students).where(eq(students.id, input.linkStudentId)).get()!;
    } else if (!input.createNew && matches.length) {
      const details: PossibleDuplicateDetails = { matches };
      throw new ApiError(409, ADMISSIONS_ERROR_CODES.possibleDuplicate, 'A student with the same phone or email already exists', undefined, details);
    }

    let studentId: number;
    let enrollmentId: number;
    if (linked) {
      studentId = linked.id;
      if (linked.status !== 'active') tx.update(students).set({ status: 'active' }).where(eq(students.id, linked.id)).run();
      // Already in the class → that enrollment; in it before → re-enrolled (capacity checked); else a new one.
      enrollmentId = ensureEnrolled(tx, course, studentId, joinedOn);
    } else {
      studentId = tx
        .insert(students)
        .values(
          withPhoneDigits({
            firstName: lead.firstName,
            lastName: lead.lastName,
            phone: lead.phone,
            email: lead.email,
            dateOfBirth: lead.dateOfBirth,
            gender: lead.gender,
            guardianName: lead.guardianName,
            guardianPhone: lead.guardianPhone,
            // Students have no city field: it travels in the notes.
            notes: lead.city ? `From admissions\nCity: ${lead.city}` : 'From admissions',
            status: 'active' as const,
            joinedOn,
            mediaConsent: false,
            createdBy: me.id,
          }),
        )
        .returning({ id: students.id })
        .get().id;
      // The classes module's rules: capacity (a new student has no enrollment yet). A refusal rolls everything back.
      enrollmentId = addEnrollment(tx, course, studentId, joinedOn);
    }

    tx.update(leads).set({ status: 'enrolled', studentId, lostReason: null, nextFollowUpOn: null, updatedAt: Date.now() }).where(eq(leads.id, id)).run();
    logStatusChange(tx, id, me, lead.status, 'enrolled');
    cancelScheduledInterviews(tx, id, me);
    logActivity(tx, id, me, 'enrolled', { courseId: course.id, courseName: course.name, studentId, linkedExistingStudent: !!linked });
    return { studentId, enrollmentId, createdStudent: !linked };
  });

  const res: EnrolResult = { lead: detail(db, id, me), ...result };
  return c.json(res, 201);
});

export default router;
