import { and, count, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import {
  AUTH_ERROR_CODES,
  changePasswordInput,
  choosePasswordInput,
  loginInput,
  profileInput,
  setupInput,
  signInNameOf,
  type MeResponse,
} from '../../shared/schemas/auth';
import { FRESH_UPLOAD_MS } from '../../shared/schemas/chat';
import { isRoleUsername } from '../../shared/usernames';
import { photoInput, TEAM_ERROR_KEYS } from '../../shared/schemas/team';
import { positions, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ensureBuiltInPositions, toSessionUser } from '../lib/access';
import { ApiError, fieldError } from '../lib/errors';
import { claimUploads, releaseFile } from '../lib/fileRefs';
import { getDummyHash, hashPassword, sameSecret, verifyPassword } from '../lib/password';
import { getSettings, saveSettings } from '../lib/settings';
import { clearSignInFailures, recordSignInFailure, signInBlocked } from '../lib/signInBrake';
import { emailDomainOf, findSignInAccount, newAccountNames, signInBrakeNames, usernameChange } from '../lib/usernames';
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

/**
 * Sign in with a username or an email address (one field: loginInput). The
 * same steps whether or not the name is anyone's — the lookup, the brakes, one
 * password hash (a dummy for nobody), one answer — so neither the response nor
 * its timing says which names exist.
 */
router.post('/login', async (c) => {
  const input = await body(c, loginInput);
  const typed = signInNameOf(input);
  if (typed === null) throw fieldError(['username'], 'errors.required');
  const db = c.get('db');
  const address = c.get('clientIp');
  // Whose name is it? One indexed read. The brakes are per account: an account's username and
  // its email address count together, and the other name that would lead to it is braked alike
  // whether or not the account exists (signInBrakeNames).
  const user = findSignInAccount(db, typed);
  const accounts = signInBrakeNames(user, typed, emailDomainOf(db));
  // Before hashing: a tripped brake costs a few small queries, a hash ~90 ms (lib/signInBrake.ts).
  if (signInBlocked(db, accounts, address)) throw new ApiError(429, 'too_many_attempts', 'Too many attempts. Try again in a few minutes.');
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok || !user.active) {
    recordSignInFailure(db, accounts, address);
    throw new ApiError(401, 'invalid_credentials', 'Username or password is incorrect');
  }
  clearSignInFailures(db, accounts, address);
  db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
  startSession(c, user.id);
  // With a temporary password the answer says so (user.mustChangePassword): the session opens only /api/auth.
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
    // The first account: the username typed, or one made from the email address. They chose this password themself.
    const names = newAccountNames(tx, { name: input.name, username: input.username, email: input.email }, emailDomainOf(tx));
    const user = tx
      .insert(users)
      .values({ ...names, name: input.name, passwordHash, locale: input.locale ?? 'en', lastLoginAt: Date.now() })
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

/**
 * Your own name, phone, language — and your own username: the same rules and
 * uniqueness check as when a manager sets it (409 `username_taken`, never
 * saying whose it is), and an email address that was the automatic one follows it.
 * A name that reads as a position (ceo, cfo, owner… — ROLE_USERNAMES) is a
 * manager's to give, not yours to take: 400 `errors.usernameForManagers`.
 */
router.patch('/profile', requireAuth, async (c) => {
  const { username, ...details } = await body(c, profileInput);
  const me = currentUser(c);
  const db = c.get('db');
  const updated = db.transaction((tx) => {
    const row = tx.select().from(users).where(eq(users.id, me.id)).get()!;
    if (username !== undefined && username !== row.username && isRoleUsername(username)) throw fieldError(['username'], 'errors.usernameForManagers');
    const patch = { ...details, ...(username === undefined ? {} : usernameChange(tx, row, username, emailDomainOf(tx))) };
    return Object.keys(patch).length ? tx.update(users).set(patch).where(eq(users.id, me.id)).returning().get()! : row;
  });
  return c.json({ user: toSessionUser(db, updated) });
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
  // Someone still on a temporary password may change it this way too — to their own, not to the same one again.
  // Checked against the stored hash, as choose-password does: a look-alike spelling ("ｓalma789") is the same
  // password to scrypt (lib/password.ts normalises every password), so comparing the strings is not enough.
  if (row.mustChangePassword && (await verifyPassword(input.newPassword, row.passwordHash))) throw sameAsTemporaryError();
  const passwordHash = await hashPassword(input.newPassword);
  const sid = c.get('sessionId');
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, me.id)).run();
    // Sign out every other device (and stop their notifications).
    if (sid) signOutUser(tx, me.id, sid);
  });
  return c.json({ ok: true });
});

const sameAsTemporaryError = () => fieldError(['newPassword'], 'errors.passwordSameAsTemporary');

/**
 * "Choose your own password": the one thing a session on a temporary password
 * can do (requireOwnPassword, middleware/auth.ts). No current password is asked
 * for — they signed in with it a moment ago, and the screen is two fields for
 * people who are not at home with computers. The new one meets the normal
 * policy and must not be the temporary one again. Then the flag is cleared and
 * the person's other sessions end. Answers { user } with mustChangePassword false.
 */
router.post('/choose-password', requireAuth, async (c) => {
  const input = await body(c, choosePasswordInput);
  const me = currentUser(c);
  const db = c.get('db');
  const row = db.select().from(users).where(eq(users.id, me.id)).get();
  if (!row?.mustChangePassword) {
    throw new ApiError(409, AUTH_ERROR_CODES.passwordChangeNotRequired, 'You already chose your own password. Change it in My profile.');
  }
  if (await verifyPassword(input.newPassword, row.passwordHash)) throw sameAsTemporaryError();
  const passwordHash = await hashPassword(input.newPassword);
  const sid = c.get('sessionId');
  const updated = db.transaction((tx) => {
    // Only if the temporary password is still the one this session signed in against (a manager may have reset it meanwhile).
    const user = tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(and(eq(users.id, me.id), eq(users.passwordHash, row.passwordHash), eq(users.mustChangePassword, true)))
      .returning()
      .get();
    // Sign out every other device (and stop their notifications).
    if (user && sid) signOutUser(tx, me.id, sid);
    return user;
  });
  if (!updated) throw new ApiError(409, 'conflict', 'Your password was changed meanwhile. Sign in again.');
  return c.json({ user: toSessionUser(db, updated) });
});

export default router;
