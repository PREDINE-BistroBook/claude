import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/auth';

/** TODO(castings): not built yet. */
const router = new Hono<AppEnv>();
router.use(requireAuth);

export default router;
