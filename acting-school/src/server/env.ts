import type { SessionUser } from '../shared/schemas/auth';
import type { AppConfig } from './config';
import type { DB } from './db/database';
import type { FileStore } from './lib/fileStore';

/** Hono context variables available in every route: c.get('db'), c.get('user'), c.get('config'), c.get('files'), c.get('clientIp'), c.get('waitUntil'), c.get('outboundFetch'). */
export type AppEnv = {
  Variables: {
    db: DB;
    config: AppConfig;
    /** Where uploaded file bytes live (lib/fileStore.ts). */
    files: FileStore;
    /** null when not signed in (only reachable on public routes). */
    user: SessionUser | null;
    /** sha256 id of the current auth session row. */
    sessionId: string | null;
    /** The client's IP address when the runtime knows it (AppDeps.clientIp), for the sign-in brakes; else null. */
    clientIp: string | null;
    /** Keep background work (push notifications) going after the response (AppDeps.waitUntil). */
    waitUntil: (task: Promise<unknown>) => void;
    /** fetch for calls to other servers (push services); AppDeps.outboundFetch, tests pass a fake. */
    outboundFetch: typeof fetch;
  };
};
