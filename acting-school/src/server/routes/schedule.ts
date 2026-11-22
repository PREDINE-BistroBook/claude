import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/auth';

/** TODO(schedule): not built yet. */
const router = new Hono<AppEnv>();
router.use(requireAuth);

export default router;
