import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Permission } from '../../shared/permissions';
import { holdsAll } from '../../shared/permissions';
import type { ListResponse } from '../../shared/schemas/common';
import { STAFF_ERROR_CODES, staffCreateInput, staffUpdateInput, type StaffDirectoryEntry, type StaffMember } from '../../shared/schemas/staff';
import type { DB } from '../db/client';
import { authSessions, positions, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import {
  accessFrom,
  activeOwnerCount,
  loadAccess,
  loadPositionRows,
  notAnOwner,
  withinAccess,
  type Actor,
  type UserAccess,
} from '../lib/access';
import { ApiError, notFound } from '../lib/errors';
import { hashPassword } from '../lib/password';
import { getSettings } from '../lib/settings';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Staff accounts and the positions they hold. staff.manage lets someone add
 * and edit accounts, with these limits for anyone who isn't an owner:
 * - accounts holding an owner position (CEO, CFO) are invisible to them (404);
 * - they can only give or take positions whose every permission they hold
 *   themselves, never an owner position;
 * - they can only edit, deactivate or reset the password of someone who can't
 *   do anything they can't (otherwise a password reset would be a takeover).
 * Nobody changes their own positions or deactivates themselves, and at least
 * one active account always holds an owner position. There is no DELETE:
 * classes, uploads and history point at users, so people are deactivated
 * instead (which also signs them out everywhere).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canManage = requirePermission('staff.manage');

type UserRow = typeof users.$inferSelect;
/** The db or a transaction — both have the same query builder. */
type Tx = Pick<DB, 'select'>;

function toStaffMember(u: UserRow, access: UserAccess, actor: Actor): StaffMember {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    locale: u.locale,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    positions: access.positions,
    isOwner: access.isOwner,
    manageable: withinAccess(actor, access.permissions),
  };
}

function staffMember(db: Tx, u: UserRow, actor: Actor): StaffMember {
  return toStaffMember(u, loadAccess(db, [u.id]).get(u.id)!, actor);
}

const byName = sql`${users.name} collate nocase`;

function emailTakenError(): ApiError {
  return new ApiError(409, 'email_taken', 'Another staff account already uses this email', [
    { path: ['email'], code: 'custom', message: 'staff:errors.emailTaken' },
  ]);
}

const lastOwnerError = () =>
  new ApiError(409, STAFF_ERROR_CODES.lastOwner, 'Nobody else holds an owner position. Give someone else an owner position first.');
const exceedsError = () =>
  new ApiError(403, STAFF_ERROR_CODES.exceedsYourAccess, 'That would give or touch access you don’t have yourself');
const ownerOnlyError = () => new ApiError(403, STAFF_ERROR_CODES.ownerOnly, 'Only an owner can give or take an owner position');

function emailInUse(db: Tx, email: string, exceptId?: number): boolean {
  const where = exceptId === undefined ? eq(users.email, email) : and(eq(users.email, email), ne(users.id, exceptId));
  return !!db.select({ id: users.id }).from(users).where(where).get();
}

type PositionRow = typeof positions.$inferSelect;

/** The positions named by `ids` (deduplicated); a field error on positionIds if any doesn't exist. */
function findPositions(db: Tx, ids: number[]): PositionRow[] {
  const unique = [...new Set(ids)];
  const rows = db.select().from(positions).where(inArray(positions.id, unique)).all();
  if (rows.length !== unique.length) {
    throw new ApiError(400, 'validation', 'Some fields are missing or invalid', [
      { path: ['positionIds'], code: 'custom', message: 'staff:errors.positionNotFound' },
    ]);
  }
  return rows;
}

/**
 * Giving or taking these positions: owner positions need an owner; anything
 * else needs the actor to hold every permission the position allows.
 */
function assertMayAssign(actor: Actor, changed: readonly { isOwner: boolean; permissions: readonly string[] }[]) {
  if (actor.isOwner) return;
  if (changed.some((p) => p.isOwner)) throw ownerOnlyError();
  if (!changed.every((p) => holdsAll(actor.permissions, p.permissions as Permission[]))) throw exceedsError();
}

/** Everyone signed in: names and positions for teacher pickers. Registered before /:id. */
router.get('/directory', (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const rows = db
    .select({ id: users.id, name: users.name, active: users.active })
    .from(users)
    .where(me.isOwner ? undefined : notAnOwner)
    .orderBy(asc(byName), asc(users.id))
    .all();
  const held = loadPositionRows(
    db,
    rows.map((r) => r.id),
  );
  const items: StaffDirectoryEntry[] = rows.map((r) => {
    const mine = held.get(r.id) ?? [];
    return {
      ...r,
      positions: accessFrom(mine).positions,
      // A coaching position: takes attendance for its own classes, without seeing every class.
      coach: mine.some((p) => !p.isOwner && p.permissions.includes('attendance.write') && !p.permissions.includes('classes.all')),
    };
  });
  return c.json<ListResponse<StaffDirectoryEntry>>({ items });
});

