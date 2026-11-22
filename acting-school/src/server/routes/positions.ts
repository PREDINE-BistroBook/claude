import { and, count, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { PERMISSIONS, normalizePermissions, type Permission } from '../../shared/permissions';
import type { ListResponse } from '../../shared/schemas/common';
import { POSITION_ERROR_CODES, positionInput, positionUpdateInput, type Position } from '../../shared/schemas/positions';
import type { DB } from '../db/client';
import { positions, userPositions } from '../db/schema';
import type { AppEnv } from '../env';
import { activeOwnerCount, hasPermission, holderCounts, positionOrder, withinAccess, type Actor } from '../lib/access';
import { ApiError, notFound } from '../lib/errors';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Positions (CEO, Acting coach, …) and what each allows. Listing needs
 * staff.manage (to assign them) or positions.manage; changing them needs
 * positions.manage. For anyone who isn't an owner:
 * - owner positions are invisible (404) and can't be created;
 * - a position may only allow permissions they hold themselves, and one that
 *   already allows more than they hold is out of their reach.
 * Built-in positions can be renamed and changed but not deleted (they'd come
 * back on the next start); a position someone holds can't be deleted.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canManage = requirePermission('positions.manage');

type PositionRow = typeof positions.$inferSelect;
type Tx = Pick<DB, 'select'>;

/** What a position actually allows: owner positions allow everything. */
const allowed = (p: Pick<PositionRow, 'isOwner' | 'permissions'>): Permission[] =>
  p.isOwner ? [...PERMISSIONS] : normalizePermissions(p.permissions);

function toPosition(p: PositionRow, holderCount: number, actor: Actor): Position {
  const reach = actor.isOwner || (!p.isOwner && withinAccess(actor, allowed(p)));
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    nameAr: p.nameAr,
    isOwner: p.isOwner,
    permissions: allowed(p),
    sortOrder: p.sortOrder,
    holderCount,
    editable: reach && hasPermission(actor, 'positions.manage'),
    assignable: reach && hasPermission(actor, 'staff.manage'),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function holderCount(db: Tx, positionId: number): number {
  return db.select({ n: count() }).from(userPositions).where(eq(userPositions.positionId, positionId)).get()?.n ?? 0;
}

/** The position, if this person may see it (owner positions are hidden from non-owners). */
function findPosition(db: Tx, id: number, actor: Actor): PositionRow {
  const row = db.select().from(positions).where(eq(positions.id, id)).get();
  if (!row || (row.isOwner && !actor.isOwner)) throw notFound('Position not found');
  return row;
}

function nameTaken(db: Tx, name: string, exceptId?: number): boolean {
  return !!db
    .select({ id: positions.id })
    .from(positions)
    .where(and(sql`lower(${positions.name}) = lower(${name})`, exceptId === undefined ? undefined : ne(positions.id, exceptId)))
    .get();
}

const nameTakenError = () =>
  new ApiError(409, POSITION_ERROR_CODES.nameTaken, 'Another position already has this name', [
    { path: ['name'], code: 'custom', message: 'positions:errors.nameTaken' },
  ]);
const exceedsError = () => new ApiError(403, POSITION_ERROR_CODES.exceedsYourAccess, 'You can’t give access you don’t have yourself');
const ownerOnlyError = () => new ApiError(403, POSITION_ERROR_CODES.ownerOnly, 'Only an owner can create or change owner positions');
const lastOwnerError = () =>
  new ApiError(409, POSITION_ERROR_CODES.lastOwner, 'Nobody else would hold an owner position. Give someone another owner position first.');

router.get('/', requireAnyPermission('staff.manage', 'positions.manage'), (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const counts = holderCounts(db, { excludeOwners: !me.isOwner });
  const rows = db
    .select()
    .from(positions)
    .where(me.isOwner ? undefined : eq(positions.isOwner, false))
    .orderBy(...positionOrder)
    .all();
  return c.json<ListResponse<Position>>({ items: rows.map((p) => toPosition(p, counts.get(p.id) ?? 0, me)) });
});

router.post('/', canManage, async (c) => {
  const input = await body(c, positionInput);
  const me = currentUser(c);
  const db = c.get('db');
  const isOwner = input.isOwner ?? false;
  if (isOwner && !me.isOwner) throw ownerOnlyError();
  const permissions = isOwner ? [...PERMISSIONS] : normalizePermissions(input.permissions);
  if (!withinAccess(me, permissions)) throw exceedsError();

  const created = db.transaction((tx) => {
    if (nameTaken(tx, input.name)) return null;
    const last = tx.select({ n: sql<number | null>`max(${positions.sortOrder})` }).from(positions).get()?.n;
    return tx
      .insert(positions)
      .values({
        key: null,
        name: input.name,
        nameAr: input.nameAr ?? null,
        isOwner,
        permissions,
        sortOrder: input.sortOrder ?? (last == null ? 0 : last + 10),
      })
      .returning()
      .get();
  });
  if (!created) throw nameTakenError();
  return c.json(toPosition(created, 0, me), 201);
});

router.patch('/:id', canManage, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const current = findPosition(db, id, me);
  const input = await body(c, positionUpdateInput);

  if (!me.isOwner) {
    if (input.isOwner) throw ownerOnlyError();
    // A position that already allows more than you hold is out of your reach.
    if (!withinAccess(me, allowed(current))) throw exceedsError();
  }
  const isOwner = input.isOwner ?? current.isOwner;
  const permissions = isOwner ? [...PERMISSIONS] : normalizePermissions(input.permissions ?? current.permissions);
  if (!withinAccess(me, permissions)) throw exceedsError();
  // Turning an owner position into an ordinary one must leave someone holding an owner position.
  const losesOwner = current.isOwner && !isOwner;
  if (losesOwner && activeOwnerCount(db, { exceptPositionId: id }) === 0) throw lastOwnerError();

  const patch: Partial<typeof positions.$inferInsert> = { isOwner, permissions };
  if (input.name !== undefined) patch.name = input.name;
  if (input.nameAr !== undefined) patch.nameAr = input.nameAr;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  const result = db.transaction((tx) => {
    if (input.name !== undefined && nameTaken(tx, input.name, id)) return 'name_taken' as const;
    if (losesOwner && activeOwnerCount(tx, { exceptPositionId: id }) === 0) return 'last_owner' as const;
    return tx.update(positions).set(patch).where(eq(positions.id, id)).returning().get()!;
  });
  if (result === 'name_taken') throw nameTakenError();
  if (result === 'last_owner') throw lastOwnerError();
  const visibleHolders = me.isOwner ? holderCount(db, id) : (holderCounts(db, { excludeOwners: true }).get(id) ?? 0);
  return c.json(toPosition(result, visibleHolders, me));
});

router.delete('/:id', canManage, (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const current = findPosition(db, id, me);
  if (!withinAccess(me, allowed(current))) throw exceedsError();
  if (current.key) throw new ApiError(409, POSITION_ERROR_CODES.builtIn, 'Built-in positions can be renamed or changed, but not deleted');

  const result = db.transaction((tx) => {
    // Checked inside the transaction: nobody can be given it between the check and the delete.
    if (holderCount(tx, id) > 0) return 'in_use' as const;
    tx.delete(positions).where(eq(positions.id, id)).run();
    return 'deleted' as const;
  });
  if (result === 'in_use') throw new ApiError(409, POSITION_ERROR_CODES.inUse, 'Someone holds this position. Give them another position first.');
  return c.body(null, 204);
});

export default router;
