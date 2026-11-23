/**
 * The in-app notification bar (notifications table) and the texts of
 * notifications and push messages. The server writes these texts itself (a
 * push message has to arrive readable with the app closed), in the
 * recipient's language — their account's locale — so every string here is in
 * English and Arabic (NOTIFICATION_TEXT; Arabic is typed against English).
 * Arabic wording avoids gendered verbs: the names can be anyone's.
 */
import { and, count, eq, gt, inArray, isNull, lt, ne, notInArray, or } from 'drizzle-orm';
import { SUMMONS_EXPIRY_MS, type Locale, type NotificationKind, type SummonsAnswer } from '../../shared/enums';
import { MESSAGE_PREVIEW_LENGTH } from '../../shared/schemas/chat';
import type { NotificationItem } from '../../shared/schemas/notifications';
import type { DB } from '../db/database';
import { notifications, users } from '../db/schema';
import type { Conn } from './access';
import { chunk, IN_LIST_CHUNK } from './sqlLimits';

const en = {
  messageTitle: 'New message from {{name}}',
  photo: '📷 Photo',
  file: '📎 File',
  messageDeleted: 'This message was deleted',
  summonTitle: '{{name}} is calling you to the office',
  summonBody: 'Please come to the office.',
  answerOnMyWay: '{{name}}: On my way',
  answerCantNow: '{{name}}: Can’t come now',
  answerAbout: 'About: {{note}}',
  testTitle: 'Alerts are on',
  testBody: 'Messages and calls to the office will show up here.',
  // The cafeteria: a new order (to whoever serves), then what became of it (to whoever ordered).
  cafeNewOrderTitle: 'New order from {{name}}',
  cafeOrderBody: '{{items}} — to {{place}}',
  cafeOnTheWayTitle: 'Your order is on the way',
  cafeDeliveredTitle: 'Your order was delivered',
  cafeCancelledTitle: 'Sorry, your order can’t be made',
  cafeCancelledBody: 'Reason: {{reason}}',
  // To whoever serves, replacing "New order from …" once it no longer waits (quietly, on the phone).
  cafeOrderTakenTitle: 'Order from {{name}}: on the way',
  cafeOrderCancelledTitle: 'Order from {{name}}: cancelled',
};
const ar: Record<keyof typeof en, string> = {
  messageTitle: 'رسالة جديدة من {{name}}',
  photo: '📷 صورة',
  file: '📎 ملف',
  messageDeleted: 'تم حذف هذه الرسالة',
  summonTitle: 'طلب من {{name}}: الحضور إلى المكتب',
  summonBody: 'الرجاء الحضور إلى المكتب.',
  answerOnMyWay: '{{name}}: في الطريق',
  answerCantNow: '{{name}}: لا أستطيع الآن',
  answerAbout: 'بخصوص: {{note}}',
  testTitle: 'التنبيهات تعمل',
  testBody: 'ستظهر هنا الرسائل وطلبات الحضور إلى المكتب.',
  cafeNewOrderTitle: 'طلب جديد من {{name}}',
  cafeOrderBody: '{{items}} — إلى {{place}}',
  cafeOnTheWayTitle: 'طلبك في الطريق',
  cafeDeliveredTitle: 'تم توصيل طلبك',
  cafeCancelledTitle: 'عذرًا، تعذّر تنفيذ طلبك',
  cafeCancelledBody: 'السبب: {{reason}}',
  cafeOrderTakenTitle: 'طلب {{name}}: في الطريق',
  cafeOrderCancelledTitle: 'طلب {{name}}: أُلغي',
};

export const NOTIFICATION_TEXT: Record<Locale, typeof en> = { en, ar };
export type NotificationTextKey = keyof typeof en;

/** A text in `locale` with {{name}}-style values filled in. */
export function notificationText(locale: Locale, key: NotificationTextKey, values: Record<string, string> = {}): string {
  return NOTIFICATION_TEXT[locale][key].replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => values[k] ?? '');
}

/** At most `max` characters (by code point), with "…" when cut. */
export function preview(text: string, max = MESSAGE_PREVIEW_LENGTH): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** A message's preview in `locale`: the text, else "📷 Photo" / "📎 File". */
export function messagePreview(locale: Locale, body: string | null, kinds: readonly ('photo' | 'document')[]): string {
  if (body) return preview(body);
  if (kinds.includes('photo')) return notificationText(locale, 'photo');
  return notificationText(locale, 'file');
}

/** The account's language (texts written for them). */
export function localeOf(db: Pick<DB, 'select'>, userId: number): Locale {
  return db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).get()?.locale ?? 'en';
}