/** Full list for the staff screen: active people first, then by name. */
router.get('/', canManage, (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const rows = db
    .select()
    .from(users)
    .where(me.isOwner ? undefined : notAnOwner)
    .orderBy(desc(users.active), asc(byName), asc(users.id))
    .all();
  const access = loadAccess(
    db,
    rows.map((r) => r.id),
  );
  return c.json<ListResponse<StaffMember>>({ items: rows.map((r) => toStaffMember(r, access.get(r.id)!, me)) });
});

/** One account. Owner accounts are a 404 for non-owners. */
router.get('/:id', canManage, (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const row = db.select().from(users).where(eq(users.id, paramId(c))).get();
  if (!row) throw notFound('Staff member not found');
  const member = staffMember(db, row, me);
  if (member.isOwner && !me.isOwner) throw notFound('Staff member not found');
  return c.json(member);
});

router.post('/', canManage, async (c) => {
  const input = await body(c, staffCreateInput);
  const me = currentUser(c);
  const db = c.get('db');
  const chosen = findPositions(db, input.positionIds);
  assertMayAssign(me, chosen);
  // Cheap check first so a duplicate doesn't pay for a slow hash; re-checked in the transaction.
  if (emailInUse(db, input.email)) throw emailTakenError();
  const passwordHash = await hashPassword(input.password);
  const locale = input.locale ?? getSettings(db).defaultLocale;

  const created = db.transaction((tx) => {
    if (emailInUse(tx, input.email)) return null;
    const user = tx
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash, phone: input.phone ?? null, locale, active: true })
      .returning()
      .get();
    tx.insert(userPositions)
      .values(chosen.map((p) => ({ userId: user.id, positionId: p.id })))
      .run();
    return user;
  });
  if (!created) throw emailTakenError();
  return c.json(staffMember(db, created, me), 201);
});

router.patch('/:id', canManage, async (c) => {
  const id = paramId(c);
  const input = await body(c, staffUpdateInput);
  const me = currentUser(c);
  const db = c.get('db');

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) throw notFound('Staff member not found');
  const current = loadPositionRows(db, [id]).get(id)!;
  const currentAccess = accessFrom(current);
  // Owner accounts don't exist as far as non-owners can tell.
  if (!me.isOwner && currentAccess.isOwner) throw notFound('Staff member not found');
  // Someone who can do more than you is out of your reach (a password reset would be a takeover).
  if (!withinAccess(me, currentAccess.permissions)) throw exceedsError();

  const isSelf = target.id === me.id;
  let nextPositions: PositionRow[] | null = null;
  if (input.positionIds !== undefined) {
    const chosen = findPositions(db, input.positionIds);
    const currentIds = new Set(current.map((p) => p.id));
    const chosenIds = new Set(chosen.map((p) => p.id));
    const added = chosen.filter((p) => !currentIds.has(p.id));
    const removed = current.filter((p) => !chosenIds.has(p.id));
    if (added.length || removed.length) {
      assertMayAssign(me, [...added, ...removed]);
      nextPositions = chosen;
    }
  }
  const positionsChange = nextPositions !== null;
  const deactivating = input.active === false && target.active;
  // Taking the last owner position away (or deactivating its last holder) would lock everyone out of owner-only actions.
  const losesOwner = target.active && currentAccess.isOwner && ((positionsChange && !nextPositions!.some((p) => p.isOwner)) || deactivating);
  if (losesOwner && activeOwnerCount(db, { exceptUserId: id }) === 0) throw lastOwnerError();
  if (isSelf && (positionsChange || deactivating)) {
    throw new ApiError(409, STAFF_ERROR_CODES.cannotChangeSelf, 'You can’t change your own positions or deactivate yourself');
  }
  if (input.email !== undefined && input.email !== target.email && emailInUse(db, input.email, id)) throw emailTakenError();

  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.active !== undefined) patch.active = input.active;
  if (passwordHash) patch.passwordHash = passwordHash;

  const signOutEverywhere = deactivating || passwordHash !== undefined;
  const currentSession = c.get('sessionId');

  const result = db.transaction((tx) => {
    // Re-check the rules that depend on other rows, now that nothing can change under us.
    if (losesOwner && activeOwnerCount(tx, { exceptUserId: id }) === 0) return 'last_owner' as const;
    if (patch.email !== undefined && patch.email !== target.email && emailInUse(tx, patch.email, id)) return 'email_taken' as const;
    const row = Object.keys(patch).length ? tx.update(users).set(patch).where(eq(users.id, id)).returning().get()! : target;
    if (nextPositions) {
      tx.delete(userPositions).where(eq(userPositions.userId, id)).run();
      tx.insert(userPositions)
        .values(nextPositions.map((p) => ({ userId: id, positionId: p.id })))
        .run();
      if (!Object.keys(patch).length) tx.update(users).set({ updatedAt: Date.now() }).where(eq(users.id, id)).run();
    }
    if (signOutEverywhere) {
      // Resetting your own password here keeps this device signed in (same as POST /auth/password).
      const keep = isSelf && currentSession ? ne(authSessions.id, currentSession) : undefined;
      tx.delete(authSessions)
        .where(keep ? and(eq(authSessions.userId, id), keep) : eq(authSessions.userId, id))
        .run();
    }
    return row;
  });
  if (result === 'last_owner') throw lastOwnerError();
  if (result === 'email_taken') throw emailTakenError();
  return c.json(staffMember(db, result, me));
});

export default router;
