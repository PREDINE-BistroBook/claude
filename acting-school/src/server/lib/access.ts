/**
 * Who may see and do what: positions → effective permissions, the "classes you
 * teach" scope, and contact redaction. Routes use these helpers; the rules
 * themselves are described in src/shared/permissions.ts.
 */
import { and, asc, count, countDistinct, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  BUILT_IN_GRANTS,
  BUILT_IN_GRANTS_SETTING,
  BUILT_IN_POSITIONS,
  PERMISSIONS,
  effectivePermissions,
  holdsAll,
  normalizePermissions,
  type Permission,
} from '../../shared/permissions';
import type { PositionSummary, SessionUser } from '../../shared/schemas/auth';
import type { DB } from '../db/database';
import { classSessions, courses, enrollments, positions, settings, students, userPositions, users } from '../db/schema';
import { inChunks, insertBatches } from './sqlLimits';

/** The database or an open transaction — both have the same query builder. */
export type Conn = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;

/** Who is asking, as far as access rules care. */
export type Actor = Pick<SessionUser, 'id' | 'isOwner' | 'permissions'>;

// ── Positions ───────────────────────────────────────────────────────────────

/**
 * Create the built-in positions that don't exist yet (matched by key). Safe to
 * run on every start: existing positions — renamed or changed by an owner — are
 * left alone. Returns the keys it created (they already have today's full
 * permission lists).
 */
export function ensureBuiltInPositions(db: Conn): string[] {
  const existing = new Set(
    db
      .select({ key: positions.key })
      .from(positions)
      .all()
      .map((r) => r.key),
  );
  const missing = BUILT_IN_POSITIONS.map((p, i) => ({ ...p, sortOrder: i * 10 })).filter((p) => !existing.has(p.key));
  if (!missing.length) return [];
  const rows = missing.map((p) => ({ key: p.key, name: p.name, nameAr: p.nameAr, isOwner: p.isOwner, permissions: [...p.permissions], sortOrder: p.sortOrder }));
  for (const batch of insertBatches(positions, rows)) db.insert(positions).values(batch).onConflictDoNothing().run();
  return missing.map((p) => p.key);
}

/** The BUILT_IN_GRANTS version this database has applied (0 = none yet). */
export function builtInGrantsVersion(db: Pick<DB, 'select'>): number {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, BUILT_IN_GRANTS_SETTING)).get();
  return typeof row?.value === 'number' ? row.value : 0;
}

/**
 * Startup, in one transaction: create missing built-in positions, then apply
 * every BUILT_IN_GRANTS entry newer than the version stored in settings — each
 * permission is added to that built-in position only if missing — and store
 * the latest version. Positions created just now already have their full
 * current lists, so grants skip them (a fresh database only records the
 * version). A grant runs once: a permission an owner removes afterwards stays
 * removed. `grants` is a parameter for tests.
 */
export function upgradeBuiltInPositions(db: DB, grants: typeof BUILT_IN_GRANTS = BUILT_IN_GRANTS) {
  db.transaction((tx) => {
    const created = new Set(ensureBuiltInPositions(tx));
    const stored = builtInGrantsVersion(tx);
    const pending = grants.filter((g) => g.version > stored).sort((a, b) => a.version - b.version);
    if (!pending.length) return;
    for (const { grants: byKey } of pending) {
      for (const [key, add] of Object.entries(byKey)) {
        if (!add?.length || created.has(key)) continue;
        const row = tx.select({ id: positions.id, permissions: positions.permissions }).from(positions).where(eq(positions.key, key)).get();
        if (!row) continue;
        const missing = add.filter((p) => !row.permissions.includes(p));
        if (missing.length) tx.update(positions).set({ permissions: [...row.permissions, ...missing] }).where(eq(positions.id, row.id)).run();
      }
    }
    const latest = Math.max(stored, ...pending.map((g) => g.version));
    tx.insert(settings)
      .values({ key: BUILT_IN_GRANTS_SETTING, value: latest })
      .onConflictDoUpdate({ target: settings.key, set: { value: latest } })
      .run();
  });
}

/** List order of positions everywhere: sortOrder, then name, then id. */
export const positionOrder = [asc(positions.sortOrder), sql`${positions.name} collate nocase`, asc(positions.id)];

export type PositionRow = Pick<typeof positions.$inferSelect, 'id' | 'key' | 'name' | 'nameAr' | 'isOwner' | 'permissions'>;

/**
 * What a position actually allows: owner positions allow everything; anything
 * else only the catalogue permissions in its stored list (a stored string that
 * is no longer in the catalogue allows nothing).
 */
