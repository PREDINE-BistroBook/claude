import { count, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import { changePasswordInput, loginInput, profileInput, setupInput, type MeResponse } from '../../shared/schemas/auth';
import { FRESH_UPLOAD_MS } from '../../shared/schemas/chat';
import { photoInput, TEAM_ERROR_KEYS } from '../../shared/schemas/team';
import { positions, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ensureBuiltInPositions, toSessionUser } from '../lib/access';
import { ApiError } from '../lib/errors';
import { claimUploads, releaseFile } from '../lib/fileRefs';
import { getDummyHash, hashPassword, sameSecret, verifyPassword } from '../lib/password';
import { getSettings, saveSettings } from '../lib/settings';
import { clearSignInFailures, recordSignInFailure, signInBlocked } from '../lib/signInBrake';
import { body } from '../lib/validate';
import { currentUser, endSession, requireAuth, signOutUser, startSession } from '../middleware/auth';

const router = new Hono<AppEnv>();

function staffCount(c: { get: (k: 'db') => AppEnv['Variables']['db'] }): number {
  return c.get('db').select({ n: count() }).from(users).get()?.n ?? 0;
}

/** Who am I? Public: answers { user: null } when signed out, plus whether first-run setup is needed. */
router.get('/me', (c) => {
  const { schoolName, schoolNameAr } = getSettings(c.get('db'));
  const needsSetup = staffCount(c) === 0;
  const res: MeResponse = {
    user: c.get('user'),
    needsSetup,
    setupCodeRequired: needsSetup && c.get('config').requireSetupCode,
    schoolName,
    schoolNameAr,
  };
  return c.json(res);
});

router.post('/login', async (c) => {
  const input = await body(c, loginInput);
  const db = c.get('db');
  const address = c.get('clientIp');
  // Before hashing: a tripped brake costs one query, a hash ~90 ms (lib/signInBrake.ts).
  if (signInBlocked(db, input.email, address)) throw new ApiError(429, 'too_many_attempts', 'Too many attempts. Try again in a few minutes.');
  const user = db.select().from(users).where(eq(users.email, input.email)).get();
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok || !user.active) {
    recordSignInFailure(db, input.email, address);
    throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  clearSignInFailures(db, input.email, address);
  db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
  startSession(c, user.id);
  return c.json({ user: toSessionUser(db, user) });
});

router.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/**
 * Where setup needs the setup code (AppConfig.requireSetupCode — Cloudflare): it
 * must equal ADMIN_TOKEN. Checked before any hashing; without an ADMIN_TOKEN
 * nobody can set the school up until one is configured.
 */
function checkSetupCode(c: Context<AppEnv>, code: string | undefined) {
  const { requireSetupCode, adminToken } = c.get('config');
  if (!requireSetupCode) return;
  if (!adminToken) throw new ApiError(403, 'setup_locked', 'Setup is locked until the server has an ADMIN_TOKEN (the setup code)');
  if (!code) throw new ApiError(403, 'setup_code_required', 'Enter the setup code', [{ path: ['setupCode'], code: 'custom', message: 'errors.required' }]);
  if (!sameSecret(code, adminToken)) {
    throw new ApiError(403, 'invalid_setup_code', 'That setup code is not right', [{ path: ['setupCode'], code: 'custom', message: 'errors.wrongSetupCode' }]);
  }
}

/**
 * First run: create the first account, holding the CEO position. Refused once any staff account
 * exists, and on Cloudflare without the setup code.
 */
router.post('/setup', async (c) => {
  const input = await body(c, setupInput);
  if (staffCount(c) > 0) throw new ApiError(409, 'already_set_up', 'This school is already set up');
  checkSetupCode(c, input.setupCode);
  const passwordHash = await hashPassword(input.password);
  const db = c.get('db');
  const created = db.transaction((tx) => {
    // Re-check inside the transaction: two setup requests must not both win.
    const n = tx.select({ n: count() }).from(users).get()?.n ?? 0;
    if (n > 0) return null;
    const user = tx
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash, locale: input.locale ?? 'en', lastLoginAt: Date.now() })
      .returning()
      .get();
    ensureBuiltInPositions(tx);
    const ceo = tx.select({ id: positions.id }).from(positions).where(eq(positions.key, FIRST_OWNER_POSITION)).get()!;
    tx.insert(userPositions).values({ userId: user.id, positionId: ceo.id }).run();
    return user;
  });
  if (!created) throw new ApiError(409, 'already_set_up', 'This school is already set up');
  saveSettings(db, {
    schoolName: input.schoolName,
    ...(input.schoolNameAr ? { schoolNameAr: input.schoolNameAr } : {}),
    ...(input.locale ? { defaultLocale: input.locale } : {}),
  });
  startSession(c, created.id);
  return c.json({ user: toSessionUser(db, created) }, 201);
});

router.patch('/profile', requireAuth, async (c) => {
  const input = await body(c, profileInput);
  const me = currentUser(c);
  const db = c.get('db');
  const updated = db.update(users).set(input).where(eq(users.id, me.id)).returning().get();
  return c.json({ user: toSessionUser(db, updated!) });
});

/**
 * Your own profile photo: an image you uploaded in the last hour (POST
 * /api/files), or null to remove it. The old photo's file is deleted when
 * nothing else uses it. Answers { user } like PATCH /profile.
 */
router.put('/photo', requireAuth, async (c) => {
  const input = await body(c, photoInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const previous = db.transaction((tx) => {
    const row = tx.select({ photoFileId: users.photoFileId }).from(users).where(eq(users.id, me.id)).get();
    const old = row?.photoFileId ?? null;
    if (input.fileId === old) return null;
    if (input.fileId) {
      claimUploads(tx, me.id, [input.fileId], { now, maxAgeMs: FRESH_UPLOAD_MS, path: ['fileId'], message: TEAM_ERROR_KEYS.photoNotYours, imagesOnly: true });
    }
    tx.update(users).set({ photoFileId: input.fileId }).where(eq(users.id, me.id)).run();
    return old;
  });
  await releaseFile(db, c.get('files'), previous);
  const updated = db.select().from(users).where(eq(users.id, me.id)).get()!;
  return c.json({ user: toSessionUser(db, updated) });
});

router.post('/password', requireAuth, async (c) => {
  const input = await body(c, changePasswordInput);
  const me = currentUser(c);
  const db = c.get('db');
  const row = db.select().from(users).where(eq(users.id, me.id)).get();
  if (!row || !(await verifyPassword(input.currentPassword, row.passwordHash))) {
    throw new ApiError(400, 'validation', 'Current password is incorrect', [
      { path: ['currentPassword'], code: 'custom', message: 'errors.wrongPassword' },
    ]);
  }
  const passwordHash = await hashPassword(input.newPassword);
  const sid = c.get('sessionId');
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash }).where(eq(users.id, me.id)).run();
    // Sign out every other device (and stop their notifications).
    if (sid) signOutUser(tx, me.id, sid);
  });
  return c.json({ ok: true });
});

export default router;
