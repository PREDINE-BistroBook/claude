import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/auth';

/** TODO(students): not built yet. */
const router = new Hono<AppEnv>();
router.use(requireAuth);

export default router;
