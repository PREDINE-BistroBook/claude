import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SummonsAnswer } from '@shared/enums';
import type { ChatUnreadResponse, ConversationDetail } from '@shared/schemas/chat';
import type { ListResponse } from '@shared/schemas/common';
import type { RecordFile } from '@shared/schemas/files';
import type { NotificationsReadInput, NotificationsReadResponse, NotificationsResponse, PushConfig } from '@shared/schemas/notifications';
import type { SummonsView } from '@shared/schemas/summons';
import type { TeamMember } from '@shared/schemas/team';
import { api, ApiError, qs } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';

/**
 * Query keys of the Team pack. ['team'] is the directory every screen uses to
 * find a colleague's photo and buttons; ['chat', 'unread'] is the one 20-second
 * poll behind the Messages badge, the bell and the call-to-the-office banner.
 */
export const teamKeys = {
  team: ['team'] as const,
  unread: ['chat', 'unread'] as const,
  conversations: ['chat', 'conversations'] as const,
  notifications: ['notifications'] as const,
  summonsSent: ['summons', 'sent'] as const,
  pushConfig: ['push', 'config'] as const,
  files: (resource: 'courses' | 'castings', id: number) => [resource, id, 'files'] as const,
};

/** How often the unread poll runs while the app is visible (it stops while the tab is hidden). */
export const UNREAD_POLL_MS = 20_000;

/** GET /api/team — active staff, owners as name + photo. Cached for every screen that shows a colleague. */
export function useTeam(enabled = true) {
  return useQuery({
    queryKey: teamKeys.team,
    queryFn: () => api.get<ListResponse<TeamMember>>('/team'),
    staleTime: 60_000,
    enabled,
  });
}

/** A colleague from the Team directory, or undefined (not loaded yet, inactive, unknown). */
export function useTeamMember(userId: number | null | undefined): TeamMember | undefined {
  const team = useTeam(userId !== null && userId !== undefined);
  if (userId === null || userId === undefined) return undefined;
  return team.data?.items.find((m) => m.id === userId);
}

/** A colleague's photo id from the Team directory (inactive people aren't in it: initials then). */
export function usePersonPhoto(userId: number | null | undefined): string | null {
  return useTeamMember(userId)?.photoFileId ?? null;
}

/**
 * GET /api/chat/unread every 20 s while the app is visible. TanStack pauses the
 * interval while the tab is hidden (refetchIntervalInBackground is off) and
 * reads again as soon as it is visible.
 */
export function useUnread(enabled = true) {
  return useQuery({
    queryKey: teamKeys.unread,
    queryFn: () => api.get<ChatUnreadResponse>('/chat/unread'),
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    enabled,
  });
}

/** POST /api/chat/conversations: open (or start) the chat with a colleague. */
export function useOpenConversation() {
  return useMutation({
    mutationFn: (userId: number) => api.post<ConversationDetail>('/chat/conversations', { userId }),
  });
}

/** POST /api/summons (staff.summon). */
export function useSummon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId: number; note?: string | null }) => api.post<SummonsView>('/summons', data),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: teamKeys.team }), qc.invalidateQueries({ queryKey: ['summons'] })]),
  });
}

/** POST /api/summons/:id/cancel (the caller). */
export function useCancelSummons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<SummonsView>(`/summons/${id}/cancel`),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: teamKeys.team }), qc.invalidateQueries({ queryKey: ['summons'] })]),
  });
}

/** POST /api/summons/:id/answer (the person called). */
export function useAnswerSummons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: SummonsAnswer }) => api.post<SummonsView>(`/summons/${id}/answer`, { status }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: teamKeys.unread }),
        qc.invalidateQueries({ queryKey: teamKeys.notifications }),
        qc.invalidateQueries({ queryKey: ['summons'] }),
      ]),
  });
}

/** GET /api/summons/:id — one call, for its caller or the person called (what became of it). */
export function useSummonsById(id: number | null, enabled = true) {
  return useQuery({
    queryKey: ['summons', id],
    queryFn: () => api.get<SummonsView>(`/summons/${id}`),
    enabled: enabled && id !== null,
    retry: false,
  });
}

/** GET /api/notifications (the bell's sheet). */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: teamKeys.notifications,
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    enabled,
    staleTime: 5_000,
  });
}

/** POST /api/notifications/read. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: NotificationsReadInput) => api.post<NotificationsReadResponse>('/notifications/read', data),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: teamKeys.unread }), qc.invalidateQueries({ queryKey: teamKeys.notifications })]),
  });
}

/**
 * GET /api/push/config: the VAPID public key (null = push is off on this
 * server), my device count, and whether this browser's subscription
 * (`endpoint`) is mine in this sign-in. Waits until the browser has said
 * whether it has a subscription (`endpoint` undefined = not known yet).
 */
export function usePushConfig(endpoint: string | null | undefined) {
  return useQuery({
    queryKey: [...teamKeys.pushConfig, endpoint ?? null],
    queryFn: () => api.get<PushConfig>(`/push/config${qs({ endpoint })}`),
    staleTime: 60_000,
    enabled: endpoint !== undefined,
  });
}

/** A workshop's "Photos & files" or a casting's "Files". */
export function useRecordFiles(resource: 'courses' | 'castings', id: number) {
  return useQuery({
    queryKey: teamKeys.files(resource, id),
    queryFn: () => api.get<ListResponse<RecordFile>>(`/${resource}/${id}/files`),
  });
}

/** Message keys for the Team pack's errors (falls back to the generic ones). */
export function teamErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const issue = err.issues?.find((i) => /^[a-z]+:errors\./i.test(i.message));
    if (issue) return issue.message;
    switch (err.code) {
      case 'cannot_summon_self':
        return 'team:errors.cannotSummonSelf';
      case 'already_pending':
        return 'team:summon.alreadyPending';
      case 'too_many_summons':
        return 'team:summon.tooMany';
      case 'not_pending':
        return 'team:summon.notPending';
      case 'cannot_message_self':
        return 'chat:errors.cannotMessageSelf';
      case 'recipient_inactive':
        return 'chat:errors.recipientInactive';
      case 'too_many_messages':
        return 'chat:errors.tooManyMessages';
      case 'delete_window_over':
        return 'chat:errors.deleteWindowOver';
      case 'too_many_tests':
        return 'team:push.tooManyTests';
      case 'push_off':
        return 'team:push.offServer';
    }
  }
  return errorMessageKey(err);
}
