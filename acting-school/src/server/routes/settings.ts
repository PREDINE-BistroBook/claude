import { Hono } from 'hono';
import { settingsInput, type AppSettings } from '../../shared/schemas/settings';
import type { AppEnv } from '../env';
import { getSettings, saveSettings } from '../lib/settings';
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

router.patch('/', requirePermission('settings.manage'), async (c) => {
  const input = await body(c, settingsInput);
  const res: AppSettings = saveSettings(c.get('db'), input);
  return c.json(res);
});

export default router;
