import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ListResponse } from '../../shared/schemas/common';
import { FRESH_UPLOAD_MS } from '../../shared/schemas/chat';
import {
  STAFF_ERROR_CODES,
  staffCreateInput,
  staffUpdateInput,
  usernameCheckQuery,
  type StaffDirectoryEntry,
  type StaffMember,
  type UsernameCheck,
} from '../../shared/schemas/staff';
import { photoInput, TEAM_ERROR_KEYS } from '../../shared/schemas/team';
import type { DB } from '../db/database';
import { positions, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import {
  accessFrom,
  activeOwnerCount,
  loadAccess,
  loadPositionRows,
  notAnOwner,
  positionAllows,
  withinAccess,
  type Actor,
  type UserAccess,
} from '../lib/access';
import { inChunks, insertBatches } from '../lib/sqlLimits';
import { ApiError, notFound } from '../lib/errors';
import { claimUploads, releaseFile } from '../lib/fileRefs';
import { hashPassword } from '../lib/password';
import { getSettings } from '../lib/settings';
import { checkUsername, emailInUse, emailTakenError, newAccountNames, usernameChange, usernameOf } from '../lib/usernames';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission, signOutUser } from '../middleware/auth';

/**
 * Staff accounts and the positions they hold. staff.manage lets someone add
 * and edit accounts, with these limits for anyone who isn't an owner:
 * - accounts holding an owner position (CEO, CFO) are invisible to them (404);
 * - they can only give or take positions whose every permission they hold
 *   themselves, never an owner position (to them an owner position id is as
 *   unknown as a missing one);
 * - they can only edit, deactivate or reset the password of someone who can't
 *   do anything they can't (otherwise a password reset would be a takeover).
 * Nobody changes their own positions or deactivates themselves, and at least
 * one active account always holds an owner position.
 *
 * A password a manager sets — the first one when adding someone, or a reset —
 * is temporary: the account is marked must_change_password and the person has
 * to choose their own at the next sign-in before anything else opens.
 *
 * Usernames are unique across the whole team, owners included. A clash answers
 * "taken" and nothing more: never whose it is (a non-owner must not learn an
 * owner's account that way). There is no DELETE:
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
    username: usernameOf(u),
    email: u.email,
    phone: u.phone,
    locale: u.locale,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    mustChangePassword: u.mustChangePassword,
    photoFileId: u.photoFileId,
    positions: access.positions,
    isOwner: access.isOwner,
    manageable: withinAccess(actor, access.permissions),
  };
}

function staffMember(db: Tx, u: UserRow, actor: Actor): StaffMember {
  return toStaffMember(u, loadAccess(db, [u.id]).get(u.id)!, actor);
}

const byName = sql`${users.name} collate nocase`;

const lastOwnerError = () =>
  new ApiError(409, STAFF_ERROR_CODES.lastOwner, 'Nobody else holds an owner position. Give someone else an owner position first.');
const exceedsError = () =>
  new ApiError(403, STAFF_ERROR_CODES.exceedsYourAccess, 'That would give or touch access you don’t have yourself');
const ownerOnlyError = () => new ApiError(403, STAFF_ERROR_CODES.ownerOnly, 'Only an owner can give or take an owner position');

type PositionRow = typeof positions.$inferSelect;

/**
 * The positions named by `ids` (deduplicated); a field error on positionIds if
 * any doesn't exist. Owner positions don't exist for non-owners, so naming one
 * gets the same answer as a missing id.
 */
function findPositions(db: Tx, ids: number[], actor: Actor): PositionRow[] {
  const unique = [...new Set(ids)];
  const rows = inChunks(unique, (ids) =>
    db
      .select()
      .from(positions)
      .where(and(inArray(positions.id, ids), actor.isOwner ? undefined : eq(positions.isOwner, false)))
      .all(),
  );
  if (rows.length !== unique.length) {
    throw new ApiError(400, 'validation', 'Some fields are missing or invalid', [
      { path: ['positionIds'], code: 'custom', message: 'staff:errors.positionNotFound' },
    ]);
  }
  return rows;
}

/**
 * Giving or taking these positions: owner positions need an owner; anything
 * else needs the actor to hold every permission the position allows (what it
 * actually allows — the same list GET /positions shows).
 */
function assertMayAssign(actor: Actor, changed: readonly Pick<PositionRow, 'isOwner' | 'permissions'>[]) {
  if (actor.isOwner) return;
  if (changed.some((p) => p.isOwner)) throw ownerOnlyError();
  if (!changed.every((p) => withinAccess(actor, positionAllows(p)))) throw exceedsError();
}

