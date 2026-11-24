/**
 * Web Push for the team pack (G5): a new message to the other member, a
 * summons to the person called, a summons answer to the caller. Free (the
 * browsers' own push services), no Node-only crypto (it runs in the Durable
 * Object). Off without the VAPID keys (AppConfig.vapid) — the in-app bell
 * works either way.
 *
 * Routes call queuePush *after* their transaction: the sending runs in the
 * background (AppDeps.waitUntil — the Durable Object's ctx.waitUntil on
 * Cloudflare; on Node and in tests a promise whose errors are logged) and
 * never delays or fails the request.
 */
import type { Context } from 'hono';
import type { PushPayload } from '../../../shared/schemas/notifications';
import type { DB } from '../../db/database';
import type { AppEnv } from '../../env';
import { getSiteContent } from '../siteContent';
import { sendPushToUsers, type PushOptions } from './send';

/** Used as the VAPID subject when the website has no contact email. */
export const DEFAULT_PUSH_SUBJECT = 'https://turquoisestudio.app';

/** The VAPID subject: the studio's email from the website settings (mailto:), else its site address. */
export function pushSubject(db: Pick<DB, 'select'>): string {
  const email = getSiteContent(db).email;
  return email ? `mailto:${email}` : DEFAULT_PUSH_SUBJECT;
}

/** Push to these people's devices in the background, if push is set up. */
export function queuePush(c: Context<AppEnv>, userIds: readonly number[], payload: PushPayload, opts: PushOptions): void {
  const vapid = c.get('config').vapid;
  if (!vapid || !userIds.length) return;
  const db = c.get('db');
  const task = sendPushToUsers({ db, fetch: c.get('outboundFetch'), vapid, subject: pushSubject(db) }, userIds, payload, opts).catch((err) => {
    console.error('Push notifications failed', err instanceof Error ? err.message : err);
  });
  c.get('waitUntil')(task);
}

export { isPushServiceEndpoint, sendPushToUsers, type PushOptions } from './send';