/** Notifications older than this are cleared away when new ones are written. */
export const NOTIFICATION_KEEP_MS = 60 * 24 * 60 * 60 * 1000;

export interface NewNotification {
  userId: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
}

/**
 * Write a notification (inside the request's transaction). With `replace`,
 * an existing one of the same kind and link for that person is updated and
 * moved to the top, unread again, instead of adding another (new messages:
 * one per conversation).
 */
export function notify(tx: Conn, n: NewNotification, now: number, opts: { replace?: boolean } = {}): void {
  tx.delete(notifications).where(and(eq(notifications.userId, n.userId), lt(notifications.createdAt, now - NOTIFICATION_KEEP_MS))).run();
  if (opts.replace) {
    const existing = tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, n.userId), eq(notifications.kind, n.kind), eq(notifications.link, n.link)))
      .get();
    if (existing) {
      tx.update(notifications).set({ title: n.title, body: n.body, createdAt: now, readAt: null }).where(eq(notifications.id, existing.id)).run();
      return;
    }
  }
  tx.insert(notifications).values({ ...n, createdAt: now }).run();
}

/** Mark a person's unread notifications of this kind and link as read (e.g. on opening the conversation). */
export function markNotificationsRead(tx: Conn, userId: number, kind: NotificationKind, link: string, now: number): void {
  tx.update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, kind), eq(notifications.link, link), isNull(notifications.readAt)))
    .run();
}

/**
 * Mark everyone's unread notifications of this kind and link as read: the
 * thing they point at is done with for all of them (a cafeteria order someone
 * has taken, or that was cancelled, leaves every server's bell).
 */
export function markNotificationsReadForEveryone(tx: Conn, kind: NotificationKind, link: string, now: number): void {
  tx.update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.kind, kind), eq(notifications.link, link), isNull(notifications.readAt)))
    .run();
}

/** Mark some of a person's notifications read (others' ids are ignored), or all of them. */
export function markRead(tx: Conn, userId: number, ids: readonly number[] | 'all', now: number): void {
  const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  if (ids === 'all') {
    tx.update(notifications).set({ readAt: now }).where(mine).run();
    return;
  }
  for (const part of chunk(ids, IN_LIST_CHUNK)) tx.update(notifications).set({ readAt: now }).where(and(mine, inArray(notifications.id, part))).run();
}

/**
 * Unread notifications of a person. A call to the office past its two hours
 * can't be answered any more, so its notification counts as read (it was
 * written in the same transaction as the call, with the same time). Kinds in
 * `hidden` don't count (and aren't listed): what the person can't open now —
 * new cafeteria orders once they no longer serve, or while the cafeteria is
 * switched off (`hiddenNotificationKinds` in lib/cafe.ts).
 */
export function unreadNotificationCount(db: Pick<DB, 'select'>, userId: number, now = Date.now(), hidden: readonly NotificationKind[] = []): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          or(ne(notifications.kind, 'summon'), gt(notifications.createdAt, now - SUMMONS_EXPIRY_MS)),
          hidden.length ? notInArray(notifications.kind, [...hidden]) : undefined,
        ),
      )
      .get()?.n ?? 0
  );
}

/** A row as GET /api/notifications answers it; an expired call to the office shows as read (from when it expired). */
export function toNotificationItem(r: typeof notifications.$inferSelect, now = Date.now()): NotificationItem {
  const expiredCall = r.kind === 'summon' && r.createdAt <= now - SUMMONS_EXPIRY_MS;
  const readAt = r.readAt ?? (expiredCall ? r.createdAt + SUMMONS_EXPIRY_MS : null);
  return { id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt, readAt };
}

// ── Links ───────────────────────────────────────────────────────────────────
// (The cafeteria's links are in lib/cafe.ts: cafeBoardLink, cafeOrderLink.)

export const conversationLink = (conversationId: number) => `/messages/${conversationId}`;
/** The caller's link to one call (its answer's notification): the Team page with that person's row and answer. */
export const summonsLink = (summonsId: number) => `/team?summons=${summonsId}`;
/**
 * The person called's link (the call's notification and push): the Team page
 * shows what became of the call (waiting, "You answered: On my way · 13:55",
 * cancelled, expired) and points at the caller's row.
 */
export const summonsInboxLink = (summonsId: number, callerId: number) => `/team?summons=${summonsId}&from=${callerId}`;

/** The text of a summons answer notification. */
export function answerTitle(locale: Locale, answer: SummonsAnswer, name: string): string {
  return notificationText(locale, answer === 'on_my_way' ? 'answerOnMyWay' : 'answerCantNow', { name });
}
