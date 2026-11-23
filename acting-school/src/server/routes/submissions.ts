import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { SUBMISSION_STATUSES } from '../../shared/enums';
import { isSendingStatus, submissionInput, submissionUpdateInput, type Submission } from '../../shared/schemas/castings';
import type { DB } from '../db/database';
import { castingRoles, submissions, talent } from '../db/schema';
import type { AppEnv } from '../env';
import { inChunks } from '../lib/sqlLimits';
import { ApiError, notFound, sqliteConstraint } from '../lib/errors';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAuth, requirePermission, userCan } from '../middleware/auth';

/**
 * Submissions: a talent put forward for one casting role, and how far they got
 * (shortlisted → submitted → audition → callback → booked, or rejected /
 * withdrawn). A talent is on a role at most once. castings.write builds the
 * shortlist; moving someone to a status that sends them to the client
 * (submitted, audition, callback, booked) also needs castings.send.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canWrite = requirePermission('castings.write');

/** Pipeline position of a status (SUBMISSION_STATUSES order), for sorting in SQL. */
const pipelineOrder = sql.join(
  [sql`case ${submissions.status}`, ...SUBMISSION_STATUSES.map((s, i) => sql`when ${s} then ${sql.raw(String(i))}`), sql`else 99 end`],
  sql` `,
);

/** Columns of a Submission (with its talent summary); select from submissions inner join talent. */
const submissionColumns = {
  id: submissions.id,
  roleId: submissions.roleId,
  talentId: submissions.talentId,
  status: submissions.status,
  auditionAt: submissions.auditionAt,
  auditionLocation: submissions.auditionLocation,
  notes: submissions.notes,
  createdAt: submissions.createdAt,
  updatedAt: submissions.updatedAt,
  talentFirstName: talent.firstName,
  talentLastName: talent.lastName,
  talentStageName: talent.stageName,
  talentHeadshotFileId: talent.headshotFileId,
};

function selectSubmissions(db: DB) {
  return db.select(submissionColumns).from(submissions).innerJoin(talent, eq(talent.id, submissions.talentId));
}
type SubmissionRow = NonNullable<ReturnType<ReturnType<typeof selectSubmissions>['get']>>;

function toSubmission(r: SubmissionRow): Submission {
  return {
    id: r.id,
    roleId: r.roleId,
    talentId: r.talentId,
    status: r.status,
    auditionAt: r.auditionAt,
    auditionLocation: r.auditionLocation,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    talent: {
      id: r.talentId,
      firstName: r.talentFirstName,
      lastName: r.talentLastName,
      stageName: r.talentStageName,
      headshotFileId: r.talentHeadshotFileId,
    },
  };
}

/**
 * Submissions of several roles in one query, grouped by role id. Each role's
 * list is in pipeline order (SUBMISSION_STATUSES), most recently changed first
 * within a status. Used by the castings routes for details and role updates.
 */
export function submissionsForRoles(db: DB, roleIds: number[]): Map<number, Submission[]> {
  const out = new Map<number, Submission[]>();
  if (!roleIds.length) return out;
  // In slices of roles (a role's submissions all come in the same slice, so each list keeps its order).
  const rows = inChunks(roleIds, (ids) =>
    selectSubmissions(db).where(inArray(submissions.roleId, ids)).orderBy(pipelineOrder, desc(submissions.updatedAt), desc(submissions.id)).all(),
  );
  for (const r of rows) {
    const list = out.get(r.roleId) ?? [];
    list.push(toSubmission(r));
    out.set(r.roleId, list);
  }
  return out;
}

function loadSubmission(db: DB, id: number): Submission {
  const row = selectSubmissions(db).where(eq(submissions.id, id)).get();
  if (!row) throw notFound('Submission not found');
  return toSubmission(row);
}

function fieldIssue(field: string, message: string): ApiError {
  return new ApiError(400, 'validation', 'Some fields are missing or invalid', [{ path: [field], code: 'custom', message }]);
}

const alreadySubmitted = () => new ApiError(409, 'already_submitted', 'This talent is already on this role');
const cannotSend = () => new ApiError(403, 'cannot_send', 'Sending talent to the client needs the castings.send permission');

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', canWrite, async (c) => {
  const input = await body(c, submissionInput);
  if (input.status && isSendingStatus(input.status) && !userCan(c, 'castings.send')) throw cannotSend();
  const db = c.get('db');

  const role = db.select({ id: castingRoles.id }).from(castingRoles).where(eq(castingRoles.id, input.roleId)).get();
  if (!role) throw fieldIssue('roleId', 'castings:errors.roleNotFound');
  const person = db.select({ id: talent.id }).from(talent).where(eq(talent.id, input.talentId)).get();
  if (!person) throw fieldIssue('talentId', 'castings:errors.talentNotFound');

  const existing = db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.roleId, input.roleId), eq(submissions.talentId, input.talentId)))
    .get();
  if (existing) throw alreadySubmitted();

  let id: number;
  try {
    id = db
      .insert(submissions)
      .values({ ...input, status: input.status ?? 'shortlisted', createdBy: currentUser(c).id })
      .returning({ id: submissions.id })
      .get()!.id;
  } catch (err) {
    // Two people adding the same talent at once: the unique index decides.
    if (sqliteConstraint(err) === 'unique') throw alreadySubmitted();
    throw err;
  }
  return c.json(loadSubmission(db, id), 201);
});

// ── Update ──────────────────────────────────────────────────────────────────

router.patch('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const raw = await body(c, submissionUpdateInput);
  const input = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as typeof raw;
  const db = c.get('db');
  const found = db.select({ id: submissions.id, status: submissions.status }).from(submissions).where(eq(submissions.id, id)).get();
  if (!found) throw notFound('Submission not found');
  // Sending is a change of status; saving other fields of an already-sent submission is fine.
  if (input.status && input.status !== found.status && isSendingStatus(input.status) && !userCan(c, 'castings.send')) throw cannotSend();
  if (Object.keys(input).length) db.update(submissions).set(input).where(eq(submissions.id, id)).run();
  return c.json(loadSubmission(db, id));
});

// ── Delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', canWrite, (c) => {
  const id = paramId(c);
  const deleted = c.get('db').delete(submissions).where(eq(submissions.id, id)).returning({ id: submissions.id }).get();
  if (!deleted) throw notFound('Submission not found');
  return c.body(null, 204);
});

export default router;
