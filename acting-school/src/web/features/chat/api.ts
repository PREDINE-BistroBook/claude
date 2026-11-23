import { useMutation, useQuery } from '@tanstack/react-query';
import type { ChatMessage, ChatMessagesResponse, ConversationDetail, ConversationSummary, SendMessageInput } from '@shared/schemas/chat';
import type { ListResponse } from '@shared/schemas/common';
import { api, qs } from '@web/lib/api';
import { teamKeys } from '../team/api';

export const chatKeys = {
  all: ['chat'] as const,
  conversations: teamKeys.conversations,
  conversation: (id: number) => ['chat', 'conversation', id] as const,
};

/** GET /api/chat/conversations — mine with at least one message, newest first. */
export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn: () => api.get<ListResponse<ConversationSummary>>('/chat/conversations'),
    staleTime: 5_000,
  });
}

/** GET /api/chat/conversations/:id (404 for anyone who isn't one of its two members). */
export function useConversation(id: number, enabled = true) {
  return useQuery({
    queryKey: chatKeys.conversation(id),
    queryFn: () => api.get<ConversationDetail>(`/chat/conversations/${id}`),
    enabled,
  });
}

/** GET …/messages: no cursor = the newest page; `before` = older; `after` = newer (the poll). Oldest first. */
export function fetchMessages(id: number, cursor: { before?: number; after?: number; limit?: number } = {}) {
  return api.get<ChatMessagesResponse>(`/chat/conversations/${id}/messages${qs(cursor)}`);
}

export function useSendMessage(conversationId: number) {
  return useMutation({
    mutationFn: (data: SendMessageInput) => api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, data),
  });
}

export function useDeleteMessage() {
  return useMutation({ mutationFn: (messageId: number) => api.delete(`/chat/messages/${messageId}`) });
}

/** POST …/read: everything up to this message has been seen (also clears that conversation's bell item). */
export function markConversationRead(conversationId: number, messageId: number) {
  return api.post<void>(`/chat/conversations/${conversationId}/read`, { messageId });
}
