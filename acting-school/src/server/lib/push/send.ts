/**
 * Sending Web Push messages to people's phones/browsers (push_subscriptions):
 * each message encrypted for the subscription (encrypt.ts, RFC 8291) and
 * signed for the push service (vapid.ts, RFC 8292), POSTed with the runtime's
 * fetch. Runs after the request's database transaction, in the background
 * (queuePush in index.ts). A 404/410 answer deletes the subscription (the
 * browser dropped it); other failures are counted and the subscription is
 * dropped after 10 in a row; a success resets the count. Only subscriptions
 * whose sign-in session (push_subscriptions.session_id) is still valid are
 * sent to.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PushPayload } from '../../../shared/schemas/notifications';
import type { DB } from '../../db/database';
import { authSessions, pushSubscriptions, users } from '../../db/schema';
import { inChunks } from '../sqlLimits';
import { encryptPushMessage } from './encrypt';
import { b64urlDecode, isUncompressedP256, type VapidKeys } from './keys';
import { vapidAuthorization } from './vapid';

/** Largest payload sent (JSON bytes); longer texts are shortened. */
export const MAX_PUSH_PAYLOAD_BYTES = 3 * 1024;
/** Failures in a row after which a subscription is dropped. */
export const MAX_PUSH_FAILURES = 10;

export interface PushOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl: number;
  /** 'high' wakes the phone at once (a summons); 'normal' for messages. */
  urgency: 'normal' | 'high';
  /** A newer message with the same topic replaces one still waiting at the push service (≤ 32 base64url characters). */
  topic?: string;
}

export interface PushDeps {
  db: DB;
  fetch: typeof fetch;
  vapid: VapidKeys;
  /** VAPID subject: "mailto:…" or "https://…". */
  subject: string;
  now?: () => number;
}

export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
}

const enc = new TextEncoder();

/** The payload as JSON, the body shortened until it fits MAX_PUSH_PAYLOAD_BYTES. */
export function encodePayload(payload: PushPayload): Uint8Array {
  let p = payload;
  let bytes = enc.encode(JSON.stringify(p));
  while (bytes.length > MAX_PUSH_PAYLOAD_BYTES && (p.body.length > 0 || p.title.length > 20)) {
    p = p.body.length > 0 ? { ...p, body: [...p.body].slice(0, Math.floor(p.body.length / 2)).join('') } : { ...p, title: [...p.title].slice(0, 20).join('') };
    bytes = enc.encode(JSON.stringify(p));
  }
  return bytes;
}

/**
 * Hosts of the browsers' push services. Subscriptions pointing anywhere else
 * are refused (POST /api/push/subscribe), so the server never POSTs to an
 * address a user made up (an internal one, say).
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'fcm.googleapis.com' ||
    host === 'android.googleapis.com' ||
    host === 'push.services.mozilla.com' ||
    host.endsWith('.push.services.mozilla.com') ||
    host.endsWith('.notify.windows.com') ||
    host === 'web.push.apple.com' ||
    host.endsWith('.push.apple.com')
  );
}

type Subscription = typeof pushSubscriptions.$inferSelect;

async function sendOne(deps: PushDeps, sub: Subscription, plaintext: Uint8Array, opts: PushOptions): Promise<'sent' | 'removed' | 'failed'> {
  const now = deps.now?.() ?? Date.now();
  const { db } = deps;
  const p256dh = b64urlDecode(sub.p256dh);
  const auth = b64urlDecode(sub.auth);
  if (!isUncompressedP256(p256dh) || auth?.length !== 16 || !isPushServiceEndpoint(sub.endpoint)) {
    // Can't be sent to (stored before a rule tightened): nothing will ever change that.
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
    return 'removed';
  }
  let status = 0;
  try {
    const body = await encryptPushMessage(plaintext, p256dh, auth);
    const headers: Record<string, string> = {
      TTL: String(opts.ttl),
      Urgency: opts.urgency,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuthorization(deps.vapid, sub.endpoint, deps.subject, now),
    };
    if (opts.topic) headers.Topic = opts.topic;
    const res = await deps.fetch(sub.endpoint, { method: 'POST', headers, body });
    status = res.status;
    // Free the connection; the answer's body says nothing we use.
    await res.body?.cancel().catch(() => {});
  } catch (err) {
    console.error('Push to a subscription failed', err instanceof Error ? err.message : err);
  }
  if (status >= 200 && status < 300) {
    db.update(pushSubscriptions).set({ lastSuccessAt: now, failures: 0 }).where(eq(pushSubscriptions.id, sub.id)).run();
    return 'sent';
  }
  if (status === 404 || status === 410 || sub.failures + 1 >= MAX_PUSH_FAILURES) {
    db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
    return 'removed';
  }
  db.update(pushSubscriptions)
    .set({ failures: sql`${pushSubscriptions.failures} + 1` })
    .where(eq(pushSubscriptions.id, sub.id))
    .run();
  return 'failed';
}

/** Send `payload` to every subscription of these people. Never throws for one bad subscription. */
export async function sendPushToUsers(deps: PushDeps, userIds: readonly number[], payload: PushPayload, opts: PushOptions): Promise<PushResult> {
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };
  const ids = [...new Set(userIds)];
  if (!ids.length) return result;
  const now = deps.now?.() ?? Date.now();
  // Only subscriptions whose sign-in session is still valid: a phone that signed out (or whose
  // session ended or expired) gets nothing, even if its row is still there.
  const subs = inChunks(ids, (part) =>
    deps.db
      .select({ sub: pushSubscriptions })
      .from(pushSubscriptions)
      .innerJoin(authSessions, and(eq(authSessions.id, pushSubscriptions.sessionId), eq(authSessions.userId, pushSubscriptions.userId)))
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(and(inArray(pushSubscriptions.userId, part), gt(authSessions.expiresAt, now), eq(users.active, true)))
      .all()
      .map((r) => r.sub),
  );
  if (!subs.length) return result;
  const plaintext = encodePayload(payload);
  const outcomes = await Promise.all(subs.map((s) => sendOne(deps, s, plaintext, opts)));
  for (const o of outcomes) result[o]++;
  return result;
}
