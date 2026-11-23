import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  CASTING_APPLICATION_ERROR_CODES,
  castingApplicationListQuery,
  castingApplicationUpdateInput,
  type AcceptCastingApplicationResult,
  type CastingApplicationCounts,
  type CastingApplicationListItem,
} from '../../shared/schemas/castingApplications';
import type { ListResponse } from '../../shared/schemas/common';
import { castingApplications } from '../db/schema';
import type { AppEnv } from '../env';
import {
  acceptApplication,
  applicationCounts,
  applicationSearch,
  deleteApplication,
  findApplication,
  loadApplicationDetail,
  loadApplicationListItems,
} from '../lib/castingApplications';
import { schoolToday } from '../lib/clock';
import { ApiError } from '../lib/errors';
import { getSettings } from '../lib/settings';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Casting applications from the website's casting call (Casting ›
 * Applications). talent.read lists and opens them; phone, email, guardian
 * phone and links need talent.contact (null otherwise, contactHidden: true);
 * talent.write marks them new / reviewing / declined, accepts them ("Add to
 * roster": a talent profile with the same photos, once — 409 after) and
 * deletes them (with their photo files, unless a talent profile uses them).
 * Created only by the public form (lib/castingApplications.ts createCastingApplication).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('talent.read');
const canWrite = requirePermission('talent.write');

router.get('/', canRead, (c) => {
  const q = query(c, castingApplicationListQuery);
  const db = c.get('db');
  const where = and(
    q.status ? eq(castingApplications.status, q.status) : undefined,
    q.q ? applicationSearch(q.q, getSettings(db).defaultCountryCode) : undefined,
  );
  return c.json<ListResponse<CastingApplicationListItem>>({ items: loadApplicationListItems(db, where, schoolToday(c)) });
});

router.get('/counts', canRead, (c) => c.json<CastingApplicationCounts>(applicationCounts(c.get('db'))));

router.get('/:id', canRead, (c) => c.json(loadApplicationDetail(c.get('db'), paramId(c), currentUser(c), schoolToday(c))));

router.patch('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const input = await body(c, castingApplicationUpdateInput);
  const db = c.get('db');
  db.transaction((tx) => {
    const app = findApplication(tx, id);
    if (app.status === 'accepted') throw new ApiError(409, CASTING_APPLICATION_ERROR_CODES.alreadyAccepted, 'This application is already on the roster');
    if (app.status === input.status) return;
    // Back to new = not looked at yet; reviewing / declined record who decided and when.
    const reviewed = input.status === 'new' ? { reviewedById: null, reviewedAt: null } : { reviewedById: me.id, reviewedAt: Date.now() };
    tx.update(castingApplications).set({ status: input.status, ...reviewed }).where(eq(castingApplications.id, id)).run();
  });
  return c.json(loadApplicationDetail(db, id, me, schoolToday(c)));
});

router.post('/:id/accept', canWrite, (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const today = schoolToday(c);
  const talentId = c.get('db').transaction((tx) => acceptApplication(tx, id, me.id, today));
  return c.json<AcceptCastingApplicationResult>({ talentId }, 201);
});

router.delete('/:id', canWrite, async (c) => {
  await deleteApplication(c.get('db'), c.get('files'), paramId(c));
  return c.body(null, 204);
});

export default router;
