import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { startOfWeek } from '../../shared/dates';
import type { FileKind } from '../../shared/enums';
import {
  CHAT_ERROR_CODES,
  FRESH_UPLOAD_MS,
  MESSAGE_DELETE_WINDOW_MS,
  MESSAGES_PER_MINUTE,
  markReadInput,
  messagesQuery,
  openConversationInput,
  sendMessageInput,
  type ChatAttachment,
  type ChatMessage,
  type ChatMessagesResponse,
  type ChatPreview,
  type ChatUnreadResponse,
  type ConversationDetail,
  type ConversationSummary,
} from '../../shared/schemas/chat';
import type { ListResponse } from '../../shared/schemas/common';
import { TEAM_ERROR_KEYS } from '../../shared/schemas/team';
import type { DB } from '../db/database';
import { conversationMembers, conversations, files, messageAttachments, messages, notifications, users } from '../db/schema';
import type { AppEnv } from '../env';
import { cafeUnread, hiddenNotificationKinds } from '../lib/cafe';
import { epochAt, schoolToday } from '../lib/clock';
import { ApiError, fieldError, forbidden, notFound } from '../lib/errors';
import { claimUploads, deleteStoredFiles, takeUnusedFiles } from '../lib/fileRefs';
import { conversationLink, localeOf, markNotificationsRead, messagePreview, notificationText, notify, preview, unreadNotificationCount } from '../lib/notifications';
import { queuePush } from '../lib/push';
import { hitRateLimit, MINUTE_MS } from '../lib/rateLimit';
import { getSettings } from '../lib/settings';
import { inChunks } from '../lib/sqlLimits';
import { incomingSummons } from '../lib/summons';
import { findActivePerson, missingPerson, personColumns } from '../lib/team';
import { body, paramId, query } from '../lib/validate';
import { videoCounts } from '../lib/videos';
import { currentUser, requireAuth } from '../middleware/auth';

/**
 * Internal chat (G3), for every signed-in worker: direct one-to-one
 * conversations with any active colleague, owners included (as name and
 * photo — the documented exception to owner hiding). A conversation exists for
 * its two members only: anyone else gets a 404, whatever their permissions.
 * Attachments are the sender's own uploads from the last hour, not used
 * anywhere else; a sender can delete a message for 15 minutes (it shows as
 * deleted, its files are freed). A new message notifies the other member (one
 * notification per conversation, updated) and pushes to their phone after the
 * transaction. 60 messages a minute per person at most.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

/** The conversation and my membership row; 404 unless I'm a member. */
function requireMembership(db: DB, conversationId: number, userId: number) {
  const row = db
    .select({ id: conversations.id, lastReadMessageId: conversationMembers.lastReadMessageId })
    .from(conversations)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, userId)))
    .where(eq(conversations.id, conversationId))
    .get();
  if (!row) throw notFound('Conversation not found');
  return row;
}

/** The other member of a direct conversation, with their last-read message. */
function otherMember(db: DB, conversationId: number, userId: number) {
  const row = db
    .select({ ...personColumns, lastReadMessageId: conversationMembers.lastReadMessageId })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, userId)))
    .get();
  return row ?? null;
}

function conversationDetail(db: DB, conversationId: number, me: number): ConversationDetail {
  const mine = requireMembership(db, conversationId, me);
  const other = otherMember(db, conversationId, me);
  const { lastReadMessageId: otherLastRead, ...person } = other ?? { ...missingPerson(0), lastReadMessageId: null };
  return { id: conversationId, other: person, myLastReadMessageId: mine.lastReadMessageId, otherLastReadMessageId: otherLastRead };
}

/** Attachments of these messages (with file name, type and size), by message id. */
function attachmentsOf(db: DB, messageIds: readonly number[]): Map<number, ChatAttachment[]> {
  const rows = inChunks(messageIds, (part) =>
    db
      .select({ messageId: messageAttachments.messageId, fileId: messageAttachments.fileId, kind: messageAttachments.kind, name: files.originalName, mime: files.mime, size: files.size })
      .from(messageAttachments)
      .innerJoin(files, eq(files.id, messageAttachments.fileId))
      .where(inArray(messageAttachments.messageId, part))
      .orderBy(asc(messageAttachments.id))
      .all(),
  );
  const out = new Map<number, ChatAttachment[]>();
  for (const { messageId, ...a } of rows) {
    const list = out.get(messageId) ?? [];
    list.push(a);
    out.set(messageId, list);
  }
  return out;
}

