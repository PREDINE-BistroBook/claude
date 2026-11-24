import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@shared/schemas/chat';
import { teamKeys } from '../team/api';
import { fetchMessages, markConversationRead } from './api';
import { advanceCursor, CONVERSATION_POLL_MS, firstMessageId, mergeMessages, messageToMarkRead } from './utils';

/** Whether the page is visible (not a background tab, not a locked phone). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

interface State {
  items: ChatMessage[];
  /** Older messages exist before the first one on screen. */
  hasEarlier: boolean;
  otherLastReadMessageId: number | null;
  loaded: boolean;
  error: unknown;
}

/**
 * The messages of one open conversation: the newest page first, "show
 * earlier" (`before`), and every 4 seconds while the page is visible the new
 * ones (`after` the newest the server has answered with) — polling stops while the tab is hidden
 * and catches up as soon as it's visible again. New messages from the other
 * person are reported read (POST /read) while the page is visible.
 */
export function useConversationMessages(conversationId: number, myLastReadMessageId: number | null) {
  const qc = useQueryClient();
  const visible = usePageVisible();
  const [state, setState] = useState<State>({ items: [], hasEarlier: false, otherLastReadMessageId: null, loaded: false, error: null });
  const itemsRef = useRef<ChatMessage[]>([]);
  // What the server has answered up to (the poll's `after`): not the newest on screen, which may be
  // my own message just sent, newer than one the other person sent a second before.
  const cursor = useRef<number | null>(null);
  const busy = useRef(false);
  const lastRead = useRef<number | null>(myLastReadMessageId);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const apply = useCallback((incoming: ChatMessage[], patch: Partial<State> = {}) => {
    const items = mergeMessages(itemsRef.current, incoming);
    itemsRef.current = items;
    setState((s) => {
      const same = items === s.items && (Object.keys(patch) as (keyof State)[]).every((k) => s[k] === patch[k]);
      return same ? s : { ...s, ...patch, items };
    });
  }, []);

  // The newest page.
  useEffect(() => {
    let cancelled = false;
    itemsRef.current = [];
    cursor.current = null;
    lastRead.current = myLastReadMessageId;
    setState({ items: [], hasEarlier: false, otherLastReadMessageId: null, loaded: false, error: null });
    fetchMessages(conversationId)
      .then((res) => {
        if (cancelled) return;
        itemsRef.current = mergeMessages(itemsRef.current, res.items);
        cursor.current = advanceCursor(cursor.current, res.items);
        setState({ items: itemsRef.current, hasEarlier: res.hasMore, otherLastReadMessageId: res.otherLastReadMessageId, loaded: true, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, error }));
      });
    return () => {
      cancelled = true;
    };
    // myLastReadMessageId is only the starting point (later reads are tracked here), so it isn't a dependency.
  }, [conversationId]);

  /** Fetch what's new since the server's last answer (several pages if many arrived). */
  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let page = 0; page < 5; page++) {
        const after = cursor.current;
        const res = await fetchMessages(conversationId, after === null ? {} : { after });
        apply(res.items, { otherLastReadMessageId: res.otherLastReadMessageId });
        cursor.current = advanceCursor(cursor.current, res.items);
        if (!res.hasMore || after === null) break;
      }
    } catch {
      // A missed poll is fine: the next one catches up.
    } finally {
      busy.current = false;
    }
  }, [conversationId, apply]);

  // Every 4 seconds while visible; at once when the page becomes visible again.
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!state.loaded) return;
    if (!visible) {
      wasHidden.current = true;
      return;
    }
    if (wasHidden.current) {
      wasHidden.current = false;
      void poll();
    }
    const timer = window.setInterval(() => void poll(), CONVERSATION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [state.loaded, visible, poll]);

  // Report new messages from the other person as read (only while someone is looking).
  useEffect(() => {
    if (!visible || !state.loaded) return;
    const target = messageToMarkRead(state.items, lastRead.current);
    if (target === null) return;
    lastRead.current = target;
    markConversationRead(conversationId, target)
      .then(() =>
        Promise.all([qc.invalidateQueries({ queryKey: teamKeys.unread }), qc.invalidateQueries({ queryKey: teamKeys.conversations })]),
      )
      .catch(() => {
        lastRead.current = null;
      });
  }, [state.items, state.loaded, visible, conversationId, qc]);

  const loadEarlier = useCallback(async () => {
    const before = firstMessageId(itemsRef.current);
    if (before === null) return;
    setLoadingEarlier(true);
    try {
      const res = await fetchMessages(conversationId, { before });
      apply(res.items, { hasEarlier: res.hasMore });
    } finally {
      setLoadingEarlier(false);
    }
  }, [conversationId, apply]);

  /** Put a message on screen at once (my own, just sent; or one changed, e.g. deleted). */
  const upsert = useCallback((m: ChatMessage) => apply([m]), [apply]);

  return { ...state, loadingEarlier, loadEarlier, upsert, poll };
}
