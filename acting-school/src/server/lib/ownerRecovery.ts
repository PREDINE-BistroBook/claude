/**
 * Lockout recovery: give an existing staff account an owner position — the
 * CEO position — reactivate it, and lift the sign-in brakes on it (so
 * someone who kept failing sign-ins as that account can't keep the owner out).
 * The account is named by its username or its email address, like at sign-in.
 * Used by `npm run owner -- <username or email>` (Node,
 * db/grantOwner.ts) and POST /api/admin/grant-owner (Cloudflare, behind
 * ADMIN_TOKEN).
 *
 * Owners can turn the CEO position into an ordinary one; then another owner
 * position (CFO, …) is given instead, and if no owner position is left at all,
 * CEO becomes an owner position again. Either way the account ends up an owner.
 */
import { eq } from 'drizzle-orm';
import { FIRST_OWNER_POSITION, PERMISSIONS } from '../../shared/permissions';
import type { DB } from '../db/database';
import { positions, userPositions, users } from '../db/schema';
import { loadUserAccess, positionOrder } from './access';
import { clearAccountBrakes } from './signInBrake';
import { findSignInAccount } from './usernames';

export type GrantOwnerResult =
  | { found: false }
  | {
      found: true;
      user: { id: number; username: string; email: string; name: string };
      position: { id: number; key: string | null; name: string };
      wasActive: boolean;
      /** CEO had no owner flag and no other owner position existed: CEO is an owner position again. */
      restored: boolean;
      /** The account is an owner now (false only if the positions table is in a state this can't fix). */
      isOwner: boolean;
    };

export function grantOwner(db: DB, usernameOrEmail: string): GrantOwnerResult {
  const name = usernameOrEmail.trim().toLowerCase();
  return db.transaction((tx): GrantOwnerResult => {
    const user = findSignInAccount(tx, name);
    if (!user) return { found: false };
    const ceo = tx.select().from(positions).where(eq(positions.key, FIRST_OWNER_POSITION)).get()!;
    // The CEO position if it's still an owner position, else any other owner position.
    let given = ceo.isOwner ? ceo : tx.select().from(positions).where(eq(positions.isOwner, true)).orderBy(...positionOrder).get();
    let restored = false;
    if (!given) {
      // No owner position left at all: make CEO one again (it then allows everything).
      given = tx.update(positions).set({ isOwner: true, permissions: [...PERMISSIONS] }).where(eq(positions.id, ceo.id)).returning().get()!;
      restored = true;
    }
    tx.insert(userPositions).values({ userId: user.id, positionId: given.id }).onConflictDoNothing().run();
    if (!user.active) tx.update(users).set({ active: true }).where(eq(users.id, user.id)).run();
    // The brakes count under the account's email address, whichever name was typed at sign-in.
    clearAccountBrakes(tx, user.email);
    return {
      found: true,
      user: { id: user.id, username: user.username ?? '', email: user.email, name: user.name },
      position: { id: given.id, key: given.key, name: given.name },
      wasActive: user.active,
      restored,
      isOwner: loadUserAccess(tx, user.id).isOwner,
    };
  });
}
