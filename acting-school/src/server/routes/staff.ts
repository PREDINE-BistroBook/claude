import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ListResponse } from '../../shared/schemas/common';
import { staffCreateInput, staffUpdateInput, type StaffDirectoryEntry, type StaffMember } from '../../shared/schemas/staff';
import type { DB } from '../db/client';
import { authSessions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ApiError, forbidden, notFound } from '../lib/errors';
import { hashPassword } from '../lib/password';
import { getSettings } from '../lib/settings';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Staff accounts. Owners and admins manage the team; only an owner may touch
 * an owner account or hand out the owner role. There is no DELETE: classes,
 * uploads and history point at users, so people are deactivated instead
 * (which also signs them out everywhere).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canManage = requirePermission('staff.manage');

type UserRow = typeof users.$inferSelect;
/** The db or a transaction — both have the same query builder. */
type Tx = Pick<DB, 'select'>;

function toStaffMember(u: UserRow): StaffMember {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    locale: u.locale,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

const byName = sql`${users.name} collate nocase`;

function emailTakenError(): ApiError {
  return new ApiError(409, 'email_taken', 'Another staff account already uses this email', [
    { path: ['email'], code: 'custom', message: 'staff:errors.emailTaken' },
  ]);
}

function emailInUse(db: Tx, email: string, exceptId?: number): boolean {
  const where = exceptId === undefined ? eq(users.email, email) : and(eq(users.email, email), ne(users.id, exceptId));
  return !!db.select({ id: users.id }).from(users).where(where).get();
}

function activeOwnerCount(db: Tx): number {
  return db.select({ n: count() }).from(users).where(and(eq(users.role, 'owner'), eq(users.active, true))).get()?.n ?? 0;
}

/** Everyone signed in: names and roles for teacher pickers. Registered before /:id. */
router.get('/directory', (c) => {
  const rows = c
    .get('db')
    .select({ id: users.id, name: users.name, role: users.role, active: users.active })
    .from(users)
    .orderBy(asc(byName), asc(users.id))
    .all();
  const res: ListResponse<StaffDirectoryEntry> = { items: rows };
  return c.json(res);
});

/** Full list for the staff screen: active people first, then by name. */
router.get('/', canManage, (c) => {
  const rows = c.get('db').select().from(users).orderBy(desc(users.active), asc(byName), asc(users.id)).all();
  const res: ListResponse<StaffMember> = { items: rows.map(toStaffMember) };
  return c.json(res);
});

router.post('/', canManage, async (c) => {
  const input = await body(c, staffCreateInput);
  const me = currentUser(c);
  if (input.role === 'owner' && me.role !== 'owner') throw forbidden('Only an owner can create another owner');
  const db = c.get('db');
  // Cheap check first so a duplicate doesn't pay for a slow hash; re-checked in the transaction.
  if (emailInUse(db, input.email)) throw emailTakenError();
  const passwordHash = await hashPassword(input.password);
  const locale = input.locale ?? getSettings(db).defaultLocale;

  const created = db.transaction((tx) => {
    if (emailInUse(tx, input.email)) return null;
    return tx
      .insert(users)
      .values({ name: input.name, email: input.email, role: input.role, passwordHash, phone: input.phone ?? null, locale, active: true })
      .returning()
      .get();
  });
  if (!created) throw emailTakenError();
  return c.json(toStaffMember(created), 201);
});

router.patch('/:id', canManage, async (c) => {
  const id = paramId(c);
  const input = await body(c, staffUpdateInput);
  const me = currentUser(c);
  const db = c.get('db');

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) throw notFound('Staff member not found');
  if (me.role !== 'owner' && (target.role === 'owner' || input.role === 'owner')) {
    throw forbidden('Only an owner can change an owner account or give someone the owner role');
  }

  const isSelf = target.id === me.id;
  const roleChanges = input.role !== undefined && input.role !== target.role;
  const deactivating = input.active === false && target.active;
  // Taking away the last active owner would lock everyone out of owner-only actions.
  const losesOwner = target.role === 'owner' && target.active && ((roleChanges && input.role !== 'owner') || deactivating);
  if (losesOwner && activeOwnerCount(db) <= 1) {
    throw new ApiError(409, 'last_owner', 'This is the only active owner. Make someone else an owner first.');
  }
  if (isSelf && (roleChanges || deactivating)) {
    throw new ApiError(409, 'cannot_change_self', 'You can’t change your own role or deactivate yourself');
  }
  if (input.email !== undefined && input.email !== target.email && emailInUse(db, input.email, id)) throw emailTakenError();

  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.email !== undefined) patch.email = input.email;
  if (input.role !== undefined) patch.role = input.role;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.active !== undefined) patch.active = input.active;
  if (passwordHash) patch.passwordHash = passwordHash;

  const signOutEverywhere = deactivating || passwordHash !== undefined;
  const currentSession = c.get('sessionId');

  const result = db.transaction((tx) => {
    // Re-check the rules that depend on other rows, now that nothing can change under us.
    if (losesOwner && activeOwnerCount(tx) <= 1) return 'last_owner' as const;
    if (patch.email !== undefined && patch.email !== target.email && emailInUse(tx, patch.email, id)) return 'email_taken' as const;
    const row = Object.keys(patch).length ? tx.update(users).set(patch).where(eq(users.id, id)).returning().get()! : target;
    if (signOutEverywhere) {
      // Resetting your own password here keeps this device signed in (same as POST /auth/password).
      const keep = isSelf && currentSession ? ne(authSessions.id, currentSession) : undefined;
      tx.delete(authSessions)
        .where(keep ? and(eq(authSessions.userId, id), keep) : eq(authSessions.userId, id))
        .run();
    }
    return row;
  });
  if (result === 'last_owner') throw new ApiError(409, 'last_owner', 'This is the only active owner. Make someone else an owner first.');
  if (result === 'email_taken') throw emailTakenError();
  return c.json(toStaffMember(result));
});

export default router;
