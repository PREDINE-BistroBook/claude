import type { ChatMessage, ChatPreview } from '@shared/schemas/chat';

/** How often an open conversation asks for new messages while the app is visible. */
export const CONVERSATION_POLL_MS = 4_000;

/**
 * Add messages to what's on screen: by id, a newer copy replaces the old one
 * (e.g. deleted since), always oldest first. Polls and "show earlier" both
 * go through here, so a message is never shown twice.
 */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return current as ChatMessage[];
  const byId = new Map<number, ChatMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * The `after` cursor of the 4-second poll: the newest id the server has
 * answered with, moved forward by each answer (`received`). Never moved by my
 * own message put on screen right after sending: its id may be newer than a
 * message the other person sent a moment before, which the next poll must
 * still fetch.
 */
export function advanceCursor(cursor: number | null, received: readonly ChatMessage[]): number | null {
  let next = cursor;
  for (const m of received) if (next === null || m.id > next) next = m.id;
  return next;
}

/** The oldest message id on screen (the `before` cursor of "Show earlier messages"). */
export function firstMessageId(messages: readonly ChatMessage[]): number | null {
  return messages.length ? messages[0]!.id : null;
}

/** "YYYY-MM-DD" of an epoch on this device's calendar. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Messages in runs by day (for the date separators), oldest first. */
export function groupByDay(messages: readonly ChatMessage[]): { day: string; items: ChatMessage[] }[] {
  const groups: { day: string; items: ChatMessage[] }[] = [];
  for (const m of messages) {
    const day = localDay(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  return groups;
}

/** Whether an epoch is today, yesterday or earlier on this device's calendar. */
export function dayKind(ms: number, now: number = Date.now()): 'today' | 'yesterday' | 'older' {
  const day = localDay(ms);
  if (day === localDay(now)) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return day === localDay(y.getTime()) ? 'yesterday' : 'older';
}

/**
 * The receipt under my newest message: "Seen" once the other person has read
 * up to it, else "Sent". Null when my newest message isn't the conversation's
 * newest (their reply already says they saw it) or there's none.
 */
export function receipt(
  messages: readonly ChatMessage[],
  otherLastReadMessageId: number | null,
): { messageId: number; status: 'seen' | 'sent' } | null {
  const last = messages[messages.length - 1];
  if (!last || !last.mine || last.deleted) return null;
  return { messageId: last.id, status: otherLastReadMessageId !== null && otherLastReadMessageId >= last.id ? 'seen' : 'sent' };
}

/**
 * The message to report as read (POST /read), or null: the newest message
 * from the other person, when it's newer than what I last reported.
 */
export function messageToMarkRead(messages: readonly ChatMessage[], myLastReadMessageId: number | null): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.mine) continue;
    return myLastReadMessageId === null || m.id > myLastReadMessageId ? m.id : null;
  }
  return null;
}

export type PreviewParts =
  | { kind: 'deleted' }
  | { kind: 'text'; text: string }
  | { kind: 'photos'; count: number }
  | { kind: 'files'; count: number }
  | { kind: 'none' };

/** What a conversation row shows for its last message. */
export function previewParts(p: ChatPreview | null): PreviewParts {
  if (!p) return { kind: 'none' };
  if (p.deleted) return { kind: 'deleted' };
  if (p.text) return { kind: 'text', text: p.text };
  if (p.photos) return { kind: 'photos', count: p.photos };
  if (p.documents) return { kind: 'files', count: p.documents };
  return { kind: 'none' };
}

/** The conversation id in "/messages/12", else null. */
export function conversationIdFromPath(pathname: string): number | null {
  const m = /^\/messages\/(\d+)\/?$/.exec(pathname);
  return m ? Number(m[1]) : null;
}
