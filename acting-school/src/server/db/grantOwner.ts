/**
 * Recovery: give an existing staff account an owner position — the CEO
 * position — and reactivate it.
 *
 *   npm run owner -- someone@example.com
 *
 * Use it when nobody who can manage staff can sign in any more. (Upgrading a
 * phase-1 database needs nothing: opening it carries the fixed roles over to
 * the matching positions — see db/client.ts. If none of the former owners is
 * active, run this for one of them.) Uses $DATA_DIR like the server.
 *
 * Owners can turn the CEO position into an ordinary one; then another owner
 * position (CFO, …) is given instead, and if no owner position is left at all,
 * CEO becomes an owner position again. Either way the account ends up an
 * owner, or the script fails loudly.
 */
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { FIRST_OWNER_POSITION, PERMISSIONS } from '../../shared/permissions';
import { loadConfig } from '../config';
import { loadUserAccess, positionOrder } from '../lib/access';
import { createDb } from './client';
import { positions, userPositions, users } from './schema';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run owner -- someone@example.com');
  process.exit(1);
}

const config = loadConfig();
const dbPath = path.join(config.dataDir, 'app.db');
// createDb applies migrations and creates the built-in positions if they're missing.
const db = createDb(dbPath);

const user = db.select().from(users).where(eq(users.email, email)).get();
if (!user) {
  console.error(`No staff account uses ${email} in ${dbPath}. Check the address (or DATA_DIR) and try again.`);
  db.$client.close();
  process.exit(1);
}

const result = db.transaction((tx) => {
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
  return { given, restored, isOwner: loadUserAccess(tx, user.id).isOwner };
});
db.$client.close();

if (!result.isOwner) {
  console.error(`Could not make ${user.email} an owner. Check the positions table in ${dbPath}.`);
  process.exit(1);
}
const notes = [
  result.restored ? `${result.given.name} is an owner position again` : null,
  result.given.key !== FIRST_OWNER_POSITION ? 'the CEO position is no longer an owner position' : null,
].filter(Boolean);
console.log(
  `${user.name} <${user.email}> now holds the ${result.given.name} position${user.active ? '' : ' and was reactivated'}` +
    (notes.length ? ` (${notes.join('; ')})` : '') +
    '.',
);
