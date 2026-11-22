import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  castingInput,
  castingListQuery,
  castingRoleInput,
  castingRoleUpdateInput,
  castingUpdateInput,
  type CastingDetail,
  type CastingListItem,
  type CastingRole,
} from '../../shared/schemas/castings';
import type { ListResponse } from '../../shared/schemas/common';
import type { DB } from '../db/client';
import { castingRoles, castings, submissions } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError, notFound } from '../lib/errors';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';
import { submissionsForRoles } from './submissions';

/**
 * Castings: a production's breakdown (the casting) with its roles. Talent is
 * put forward for a role through /api/submissions. Owners, admins and agents
 * can read and change everything here; teachers can't see it at all.
 * Deleting a casting removes its roles and their submissions (FK cascade).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('castings.read');
const canWrite = requirePermission('castings.write');

type CastingRow = typeof castings.$inferSelect;
type RoleRow = typeof castingRoles.$inferSelect;

function findCasting(db: DB, id: number): CastingRow {
  const row = db.select().from(castings).where(eq(castings.id, id)).get();
  if (!row) throw notFound('Casting not found');
  return row;
}

/** A role that belongs to this casting; a role id from another casting is a 404 too. */
function findRole(db: DB, castingId: number, roleId: number): RoleRow {
  const row = db
    .select()
    .from(castingRoles)
    .where(and(eq(castingRoles.id, roleId), eq(castingRoles.castingId, castingId)))
    .get();
  if (!row) throw notFound('Role not found');
  return row;
}

function toRole(r: RoleRow, submissions: CastingRole['submissions']): CastingRole {
  return {
    id: r.id,
    castingId: r.castingId,
    name: r.name,
    description: r.description,
    gender: r.gender,
    ageMin: r.ageMin,
    ageMax: r.ageMax,
    requirements: r.requirements,
    submissions,
  };
}

/** The full casting: details, roles by id, each role's submissions in pipeline order. */
function loadDetail(db: DB, row: CastingRow): CastingDetail {
  const roleRows = db.select().from(castingRoles).where(eq(castingRoles.castingId, row.id)).orderBy(asc(castingRoles.id)).all();
  const byRole = submissionsForRoles(db, roleRows.map((r) => r.id));
  return {
    id: row.id,
    title: row.title,
    production: row.production,
    type: row.type,
    status: row.status,
    location: row.location,
    submissionDeadline: row.submissionDeadline,
    shootStart: row.shootStart,
    shootEnd: row.shootEnd,
    castingDirector: row.castingDirector,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    description: row.description,
    rate: row.rate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    roles: roleRows.map((r) => toRole(r, byRole.get(r.id) ?? [])),
  };
}

/** Drop keys the client didn't send (undefined) so a PATCH only touches what it names. */
function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function orderIssue(field: string, message: string): ApiError {
  return new ApiError(400, 'validation', 'Some fields are missing or invalid', [{ path: [field], code: 'custom', message }]);
}