type MessageRow = typeof messages.$inferSelect;

function toChatMessages(db: DB, rows: readonly MessageRow[], me: number, now: number): ChatMessage[] {
  const attachments = attachmentsOf(
    db,
    rows.filter((r) => !r.deletedAt).map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    senderId: r.senderId,
    mine: r.senderId === me,
    body: r.deletedAt ? null : r.body,
    attachments: r.deletedAt ? [] : (attachments.get(r.id) ?? []),
    createdAt: r.createdAt,
    deleted: !!r.deletedAt,
    canDelete: r.senderId === me && !r.deletedAt && now - r.createdAt < MESSAGE_DELETE_WINDOW_MS,
  }));
}

/** Unread messages from others: per conversation of mine (or one conversation). */
function unreadCounts(db: DB, me: number, conversationId?: number): Map<number, number> {
  const rows = db
    .select({ conversationId: messages.conversationId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(messages)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, me)))
    .where(
      and(
        ne(messages.senderId, me),
        isNull(messages.deletedAt),
        sql`${messages.id} > coalesce(${conversationMembers.lastReadMessageId}, 0)`,
        conversationId === undefined ? undefined : eq(messages.conversationId, conversationId),
      ),
    )
    .groupBy(messages.conversationId)
    .all();
  return new Map(rows.map((r) => [r.conversationId, r.n]));
}

// ── Conversations ───────────────────────────────────────────────────────────

/** Mine, newest first, with the other person, the last message and the unread count. Only conversations with a message. */
router.get('/conversations', (c) => {
  const db = c.get('db');
  const me = currentUser(c).id;
  const mine = db
    .select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, me)))
    .where(isNotNull(conversations.lastMessageAt))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(300)
    .all();
  // Subqueries over my memberships: no IN list that grows with the data.
  const myConversations = db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, me));
  const others = db
    .select({ conversationId: conversationMembers.conversationId, ...personColumns })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(inArray(conversationMembers.conversationId, myConversations), ne(conversationMembers.userId, me)))
    .all();
  const otherBy = new Map(others.map(({ conversationId, ...p }) => [conversationId, p]));
  const lastIds = db
    .select({ id: sql<number>`max(${messages.id})`.as('last_id') })
    .from(messages)
    .where(inArray(messages.conversationId, myConversations))
    .groupBy(messages.conversationId);
  const lastRows = db.select().from(messages).where(inArray(messages.id, lastIds)).all();
  const lastBy = new Map(lastRows.map((m) => [m.conversationId, m]));
  const kinds = db
    .select({ messageId: messageAttachments.messageId, kind: messageAttachments.kind, n: sql<number>`count(*)`.mapWith(Number) })
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, lastIds))
    .groupBy(messageAttachments.messageId, messageAttachments.kind)
    .all();
  const unread = unreadCounts(db, me);

  const items: ConversationSummary[] = mine.map((conv) => {
    const last = lastBy.get(conv.id);
    const count = (kind: FileKind) => kinds.find((k) => k.messageId === last?.id && k.kind === kind)?.n ?? 0;
    const lastMessage: ChatPreview | null = last
      ? {
          id: last.id,
          senderId: last.senderId,
          mine: last.senderId === me,
          text: last.deletedAt || !last.body ? null : preview(last.body),
          photos: last.deletedAt ? 0 : count('photo'),
          documents: last.deletedAt ? 0 : count('document'),
          deleted: !!last.deletedAt,
          createdAt: last.createdAt,
        }
      : null;
    return { id: conv.id, other: otherBy.get(conv.id) ?? missingPerson(0), lastMessage, unread: unread.get(conv.id) ?? 0, lastMessageAt: conv.lastMessageAt };
  });
  return c.json<ListResponse<ConversationSummary>>({ items });
});