/** Everyone signed in: names and positions for teacher pickers. Registered before /:id. */
router.get('/directory', (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const rows = db
    .select({ id: users.id, name: users.name, active: users.active, photoFileId: users.photoFileId })
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

/**
 * For the add and edit forms, as the manager types: is this username valid and
 * free, and which one to offer for this name (UsernameCheck). "Taken" covers
 * every account, owners too, without saying whose. Registered before /:id.
 */
router.get('/username-check', canManage, (c) => {
  const q = query(c, usernameCheckQuery);
  const db = c.get('db');
  const me = currentUser(c);
  // `exceptId` (the account being edited) only counts for an account the caller may open — the
  // reach of GET /:id: an owner's id, for a non-owner, is ignored exactly like a missing one.
  // Otherwise "ok for exceptId=<owner>" would confirm that owner's username.
  const visible =
    q.exceptId !== undefined &&
    !!db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, q.exceptId), me.isOwner ? undefined : notAnOwner))
      .get();
  return c.json<UsernameCheck>(checkUsername(db, { ...q, exceptId: visible ? q.exceptId : undefined }, getSettings(db).emailDomain));
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
  const chosen = findPositions(db, input.positionIds, me);
  assertMayAssign(me, chosen);
  const settings = getSettings(db);
  // Cheap check first so a duplicate doesn't pay for a slow hash; re-checked in the transaction.
  // The username as typed (or made from the email, for an older copy of the app) and the address that goes with it.
  const names = newAccountNames(db, input, settings.emailDomain);
  const passwordHash = await hashPassword(input.password);
  const locale = input.locale ?? settings.defaultLocale;

  const created = db.transaction((tx) => {
    const { username, email } = newAccountNames(tx, { ...input, username: names.username }, settings.emailDomain);
    const user = tx
      .insert(users)
      // The manager knows this password: it is temporary, and the person chooses their own at the first sign-in.
      .values({ name: input.name, username, email, passwordHash, mustChangePassword: true, phone: input.phone ?? null, locale, active: true })
      .returning()
      .get();
    for (const batch of insertBatches(userPositions, chosen.map((p) => ({ userId: user.id, positionId: p.id })))) tx.insert(userPositions).values(batch).run();
    return user;
  });
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
    const chosen = findPositions(db, input.positionIds, me);
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
  // A new username: free (409, never saying whose it is), and the automatic address follows it unless this request sets the email.
  const emailDomain = getSettings(db).emailDomain;
  const rename = (reader: Tx) => (input.username === undefined ? {} : usernameChange(reader, target, input.username, emailDomain, { keepEmail: input.email !== undefined }));
  rename(db);

  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.active !== undefined) patch.active = input.active;
  if (passwordHash) {
    patch.passwordHash = passwordHash;
    // Someone else now knows their password: they choose their own at the next sign-in. (Your own, set here, is yours.)
    patch.mustChangePassword = !isSelf;
  }

  const signOutEverywhere = deactivating || passwordHash !== undefined;
  const currentSession = c.get('sessionId');

  const result = db.transaction((tx) => {
    // Re-check the rules that depend on other rows, now that nothing can change under us.
    if (losesOwner && activeOwnerCount(tx, { exceptUserId: id }) === 0) return 'last_owner' as const;
    if (patch.email !== undefined && patch.email !== target.email && emailInUse(tx, patch.email, id)) return 'email_taken' as const;
    Object.assign(patch, rename(tx));
    const row = Object.keys(patch).length ? tx.update(users).set(patch).where(eq(users.id, id)).returning().get()! : target;
    if (nextPositions) {
      tx.delete(userPositions).where(eq(userPositions.userId, id)).run();
      for (const batch of insertBatches(userPositions, nextPositions.map((p) => ({ userId: id, positionId: p.id })))) tx.insert(userPositions).values(batch).run();
      if (!Object.keys(patch).length) tx.update(users).set({ updatedAt: Date.now() }).where(eq(users.id, id)).run();
    }
    if (signOutEverywhere) {
      // Resetting your own password here keeps this device signed in (same as POST /auth/password).
      // The person's push subscriptions go with their sessions: a lost phone stops getting notifications.
      signOutUser(tx, id, isSelf ? currentSession : null);
    }
    return row;
  });
  if (result === 'last_owner') throw lastOwnerError();
  if (result === 'email_taken') throw emailTakenError();
  return c.json(staffMember(db, result, me));
});

/**
 * Set or remove someone's profile photo (staff.manage), with the same reach
 * rules as editing them: owner accounts are a 404 for non-owners, and someone
 * who can do more than you is out of your reach (403). The photo is an image
 * the caller uploaded in the last hour; the old one's file is deleted when
 * nothing else uses it.
 */
router.put('/:id/photo', canManage, async (c) => {
  const id = paramId(c);
  const input = await body(c, photoInput);
  const me = currentUser(c);
  const db = c.get('db');
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) throw notFound('Staff member not found');
  const access = loadAccess(db, [id]).get(id)!;
  if (!me.isOwner && access.isOwner) throw notFound('Staff member not found');
  if (!withinAccess(me, access.permissions)) throw exceedsError();
  const now = Date.now();
  const previous = db.transaction((tx) => {
    const old = tx.select({ photoFileId: users.photoFileId }).from(users).where(eq(users.id, id)).get()?.photoFileId ?? null;
    if (input.fileId === old) return null;
    if (input.fileId) {
      claimUploads(tx, me.id, [input.fileId], { now, maxAgeMs: FRESH_UPLOAD_MS, path: ['fileId'], message: TEAM_ERROR_KEYS.photoNotYours, imagesOnly: true });
    }
    tx.update(users).set({ photoFileId: input.fileId }).where(eq(users.id, id)).run();
    return old;
  });
  await releaseFile(db, c.get('files'), previous);
  return c.json(staffMember(db, db.select().from(users).where(eq(users.id, id)).get()!, me));
});

export default router;
