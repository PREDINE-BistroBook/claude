/**
 * Recovery: give an existing staff account an owner position — the CEO
 * position — and reactivate it.
 *
 *   npm run owner -- someone@example.com      (or the account's username: npm run owner -- ceo)
 *
 * Use it when nobody who can manage staff can sign in any more. (Upgrading a
 * phase-1 database needs nothing: opening it carries the fixed roles over to
 * the matching positions — see db/database.ts. If none of the former owners is
 * active, run this for one of them.) Uses $DATA_DIR like the server. On
 * Cloudflare the same recovery is POST /api/admin/grant-owner (README).
 *
 * The rules (CEO, or another owner position, or CEO made an owner position
 * again) are in lib/ownerRecovery.ts.
 */
import path from 'node:path';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import { grantOwner } from '../lib/ownerRecovery';
import { loadConfig } from '../nodeConfig';
import { createDb } from './client';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run owner -- someone@example.com   (or the username: npm run owner -- ceo)');
  process.exit(1);
}

const config = loadConfig();
const dbPath = path.join(config.dataDir, 'app.db');
// createDb applies migrations and creates the built-in positions if they're missing.
const db = createDb(dbPath);
const result = grantOwner(db, email);
db.$client.close();

if (!result.found) {
  console.error(`No staff account uses ${email} in ${dbPath}. Check the address (or DATA_DIR) and try again.`);
  process.exit(1);
}
if (!result.isOwner) {
  console.error(`Could not make ${result.user.email} an owner. Check the positions table in ${dbPath}.`);
  process.exit(1);
}
const notes = [
  result.restored ? `${result.position.name} is an owner position again` : null,
  result.position.key !== FIRST_OWNER_POSITION ? 'the CEO position is no longer an owner position' : null,
].filter(Boolean);
console.log(
  `${result.user.name} <${result.user.email}> now holds the ${result.position.name} position${result.wasActive ? '' : ' and was reactivated'}` +
    (notes.length ? ` (${notes.join('; ')})` : '') +
    '.',
);
