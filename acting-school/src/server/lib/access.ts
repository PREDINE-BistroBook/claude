/**
 * Who may see and do what: positions → effective permissions, the "classes you
 * teach" scope, and contact redaction. Routes use these helpers; the rules
 * themselves are described in src/shared/permissions.ts.
 */
import { and, asc, count, countDistinct, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { BUILT_IN_POSITIONS, effectivePermissions, holdsAll, type Permission } from '../../shared/permissions';
import type { PositionSummary, SessionUser } from '../../shared/schemas/auth';
import type { DB } from '../db/client';
import { classSessions, courses, enrollments, positions, students, userPositions, users } from '../db/schema';

/** The database or an open transaction — both have the same query builder. */
export type Conn = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;

/** Who is asking, as far as access rules care. */
export type Actor = Pick<SessionUser, 'id' | 'isOwner' | 'permissions'>;

// ── Positions ───────────────────────────────────────────────────────────────

/**
 * Create the built-in positions that don't exist yet (matched by key). Safe to
 * run on every start: existing positions — renamed or changed by an owner — are
 * left alone.
 */
export function ensureBuiltInPositions(db: Conn) {
  const existing = new Set(
    db
      .select({ key: positions.key })
      .from(positions)
      .all()
      .map((r) => r.key),
  );
  const missing = BUILT_IN_POSITIONS.map((p, i) => ({ ...p, sortOrder: i * 10 })).filter((p) => !existing.has(p.key));
  if (!missing.length) return;
  db.insert(positions)
    .values(missing.map((p) => ({ key: p.key, name: p.name, nameAr: p.nameAr, isOwner: p.isOwner, permissions: [...p.permissions], sortOrder: p.sortOrder })))
    .onConflictDoNothing()
    .run();
}

/** List order of positions everywhere: sortOrder, then name, then id. */
export const positionOrder = [asc(positions.sortOrder), sql`${positions.name} collate nocase`, asc(positions.id)];

export type PositionRow = Pick<typeof positions.$inferSelect, 'id' | 'key' | 'name' | 'nameAr' | 'isOwner' | 'permissions'>;

export function toPositionSummary(p: PositionRow): PositionSummary {
  return { id: p.id, key: p.key, name: p.name, nameAr: p.nameAr, isOwner: p.isOwner };
}

export interface UserAccess {
  positions: PositionSummary[];
  isOwner: boolean;
  permissions: Permission[];
}

/** Turn a person's position rows into what they may do. */
export function accessFrom(rows: readonly PositionRow[]): UserAccess {
  return {
    positions: rows.map(toPositionSummary),
    isOwner: rows.some((p) => p.isOwner),
    permissions: effectivePermissions(rows),
  };
}

const positionColumns = {
  id: positions.id,
  key: positions.key,
  name: positions.name,
  nameAr: positions.nameAr,
  isOwner: positions.isOwner,
  permissions: positions.permissions,
};

/** The positions (with what they allow) of several people, in one query. People without positions get []. */
export function loadPositionRows(db: Pick<DB, 'select'>, userIds: readonly number[]): Map<number, PositionRow[]> {
  const byUser = new Map<number, PositionRow[]>(userIds.map((id) => [id, []]));
  if (userIds.length) {
    const rows = db
      .select({ userId: userPositions.userId, ...positionColumns })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .where(inArray(userPositions.userId, [...userIds]))
      .orderBy(...positionOrder)
      .all();
    for (const { userId, ...p } of rows) byUser.get(userId)?.push(p);
  }
  return byUser;
}

/** Positions and effective permissions of several people, in one query. */
export function loadAccess(db: Pick<DB, 'select'>, userIds: readonly number[]): Map<number, UserAccess> {
  return new Map([...loadPositionRows(db, userIds)].map(([id, rows]) => [id, accessFrom(rows)]));
}

export function loadUserAccess(db: Pick<DB, 'select'>, userId: number): UserAccess {
  return loadAccess(db, [userId]).get(userId)!;
}

/** The SessionUser shape for a user row (one extra query for the positions). */
export function toSessionUser(db: Pick<DB, 'select'>, u: typeof users.$inferSelect): SessionUser {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, locale: u.locale, ...loadUserAccess(db, u.id) };
}

/** Owners may do anything; everyone else may only touch what they could do themselves. */
export function withinAccess(actor: Actor, needed: readonly Permission[]): boolean {
  return actor.isOwner || holdsAll(actor.permissions, needed);
}

/**
 * Active accounts holding an owner position. `exceptUserId` / `exceptPositionId`
 * leave one person or one position out, to ask "would anyone be left?".
 */
