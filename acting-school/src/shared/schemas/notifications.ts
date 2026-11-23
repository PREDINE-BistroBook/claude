import { z } from 'zod';
import type { NotificationKind } from '../enums';
import { id } from './common';

/**
 * The in-app notification bar (the bell) and Web Push to the phone. Texts are
 * written in the recipient's language (their account's locale) when created.
 */

/** GET /api/notifications answers the newest this many. */
export const NOTIFICATIONS_PAGE = 50;

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  /** App path to open when tapped (e.g. "/messages/12", "/team"). */
  link: string;
  createdAt: number;
  readAt: number | null;
}

/** GET /api/notifications. */
export interface NotificationsResponse {
  /** Newest first (a message notification moves to the top when its conversation gets a new message). */
  items: NotificationItem[];
  /** All unread, not only those in `items`. */
  unread: number;
}

/** POST /api/notifications/read: some (`ids`, mine only; others are ignored) or `all`. Answers { unread }. */
export const notificationsReadInput = z.union([
  z.object({ ids: z.array(id).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);
export type NotificationsReadInput = z.infer<typeof notificationsReadInput>;

export interface NotificationsReadResponse {
  unread: number;
}

/**
 * What the service worker receives in a push message (JSON, ≤ 3 KB): shown as
 * a notification; tapping opens `link`. A summons has `requireInteraction`
 * and vibration; message notifications share a `tag` per conversation so a
 * new one replaces the last.
 */
export interface PushPayload {
  title: string;
  body: string;
  link: string;
  kind: NotificationKind | 'test';
  /** Notifications with the same tag replace each other ("conversation-12", "summons-3"). */
  tag: string;
}

/** GET /api/push/config?endpoint=. */
export interface PushConfig {
  /**
   * The server's VAPID public key (base64url) for pushManager.subscribe's
   * applicationServerKey; null when push isn't set up on this server (the
   * in-app bell still works).
   */
  publicKey: string | null;
  /** How many phones/browsers of mine receive push. */
  devices: number;
  /**
   * Whether the subscription named by `?endpoint=` (this browser's) is mine
   * and was turned on in this sign-in. False without `endpoint`, after
   * signing out and in again, or when it was someone else's on a shared
   * browser: Profile then offers "Turn on" again.
   */
  thisDevice: boolean;
}

/**
 * POST /api/push/subscribe: the browser's PushSubscription.toJSON() as is
 * ({ endpoint, expirationTime, keys: { p256dh, auth } }). Only real push
 * services' https addresses are accepted. Answers 201 { devices }.
 * DELETE /api/push/subscribe { endpoint } removes it (204).
 */
const b64url = (min: number, max: number) => z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(min).max(max);
export const pushSubscribeInput = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    /** 65 bytes → 87 base64url characters. */
    p256dh: b64url(80, 100),
    /** 16 bytes → 22 base64url characters. */
    auth: b64url(16, 30),
  }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeInput>;

export const pushUnsubscribeInput = z.object({ endpoint: z.string().max(1000) });
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeInput>;

export interface PushSubscribeResponse {
  devices: number;
}

/** POST /api/push/test: a test notification to every device of mine (at most 5 an hour). 202 { devices }; 409 push_off when push isn't set up. */
export interface PushTestResponse {
  devices: number;
}

/** Error codes (error.code) of the push API besides the generic ones. */
export const PUSH_ERROR_CODES = {
  /** 400 — the endpoint isn't a known push service, or the keys aren't a valid P-256 key / 16-byte secret. */
  invalidSubscription: 'invalid_subscription',
  /** 409 — the server has no VAPID keys: push is off (POST /api/push/subscribe, /test). */
  pushOff: 'push_off',
  /** 429 — too many test notifications. */
  tooManyTests: 'too_many_tests',
} as const;
