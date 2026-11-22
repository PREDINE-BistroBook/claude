import type { SessionUser } from '../shared/schemas/auth';
import type { AppConfig } from './config';
import type { DB } from './db/client';

/** Hono context variables available in every route: c.get('db'), c.get('user'), c.get('config'). */
export type AppEnv = {
  Variables: {
    db: DB;
    config: AppConfig;
    /** null when not signed in (only reachable on public routes). */
    user: SessionUser | null;
    /** sha256 id of the current auth session row. */
    sessionId: string | null;
  };
};
