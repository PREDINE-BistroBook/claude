import { and, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { PERMISSIONS, normalizePermissions } from '../../shared/permissions';
import type { ListResponse } from '../../shared/schemas/common';
import { POSITION_ERROR_CODES, positionInput, positionUpdateInput, type Position } from '../../shared/schemas/positions';
import type { DB } from '../db/client';
import { positions } from '../db/schema';
import type { AppEnv } from '../env';
import {
  activeOwnerCount,
  hasPermission,
  holderCounts,
  positionAllows as allowed,
  positionOrder,
  positionsHeldBeyondReach,
  withinAccess,
  type Actor,
} from '../lib/access';
import { ApiError, notFound } from '../lib/errors';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Positions (CEO, Acting coach, …) and what each allows. Listing needs
 * staff.manage (to assign them) or positions.manage; changing them needs
 * positions.manage. For anyone who isn't an owner:
 * - owner positions are invisible (404) and can't be created; position names
 *   only have to be unique among the positions they can see, so a hidden
 *   name is no oracle;
 * - a position may only allow permissions they hold themselves, and one that
 *   already allows more than they hold is out of their reach;
 * - so is a position held by someone (not an owner) who can do more than
 *   they can: changing it would change that person's access, which the staff
 *   rules don't let them touch.
 * Built-in positions can be renamed and changed but not deleted (they'd come
 * back on the next start); a position someone holds can't be deleted.
 * holderCount counts every holder, owners included (a bare number), so it
 * agrees with the delete rule.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canManage = requirePermission('positions.manage');

type PositionRow = typeof positions.$inferSelect;
type Tx = Pick<DB, 'select'>;

/**
 * `heldBeyondReach`: someone who can do more than the actor holds it (see
 * positionsHeldBeyondReach) — it may still be given to people, not changed.
 */
function toPosition(p: PositionRow, holderCount: number, actor: Actor, heldBeyondReach: boolean): Position {
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
    editable: reach && !heldBeyondReach && hasPermission(actor, 'positions.manage'),
    assignable: reach && hasPermission(actor, 'staff.manage'),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function holderCount(db: Tx, positionId: number): number {
  return holderCounts(db, positionId).get(positionId) ?? 0;
}

/** The position, if this person may see it (owner positions are hidden from non-owners). */
function findPosition(db: Tx, id: number, actor: Actor): PositionRow {
  const row = db.select().from(positions).where(eq(positions.id, id)).get();
  if (!row || (row.isOwner && !actor.isOwner)) throw notFound('Position not found');
  return row;
}

/**
 * Which name (English or Arabic) another position already uses, if any. Checked
 * across ALL positions, owner ones included: otherwise a non-owner could create
 * an ordinary "CEO" next to the real one and mislead the owners. It only reveals
 * that a name is taken (the built-in owner names are public anyway).
 */
function nameTaken(db: Tx, name: string | undefined, nameAr: string | null | undefined, exceptId?: number): 'name' | 'nameAr' | null {
  const others = exceptId === undefined ? undefined : ne(positions.id, exceptId);
  if (name !== undefined && db.select({ id: positions.id }).from(positions).where(and(sql`lower(${positions.name}) = lower(${name})`, others)).get()) return 'name';
  if (nameAr && db.select({ id: positions.id }).from(positions).where(and(eq(positions.nameAr, nameAr), others)).get()) return 'nameAr';
  return null;
}

const nameTakenError = (field: 'name' | 'nameAr') =>
  new ApiError(409, POSITION_ERROR_CODES.nameTaken, 'Another position already has this name', [
    { path: [field], code: 'custom', message: 'positions:errors.nameTaken' },
  ]);
const exceedsError = () => new ApiError(403, POSITION_ERROR_CODES.exceedsYourAccess, 'You can’t give access you don’t have yourself');
const ownerOnlyError = () => new ApiError(403, POSITION_ERROR_CODES.ownerOnly, 'Only an owner can create or change owner positions');
const lastOwnerError = () =>
  new ApiError(409, POSITION_ERROR_CODES.lastOwner, 'Nobody else would hold an owner position. Give someone another owner position first.');

router.get('/', requireAnyPermission('staff.manage', 'positions.manage'), (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const counts = holderCounts(db);
  const beyond = positionsHeldBeyondReach(db, me);
  const rows = db
    .select()
    .from(positions)
    .where(me.isOwner ? undefined : eq(positions.isOwner, false))
    .orderBy(...positionOrder)
    .all();
  return c.json<ListResponse<Position>>({ items: rows.map((p) => toPosition(p, counts.get(p.id) ?? 0, me, beyond.has(p.id))) });
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
    const taken = nameTaken(tx, input.name, input.nameAr);
    if (taken) return taken;
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
  if (typeof created === 'string') throw nameTakenError(created);
  return c.json(toPosition(created, 0, me, false), 201);
});

router.patch('/:id', canManage, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const current = findPosition(db, id, me);
  const input = await body(c, positionUpdateInput);

  if (!me.isOwner) {
    if (input.isOwner) throw ownerOnlyError();
    // A position that already allows more than you hold is out of your reach…
    if (!withinAccess(me, allowed(current))) throw exceedsError();
    // …and so is one held by someone who can do more than you (it would change their access).
    if (positionsHeldBeyondReach(db, me, id).size) throw exceedsError();
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

  // Only a new name is checked: saving a position under the name it already has is always fine.
  const newName = input.name !== undefined && input.name !== current.name ? input.name : undefined;
  const newNameAr = input.nameAr !== undefined && input.nameAr !== current.nameAr ? input.nameAr : undefined;

  const result = db.transaction((tx) => {
    // Re-checked here: nobody can be given the position between the check and the update.
    if (!me.isOwner && positionsHeldBeyondReach(tx, me, id).size) return 'exceeds' as const;
    const taken = nameTaken(tx, newName, newNameAr, id);
    if (taken) return { taken };
    if (losesOwner && activeOwnerCount(tx, { exceptPositionId: id }) === 0) return 'last_owner' as const;
    return tx.update(positions).set(patch).where(eq(positions.id, id)).returning().get()!;
  });
  if (result === 'exceeds') throw exceedsError();
  if (result === 'last_owner') throw lastOwnerError();
  if ('taken' in result) throw nameTakenError(result.taken);
  return c.json(toPosition(result, holderCount(db, id), me, positionsHeldBeyondReach(db, me, id).size > 0));
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
