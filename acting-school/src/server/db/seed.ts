/**
 * Demo data on the Node server: `npm run seed` (add `-- --reset` to wipe and
 * start over). Fills $DATA_DIR/app.db and $DATA_DIR/uploads/ through the real
 * API — the demo itself (people, classes, castings, enquiries, and the few
 * timestamps it backdates) is db/demoSeed.ts, shared with POST
 * /api/admin/seed-demo on Cloudflare. Every account's password here is
 * demo1234; the deployed demo uses the password its operator chose.
 */
import { count } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../app';
import { folderFileStore } from '../nodeFileStore';
import { loadConfig } from '../nodeConfig';
import { createDb } from './client';
import { DEMO_LOGINS, seedDemo } from './demoSeed';
import { users } from './schema';

const PASSWORD = 'demo1234';
const args = new Set(process.argv.slice(2));
const config = loadConfig();
const dbPath = path.join(config.dataDir, 'app.db');

if (args.has('--reset')) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  fs.rmSync(config.uploadsDir, { recursive: true, force: true });
}

const db = createDb(dbPath);
const existing = db.select({ n: count() }).from(users).get()?.n ?? 0;
if (existing > 0) {
  console.error(
    `\nThe database at ${dbPath} already has ${existing} staff account(s), so nothing was changed.\n` +
      'To wipe it (app.db and uploads/) and load the demo data instead, run:\n\n  npm run seed -- --reset\n',
  );
  process.exit(1);
}

const files = folderFileStore(config.uploadsDir);
const app = createApp({ db, config, files });
const result = await seedDemo({
  db,
  files,
  request: (p, init) => app.request(p, init),
  password: PASSWORD,
  timeZone: config.timeZone,
  // Only needed with REQUIRE_SETUP_CODE=true.
  setupCode: config.adminToken ?? undefined,
});
db.$client.close();

const { counts } = result;
const width = Math.max(...DEMO_LOGINS.map((l) => l.email.length));
const posWidth = Math.max(...DEMO_LOGINS.map((l) => l.position.length));
console.log(`
Turquoise Studio demo data is ready (${result.seconds.toFixed(1)}s) in ${config.dataDir}

  ${counts.students} students · ${counts.classes} classes · ${counts.talent} talent · ${counts.castings} castings · ${counts.enquiries} enquiries

Sign in with any of these (password: ${PASSWORD}):
${DEMO_LOGINS.map((l) => `  ${l.email.padEnd(width)}  ${l.position.padEnd(posWidth)}  — ${l.name}`).join('\n')}
`);