export function positionAllows(p: Pick<PositionRow, 'isOwner' | 'permissions'>): Permission[] {
  return p.isOwner ? [...PERMISSIONS] : normalizePermissions(p.permissions);
}

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
  // In slices: the staff list can name more people than one IN (…) may hold (lib/sqlLimits.ts).
  const rows = inChunks(userIds, (ids) =>
    db
      .select({ userId: userPositions.userId, ...positionColumns })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .where(inArray(userPositions.userId, ids))
      .orderBy(...positionOrder)
      .all(),
  );
  for (const { userId, ...p } of rows) byUser.get(userId)?.push(p);
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
  return {
    id: u.id,
    username: u.username ?? '',
    email: u.email,
    name: u.name,
    phone: u.phone,
    locale: u.locale,
    photoFileId: u.photoFileId,
    ...loadUserAccess(db, u.id),
    mustChangePassword: u.mustChangePassword,
  };
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

/**
 * An existing, active staff account the actor may see: owner accounts don't
 * exist for non-owners, so naming one gets the same answer as a missing id
 * (otherwise ids would reveal hidden owners). Used to validate teachers,
 * substitutes, lead assignees and interviewers.
 */
export function isVisibleActiveStaff(db: Pick<DB, 'select'>, actor: Actor, userId: number): boolean {
  const row = db
    .select({ active: users.active })
    .from(users)
    .where(and(eq(users.id, userId), actor.isOwner ? undefined : notAnOwner))
    .get();
  return !!row?.active;
}

/**
 * How many people hold each position — everyone, owners included, whoever
 * asks: deleting a position needs nobody to hold it, so the count a
 * non-owner sees must agree with that rule. (A bare number; who the holders
 * are stays hidden.)
 */
export function holderCounts(db: Pick<DB, 'select'>, positionId?: number): Map<number, number> {
  const rows = db
    .select({ positionId: userPositions.positionId, n: count() })
    .from(userPositions)
    .where(positionId === undefined ? undefined : eq(userPositions.positionId, positionId))
    .groupBy(userPositions.positionId)
    .all();
  return new Map(rows.map((r) => [r.positionId, r.n]));
}

/**
 * Positions the actor may not change because of who holds them: someone who
 * isn't an owner and can do more than the actor (staff rule: someone who can
 * do more than you is out of your reach — editing a position they hold would
 * change their access just like editing their account). Owner holders don't
 * count: a non-owner position changes nothing for them. Empty for owners.
 * Pass `positionId` to look at one position only.
 */
export function positionsHeldBeyondReach(db: Pick<DB, 'select'>, actor: Actor, positionId?: number): Set<number> {
  const out = new Set<number>();
  if (actor.isOwner) return out;
  const held = db
    .select({ userId: userPositions.userId, positionId: userPositions.positionId })
    .from(userPositions)
    .where(positionId === undefined ? undefined : eq(userPositions.positionId, positionId))
    .all();
  const access = loadAccess(db, [...new Set(held.map((r) => r.userId))]);
  for (const r of held) {
    const a = access.get(r.userId)!;
    if (!a.isOwner && !withinAccess(actor, a.permissions)) out.add(r.positionId);
  }
  return out;
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
 * Ids of a person's own courses: they're the course's teacher, the substitute
 * on any of its sessions, or they created it (so a class set up for another
 * coach doesn't vanish from its creator). (Subquery for `x in (…)`.)
 */
export function ownCourseIds(userId: number): SQL {
  return sql`select oc.id from ${courses} oc where oc.teacher_id = ${userId} or oc.created_by = ${userId}
    union select os.course_id from ${classSessions} os where os.teacher_id = ${userId}`;
}

/**
 * Ids of a person's own students: any enrollment in one of their own courses,
 * or they added the student (so a student they just added can be seen and
 * enrolled).
 */
export function ownStudentIds(userId: number): SQL {
  return sql`select oe.student_id from ${enrollments} oe where oe.course_id in (${ownCourseIds(userId)})
    union select ost.id from ${students} ost where ost.created_by = ${userId}`;
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
 * The student exists and this person may open them: students.read, and the
 * student is in their scope. Anything that shows or links a student from
 * another module (e.g. a talent profile) goes through this.
 */
export function maySeeStudent(db: Pick<DB, 'select'>, user: Pick<SessionUser, 'id' | 'permissions'>, studentId: number): boolean {
  if (!hasPermission(user, 'students.read')) return false;
  return !!db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), studentScope(user)))
    .get();
}

/** Takes attendance at all: attendance.write, plus courses.read (marking needs the session and its roster). */
export function takesAttendance(user: Pick<SessionUser, 'permissions'>): boolean {
  return hasPermission(user, 'attendance.write') && hasPermission(user, 'courses.read');
}

/**
 * Attendance rule: needs attendance.write (and courses.read); without
 * classes.all only for sessions the person teaches (the session's substitute,
 * else the course's teacher).
 */
export function mayMarkAttendance(user: Pick<SessionUser, 'id' | 'permissions'>, effectiveTeacherId: number | null): boolean {
  if (!takesAttendance(user)) return false;
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
