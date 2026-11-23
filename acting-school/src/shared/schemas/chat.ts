import { z } from 'zod';
import type { FileKind } from '../enums';
import type { CafeUnread } from './cafe';
import { id } from './common';
import type { SummonsView } from './summons';
import type { PersonRef } from './team';

/**
 * Internal chat (/api/chat, every signed-in worker): direct, one-to-one
 * conversations. Everyone can message everyone who is active, owners included
 * (name and photo only). A conversation is visible to its two members only;
 * anyone else gets a 404.
 */

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGE_ATTACHMENTS = 5;
/** Messages per person per minute (429 too_many_messages beyond). */
export const MESSAGES_PER_MINUTE = 60;
/** A message can be deleted by its sender for this long (15 minutes). */
export const MESSAGE_DELETE_WINDOW_MS = 15 * 60 * 1000;
/** An attachment must have been uploaded by the sender within this long (1 hour). */
export const FRESH_UPLOAD_MS = 60 * 60 * 1000;
/** Characters of a message shown in previews (conversation list, notifications, push). */
export const MESSAGE_PREVIEW_LENGTH = 100;
/** Most messages one GET /messages answers (default 50). */
export const MAX_MESSAGES_PAGE = 100;

/** POST /api/chat/conversations: open (or create) the direct chat with this colleague. */
export const openConversationInput = z.object({ userId: id });
export type OpenConversationInput = z.infer<typeof openConversationInput>;

/**
 * POST /api/chat/conversations/:id/messages: text, attachments, or both (at
 * least one). Attachments: up to 5 files the sender uploaded (POST /api/files)
 * in the last hour that aren't attached anywhere else.
 */
export const sendMessageInput = z
  .object({
    body: z.preprocess((v) => (typeof v === 'string' ? v.trim() || null : v), z.string().max(MAX_MESSAGE_LENGTH).nullable().optional()),
    fileIds: z.array(z.uuid()).max(MAX_MESSAGE_ATTACHMENTS).optional(),
  })
  .refine((v) => !!v.body || !!v.fileIds?.length, { message: 'chat:errors.emptyMessage', path: ['body'] });
export type SendMessageInput = z.infer<typeof sendMessageInput>;

/** POST /api/chat/conversations/:id/read: everything up to this message has been seen. */
export const markReadInput = z.object({ messageId: id });
export type MarkReadInput = z.infer<typeof markReadInput>;

/**
 * GET /api/chat/conversations/:id/messages query. No cursor: the newest
 * `limit` messages. `before`: older ones (scrolling up). `after`: newer ones
 * (the 4-second poll of an open conversation). Always oldest first.
 */
export const messagesQuery = z.object({
  after: id.optional(),
  before: id.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_MESSAGES_PAGE).optional(),
});
export type MessagesQuery = z.infer<typeof messagesQuery>;

export interface ChatAttachment {
  fileId: string;
  kind: FileKind;
  /** Original file name (documents download under it). */
  name: string | null;
  mime: string;
  size: number;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number;
  /** Sent by the caller (bubble on the end side). */
  mine: boolean;
  /** null when the message is only attachments, or deleted. */
  body: string | null;
  /** Empty once deleted. */
  attachments: ChatAttachment[];
  createdAt: number;
  /** Deleted by its sender: show "This message was deleted". */
  deleted: boolean;
  /** The caller may still delete it (their own, not deleted, under 15 minutes old). */
  canDelete: boolean;
}

/** The newest message of a conversation, for the list. */
export interface ChatPreview {
  id: number;
  senderId: number;
  mine: boolean;
  /** Up to 100 characters of the text; null when deleted or only attachments. */
  text: string | null;
  /** How many attachments of each kind (to show "📷 Photo" / "📎 File" when there's no text). */
  photos: number;
  documents: number;
  deleted: boolean;
  createdAt: number;
}

/** GET /api/chat/conversations → { items }: mine with at least one message, newest first. */
export interface ConversationSummary {
  id: number;
  /** The other member. */
  other: PersonRef;
  lastMessage: ChatPreview | null;
  /** Messages from the other person the caller hasn't seen. */
  unread: number;
  lastMessageAt: number | null;
}

/** POST /api/chat/conversations (200 when it existed, 201 when created) and GET /api/chat/conversations/:id. */
export interface ConversationDetail {
  id: number;
  other: PersonRef;
  /** The newest message id the caller has seen (null: none). */
  myLastReadMessageId: number | null;
  /** The newest message id the other person has seen: "Seen" under my messages up to it. */
  otherLastReadMessageId: number | null;
}

/** GET /api/chat/conversations/:id/messages. */
export interface ChatMessagesResponse {
  /** Oldest first. */
  items: ChatMessage[];
  /** More messages exist past this page: older ones (no cursor / `before`) or newer ones (`after`). */
  hasMore: boolean;
  /** For "Seen" (changes as the other person reads; the poll brings it). */
  otherLastReadMessageId: number | null;
}

/**
 * GET /api/chat/unread — the one poll (every 20 s while the app is visible)
 * behind the Messages badge, the bell's count, the "call to the office" banner
 * and the cafeteria (switched on or not; orders waiting on the board).
 */
export interface ChatUnreadResponse {
  /** Unread messages across all my conversations (the Messages badge). */
  total: number;
  /** Unread in-app notifications (the bell). */
  notifications: number;
  /** Summonses waiting for my answer (pending, not expired), newest first: the full-width banner. */
  summons: SummonsView[];
  /** The cafeteria: whether it is switched on, and the counts behind the orders board's badge. */
  cafe: CafeUnread;
}

/** Error codes (error.code) of the chat API besides the generic ones. */
export const CHAT_ERROR_CODES = {
  /** 400 — POST /conversations naming yourself. */
  cannotMessageSelf: 'cannot_message_self',
  /** 409 — the other member has been deactivated: the history stays readable, nothing new can be sent. */
  recipientInactive: 'recipient_inactive',
  /** 429 — over 60 messages in a minute. */
  tooManyMessages: 'too_many_messages',
  /** 409 — DELETE /messages/:id after 15 minutes. */
  deleteWindowOver: 'delete_window_over',
} as const;