/** Open the direct chat with a colleague (any active staff member, owners included): 200 if it existed, 201 if created. */
router.post('/conversations', async (c) => {
  const input = await body(c, openConversationInput);
  const me = currentUser(c).id;
  if (input.userId === me) {
    throw new ApiError(400, CHAT_ERROR_CODES.cannotMessageSelf, 'You can’t message yourself', [{ path: ['userId'], code: 'custom', message: 'chat:errors.cannotMessageSelf' }]);
  }
  const db = c.get('db');
  if (!findActivePerson(db, input.userId)) throw notFound('Staff member not found');
  const key = pairKey(me, input.userId);
  const { id, created } = db.transaction((tx) => {
    const existing = tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.pairKey, key)).get();
    if (existing) return { id: existing.id, created: false };
    const conv = tx.insert(conversations).values({ pairKey: key }).returning({ id: conversations.id }).get();
    tx.insert(conversationMembers)
      .values([
        { conversationId: conv.id, userId: me },
        { conversationId: conv.id, userId: input.userId },
      ])
      .run();
    return { id: conv.id, created: true };
  });
  return c.json(conversationDetail(db, id, me), created ? 201 : 200);
});

router.get('/conversations/:id', (c) => {
  return c.json(conversationDetail(c.get('db'), paramId(c), currentUser(c).id));
});

/** Paged, oldest first: the newest page, `before` (older) or `after` (newer — the open conversation's poll). */
router.get('/conversations/:id/messages', (c) => {
  const db = c.get('db');
  const me = currentUser(c).id;
  const id = paramId(c);
  requireMembership(db, id, me);
  const q = query(c, messagesQuery);
  if (q.after !== undefined && q.before !== undefined) throw fieldError(['after'], 'chat:errors.oneCursor');
  const limit = q.limit ?? 50;
  let rows: MessageRow[];
  if (q.after !== undefined) {
    rows = db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), gt(messages.id, q.after)))
      .orderBy(asc(messages.id))
      .limit(limit + 1)
      .all();
  } else {
    rows = db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), q.before !== undefined ? lt(messages.id, q.before) : undefined))
      .orderBy(desc(messages.id))
      .limit(limit + 1)
      .all();
  }
  const hasMore = rows.length > limit;
  rows = rows.slice(0, limit);
  if (q.after === undefined) rows.reverse();
  const res: ChatMessagesResponse = {
    items: toChatMessages(db, rows, me, Date.now()),
    hasMore,
    otherLastReadMessageId: otherMember(db, id, me)?.lastReadMessageId ?? null,
  };
  return c.json(res);
});

/** Send text and/or attachments. 201 with the message. */
router.post('/conversations/:id/messages', async (c) => {
  const db = c.get('db');
  const me = currentUser(c);
  const id = paramId(c);
  requireMembership(db, id, me.id);
  const input = await body(c, sendMessageInput);
  const other = otherMember(db, id, me.id);
  if (!other?.active) throw new ApiError(409, CHAT_ERROR_CODES.recipientInactive, 'This person’s account is no longer active');
  const now = Date.now();
  if (hitRateLimit(db, `chat:user:${me.id}`, MESSAGES_PER_MINUTE, MINUTE_MS, now)) {
    throw new ApiError(429, CHAT_ERROR_CODES.tooManyMessages, 'Too many messages. Wait a minute and try again.');
  }
  const locale = localeOf(db, other.id);
  const { message, previewText } = db.transaction((tx) => {
    const claimed = claimUploads(tx, me.id, input.fileIds ?? [], { now, maxAgeMs: FRESH_UPLOAD_MS, path: ['fileIds'], message: TEAM_ERROR_KEYS.fileNotYours });
    const message = tx
      .insert(messages)
      .values({ conversationId: id, senderId: me.id, body: input.body ?? null, createdAt: now })
      .returning()
      .get();
    if (claimed.length) tx.insert(messageAttachments).values(claimed.map((f) => ({ messageId: message.id, fileId: f.id, kind: f.kind }))).run();
    tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, id)).run();
    // My own message counts as seen by me — and so does everything before it, the bell included
    // (a reply means I've seen the chat: "New message from …" mustn't stay unread).
    tx.update(conversationMembers)
      .set({ lastReadMessageId: message.id })
      .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me.id)))
      .run();
    markNotificationsRead(tx, me.id, 'message', conversationLink(id), now);
    const previewText = messagePreview(
      locale,
      message.body,
      claimed.map((f) => f.kind),
    );
    notify(tx, { userId: other.id, kind: 'message', title: notificationText(locale, 'messageTitle', { name: me.name }), body: previewText, link: conversationLink(id) }, now, { replace: true });
    return { message, previewText };
  });
  queuePush(
    c,
    [other.id],
    { title: notificationText(locale, 'messageTitle', { name: me.name }), body: previewText, link: conversationLink(id), kind: 'message', tag: `conversation-${id}` },
    { ttl: 24 * 60 * 60, urgency: 'normal', topic: `conversation-${id}` },
  );
  return c.json(toChatMessages(db, [message], me.id, now)[0]!, 201);
});

