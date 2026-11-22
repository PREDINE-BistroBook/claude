/**
 * Recovery: give an existing staff account the CEO position (and reactivate it).
 *
 *   npm run owner -- someone@example.com
 *
 * Use it when nobody who can manage staff can sign in any more, or after
 * upgrading a database from before positions existed (phase 1 had fixed roles;
 * the upgrade drops them, so give the owner their position back with this, then
 * assign everyone else's positions from the Staff screen). Uses $DATA_DIR like
 * the server.
 */
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import { loadConfig } from '../config';
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

const ceo = db.select().from(positions).where(eq(positions.key, FIRST_OWNER_POSITION)).get()!;
db.transaction((tx) => {
  tx.insert(userPositions).values({ userId: user.id, positionId: ceo.id }).onConflictDoNothing().run();
  if (!user.active) tx.update(users).set({ active: true }).where(eq(users.id, user.id)).run();
});
db.$client.close();

console.log(`${user.name} <${user.email}> now holds the ${ceo.name} position${user.active ? '' : ' and was reactivated'}.`);