export function activeOwnerCount(db: Pick<DB, 'select'>, opts: { exceptUserId?: number; exceptPositionId?: number } = {}): number {
  return (
    db
      .select({ n: countDistinct(users.id) })
      .from(users)
      .innerJoin(userPositions, eq(userPositions.userId, users.id))
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .where(
        and(
          eq(users.active, true),
          eq(positions.isOwner, true),
          opts.exceptUserId !== undefined ? ne(users.id, opts.exceptUserId) : undefined,
          opts.exceptPositionId !== undefined ? ne(positions.id, opts.exceptPositionId) : undefined,
        ),
      )
      .get()?.n ?? 0
  );
}

/**
 * SQL condition: the users row holds no owner position (hides owner accounts
 * from non-owners). Written with an explicit "users"."id": drizzle leaves
 * columns unqualified in a single-table select, and a bare "id" inside this
 * subquery would mean positions.id.
 */
export const notAnOwner = sql`not exists (
  select 1 from ${userPositions} nup join ${positions} np on np.id = nup.position_id
  where nup.user_id = "users"."id" and np.is_owner = 1
)`;

/** How many people hold a position (optionally only people who aren't owners). */
export function holderCounts(db: Pick<DB, 'select'>, opts: { excludeOwners: boolean }): Map<number, number> {
  const rows = db
    .select({ positionId: userPositions.positionId, n: count() })
    .from(userPositions)
    .innerJoin(users, eq(users.id, userPositions.userId))
    .where(opts.excludeOwners ? notAnOwner : undefined)
    .groupBy(userPositions.positionId)
    .all();
  return new Map(rows.map((r) => [r.positionId, r.n]));
}

// ── Permissions ─────────────────────────────────────────────────────────────

export function hasPermission(user: Pick<SessionUser, 'permissions'> | null | undefined, permission: Permission): boolean {
  return !!user?.permissions.includes(permission);
}

/** Holds classes.all: sees every class, session and student, not only their own. */
export function seesAllClasses(user: Pick<SessionUser, 'permissions'>): boolean {
  return hasPermission(user, 'classes.all');
}

// ── "Classes you teach" scope ───────────────────────────────────────────────

/**
 * Ids of the courses a person teaches: they're the course's teacher, or the
 * substitute on any of its sessions. (Subquery for `x in (…)`.)
 */
export function ownCourseIds(userId: number): SQL {
  return sql`select oc.id from ${courses} oc where oc.teacher_id = ${userId}
    union select os.course_id from ${classSessions} os where os.teacher_id = ${userId}`;
}

/** Ids of the students with any enrollment in a course the person teaches. */
export function ownStudentIds(userId: number): SQL {
  return sql`select oe.student_id from ${enrollments} oe where oe.course_id in (${ownCourseIds(userId)})`;
}

/** WHERE for the courses this person may see (undefined: all of them). */
export function courseScope(user: Pick<SessionUser, 'id' | 'permissions'>): SQL | undefined {
  return seesAllClasses(user) ? undefined : sql`${courses.id} in (${ownCourseIds(user.id)})`;
}

/** WHERE for the students this person may see (undefined: all of them). */
export function studentScope(user: Pick<SessionUser, 'id' | 'permissions'>): SQL | undefined {
  return seesAllClasses(user) ? undefined : sql`${students.id} in (${ownStudentIds(user.id)})`;
}

export function canSeeCourse(db: Pick<DB, 'select'>, user: Pick<SessionUser, 'id' | 'permissions'>, courseId: number): boolean {
  if (seesAllClasses(user)) return true;
  return !!db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), courseScope(user)))
    .get();
}

export function canSeeStudent(db: Pick<DB, 'select'>, user: Pick<SessionUser, 'id' | 'permissions'>, studentId: number): boolean {
  if (seesAllClasses(user)) return true;
  return !!db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), studentScope(user)))
    .get();
}

/**
 * Attendance rule: needs attendance.write; without classes.all only for
 * sessions the person teaches (the session's substitute, else the course's teacher).
 */
export function mayMarkAttendance(user: Pick<SessionUser, 'id' | 'permissions'>, effectiveTeacherId: number | null): boolean {
  if (!hasPermission(user, 'attendance.write')) return false;
  if (!seesAllClasses(user)) return effectiveTeacherId === user.id;
  return true;
}

// ── Contact details ─────────────────────────────────────────────────────────

/** Null these keys (when present) unless `visible`; adds contactHidden. */
export function redactContact<T extends object, K extends string>(
  row: T,
  fields: readonly K[],
  visible: boolean,
): T & { contactHidden: boolean } {
  if (visible) return { ...row, contactHidden: false };
  const out: Record<string, unknown> = { ...row, contactHidden: true };
  for (const f of fields) if (f in out) out[f] = null;
  return out as T & { contactHidden: boolean };
}

/** Drop contact keys from a write: without the contact permission they are neither set nor cleared. */
export function withoutContact<T extends object, K extends string>(input: T, fields: readonly K[], allowed: boolean): T {
  if (allowed) return input;
  const out = { ...input } as Record<string, unknown>;
  for (const f of fields) delete out[f];
  return out as unknown as T;
}
