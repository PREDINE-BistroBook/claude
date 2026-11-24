import { Hono } from 'hono';
import { settingsInput, type AppSettings } from '../../shared/schemas/settings';
import type { AppEnv } from '../env';
import { cafeSettings, cancelOpenCafeOrders, sendCafeAutoCancel } from '../lib/cafe';
import { getSettings, writeSettings } from '../lib/settings';
import { body } from '../lib/validate';
import { requireAuth, requirePermission } from '../middleware/auth';

/**
 * School-wide settings. Every signed-in person reads them (the schedule needs
 * the week start, forms need the default language); owners and admins change them.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

router.get('/', (c) => {
  const res: AppSettings = getSettings(c.get('db'));
  return c.json(res);
});

/**
 * Switching the cafeteria off (`cafeteriaEnabled` from on to off) also closes
 * what was still open, in the same transaction: every order still new or on
 * the way is cancelled with the reason "The cafeteria is closed now" — the
 * person who ordered is told, in their language — and the new-order alerts
 * leave every bell. Nothing is left waiting for whenever it is switched on again.
 */
router.patch('/', requirePermission('settings.manage'), async (c) => {
  const input = await body(c, settingsInput);
  const db = c.get('db');
  const now = Date.now();
  const closed = db.transaction((tx) => {
    const wasOn = cafeSettings(tx).enabled;
    writeSettings(tx, input);
    return wasOn && input.cafeteriaEnabled === false ? cancelOpenCafeOrders(tx, { reason: 'closed', tell: true }, now) : null;
  });
  if (closed) sendCafeAutoCancel(c, closed);
  const res: AppSettings = getSettings(db);
  return c.json(res);
});

export default router;