/** Escape LIKE wildcards so a search for "50%" or "a_b" is taken literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function searchCondition(q: string): SQL {
  const pattern = `%${escapeLike(q.replace(/\s+/g, ' '))}%`;
  const like = (col: SQL) => sql`${col} like ${pattern} escape '\\'`;
  return or(like(sql`${castings.title}`), like(sql`${castings.production}`), like(sql`${castings.castingDirector}`))!;
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', canRead, (c) => {
  const { q, status } = query(c, castingListQuery);
  const db = c.get('db');

  // Every casting's counts in one grouped subquery (a role may have no submissions: left join).
  const counts = db
    .select({
      castingId: castingRoles.castingId,
      roles: sql<number>`count(distinct ${castingRoles.id})`.as('roles_count'),
      subs: sql<number>`count(${submissions.id})`.as('submissions_count'),
      booked: sql<number>`sum(case when ${submissions.status} = 'booked' then 1 else 0 end)`.as('booked_count'),
    })
    .from(castingRoles)
    .leftJoin(submissions, eq(submissions.roleId, castingRoles.id))
    .groupBy(castingRoles.castingId)
    .as('casting_counts');

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(castings.status, status));
  if (q) conditions.push(searchCondition(q));

  const items: CastingListItem[] = db
    .select({
      id: castings.id,
      title: castings.title,
      production: castings.production,
      type: castings.type,
      status: castings.status,
      location: castings.location,
      submissionDeadline: castings.submissionDeadline,
      shootStart: castings.shootStart,
      shootEnd: castings.shootEnd,
      rolesCount: sql<number>`coalesce(${counts.roles}, 0)`.mapWith(Number),
      submissionsCount: sql<number>`coalesce(${counts.subs}, 0)`.mapWith(Number),
      bookedCount: sql<number>`coalesce(${counts.booked}, 0)`.mapWith(Number),
    })
    .from(castings)
    .leftJoin(counts, eq(counts.castingId, castings.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      // Open first, then the nearest deadline (none last), then newest.
      sql`case when ${castings.status} = 'open' then 0 else 1 end`,
      sql`${castings.submissionDeadline} is null`,
      asc(castings.submissionDeadline),
      desc(castings.createdAt),
      desc(castings.id),
    )
    .all();
  const res: ListResponse<CastingListItem> = { items };
  return c.json(res);
});

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', canWrite, async (c) => {
  const input = await body(c, castingInput);
  const db = c.get('db');
  const created = db
    .insert(castings)
    .values({ ...input, status: input.status ?? 'open', createdBy: currentUser(c).id })
    .returning()
    .get();
  return c.json(loadDetail(db, created), 201);
});

// ── Detail ──────────────────────────────────────────────────────────────────

router.get('/:id', canRead, (c) => {
  const db = c.get('db');
  return c.json(loadDetail(db, findCasting(db, paramId(c))));
});

// ── Update ──────────────────────────────────────────────────────────────────

router.patch('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const input = definedOnly(await body(c, castingUpdateInput));
  const db = c.get('db');
  const current = findCasting(db, id);

  // Shoot dates are checked against what the casting will look like after the change.
  const shootStart = 'shootStart' in input ? input.shootStart : current.shootStart;
  const shootEnd = 'shootEnd' in input ? input.shootEnd : current.shootEnd;
  if (shootStart && shootEnd && shootEnd < shootStart) throw orderIssue('shootEnd', 'errors.endBeforeStart');

  const updated = Object.keys(input).length ? db.update(castings).set(input).where(eq(castings.id, id)).returning().get()! : current;
  return c.json(loadDetail(db, updated));
});

// ── Delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', canWrite, (c) => {
  const id = paramId(c);
  // Roles and their submissions go with it (ON DELETE CASCADE).
  const result = c.get('db').delete(castings).where(eq(castings.id, id)).run();
  if (result.changes === 0) throw notFound('Casting not found');
  return c.body(null, 204);
});

// ── Roles ───────────────────────────────────────────────────────────────────

router.post('/:id/roles', canWrite, async (c) => {
  const id = paramId(c);
  const input = await body(c, castingRoleInput);
  const db = c.get('db');
  findCasting(db, id);
  const created = db
    .insert(castingRoles)
    .values({ ...input, castingId: id })
    .returning()
    .get();
  return c.json(toRole(created, []), 201);
});

router.patch('/:id/roles/:roleId', canWrite, async (c) => {
  const id = paramId(c);
  const roleId = paramId(c, 'roleId');
  const input = definedOnly(await body(c, castingRoleUpdateInput));
  const db = c.get('db');
  const current = findRole(db, id, roleId);

  const ageMin = 'ageMin' in input ? input.ageMin : current.ageMin;
  const ageMax = 'ageMax' in input ? input.ageMax : current.ageMax;
  if (ageMin != null && ageMax != null && ageMax < ageMin) throw orderIssue('ageMax', 'errors.rangeOrder');

  const updated = Object.keys(input).length ? db.update(castingRoles).set(input).where(eq(castingRoles.id, roleId)).returning().get()! : current;
  return c.json(toRole(updated, submissionsForRoles(db, [roleId]).get(roleId) ?? []));
});

router.delete('/:id/roles/:roleId', canWrite, (c) => {
  const id = paramId(c);
  const roleId = paramId(c, 'roleId');
  const db = c.get('db');
  findRole(db, id, roleId);
  // Its submissions go with it (ON DELETE CASCADE).
  db.delete(castingRoles).where(eq(castingRoles.id, roleId)).run();
  return c.body(null, 204);
});

export default router;
