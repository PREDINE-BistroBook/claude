import { and, count, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { FIRST_OWNER_POSITION } from '../../shared/permissions';
import { changePasswordInput, loginInput, profileInput, setupInput, type MeResponse } from '../../shared/schemas/auth';
import { authSessions, positions, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { ensureBuiltInPositions, toSessionUser } from '../lib/access';
import { ApiError } from '../lib/errors';
import { getDummyHash, hashPassword, verifyPassword } from '../lib/password';
import { getSettings, saveSettings } from '../lib/settings';
import { body } from '../lib/validate';
import { currentUser, endSession, requireAuth, startSession } from '../middleware/auth';

const router = new Hono<AppEnv>();

// ── Brute-force brake: 10 failed sign-ins per email per 15 minutes. ─────────
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failures = new Map<string, { count: number; first: number }>();
function tooManyFailures(email: string): boolean {
  const f = failures.get(email);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW) {
    failures.delete(email);
    return false;
  }
  return f.count >= MAX_FAILS;
}
function recordFailure(email: string) {
  const f = failures.get(email);
  if (!f || Date.now() - f.first > WINDOW) failures.set(email, { count: 1, first: Date.now() });
  else f.count++;
}

function staffCount(c: { get: (k: 'db') => AppEnv['Variables']['db'] }): number {
  return c.get('db').select({ n: count() }).from(users).get()?.n ?? 0;
}

/** Who am I? Public: answers { user: null } when signed out, plus whether first-run setup is needed. */
router.get('/me', (c) => {
  const db = c.get('db');
  const res: MeResponse = {
    user: c.get('user'),
    needsSetup: staffCount(c) === 0,
    schoolName: getSettings(db).schoolName,
  };
  return c.json(res);
});

router.post('/login', async (c) => {
  const input = await body(c, loginInput);
  if (tooManyFailures(input.email)) throw new ApiError(429, 'too_many_attempts', 'Too many attempts. Try again in a few minutes.');
  const db = c.get('db');
  const user = db.select().from(users).where(eq(users.email, input.email)).get();
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok || !user.active) {
    recordFailure(input.email);
    throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  failures.delete(input.email);
  db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
  startSession(c, user.id);
  return c.json({ user: toSessionUser(db, user) });
});

router.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/** First run: create the first account, holding the CEO position. Refused once any staff account exists. */
router.post('/setup', async (c) => {
  const input = await body(c, setupInput);
  if (staffCount(c) > 0) throw new ApiError(409, 'already_set_up', 'This school is already set up');
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
  saveSettings(db, { schoolName: input.schoolName, ...(input.locale ? { defaultLocale: input.locale } : {}) });
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
  db.update(users).set({ passwordHash }).where(eq(users.id, me.id)).run();
  // Sign out every other device.
  const sid = c.get('sessionId');
  if (sid) db.delete(authSessions).where(and(eq(authSessions.userId, me.id), ne(authSessions.id, sid))).run();
  return c.json({ ok: true });
});

export default router;