/** Everything up to `messageId` has been seen (never moves back). Also marks this conversation's notification read. 204. */
router.post('/conversations/:id/read', async (c) => {
  const db = c.get('db');
  const me = currentUser(c).id;
  const id = paramId(c);
  const mine = requireMembership(db, id, me);
  const input = await body(c, markReadInput);
  const msg = db.select({ id: messages.id }).from(messages).where(and(eq(messages.id, input.messageId), eq(messages.conversationId, id))).get();
  if (!msg) throw fieldError(['messageId'], 'chat:errors.messageNotFound');
  const now = Date.now();
  db.transaction((tx) => {
    if ((mine.lastReadMessageId ?? 0) < msg.id) {
      tx.update(conversationMembers)
        .set({ lastReadMessageId: msg.id })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me)))
        .run();
    }
    markNotificationsRead(tx, me, 'message', conversationLink(id), now);
  });
  return c.body(null, 204);
});

// ── Messages ────────────────────────────────────────────────────────────────

/** The sender deletes a message within 15 minutes: it shows as deleted; its attachments' files are freed. 204. */
router.delete('/messages/:id', async (c) => {
  const db = c.get('db');
  const me = currentUser(c).id;
  const id = paramId(c);
  const msg = db.select().from(messages).where(eq(messages.id, id)).get();
  if (!msg) throw notFound('Message not found');
  requireMembership(db, msg.conversationId, me);
  if (msg.senderId !== me) throw forbidden('Only the sender can delete a message');
  if (msg.deletedAt) return c.body(null, 204);
  const now = Date.now();
  if (now - msg.createdAt >= MESSAGE_DELETE_WINDOW_MS) {
    throw new ApiError(409, CHAT_ERROR_CODES.deleteWindowOver, 'A message can only be deleted in the first 15 minutes');
  }
  const other = otherMember(db, msg.conversationId, me);
  const keys = db.transaction((tx) => {
    tx.update(messages).set({ deletedAt: now, body: null }).where(eq(messages.id, id)).run();
    const fileIds = tx
      .select({ fileId: messageAttachments.fileId })
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, id))
      .all()
      .map((r) => r.fileId);
    tx.delete(messageAttachments).where(eq(messageAttachments.messageId, id)).run();
    // If the other person's notification shows this message, it shouldn't any more.
    const newest = tx.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, msg.conversationId)).orderBy(desc(messages.id)).limit(1).get();
    if (other && newest?.id === id) {
      tx.update(notifications)
        .set({ body: notificationText(localeOf(tx, other.id), 'messageDeleted') })
        .where(and(eq(notifications.userId, other.id), eq(notifications.kind, 'message'), eq(notifications.link, conversationLink(msg.conversationId))))
        .run();
    }
    return takeUnusedFiles(tx, fileIds);
  });
  await deleteStoredFiles(c.get('files'), keys);
  return c.body(null, 204);
});

// ── The badge poll ──────────────────────────────────────────────────────────

/** The Messages badge, the bell's count, the summonses waiting for me, the cafeteria (on or off, orders waiting) and the video pipeline's counts — one poll every 20 s. */
router.get('/unread', (c) => {
  const db = c.get('db');
  const user = currentUser(c);
  const me = user.id;
  const total = [...unreadCounts(db, me).values()].reduce((a, b) => a + b, 0);
  const today = schoolToday(c);
  const res: ChatUnreadResponse = {
    total,
    notifications: unreadNotificationCount(db, me, Date.now(), hiddenNotificationKinds(db, user)),
    summons: incomingSummons(db, me, Date.now()),
    cafe: cafeUnread(db, user),
    // "This week" at the school: since midnight (its time zone) on the first day of its week.
    videos: videoCounts(db, user, today, () => epochAt(c.get('config').timeZone, startOfWeek(today, getSettings(db).weekStartsOn))),
  };
  return c.json(res);
});

export default router;
