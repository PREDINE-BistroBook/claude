import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse } from '@shared/schemas/common';
import { VIDEO_ERROR_CODES, type Video, type VideoCounts, type VideoDetail, type VideoEvent, type VideoInput, type VideoStepResult, type VideoUpdateInput } from '@shared/schemas/videos';
import { api, ApiError, qs } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';
import { teamKeys, useUnread } from '../team/api';

/** Query keys: everything starts with 'videos', so one invalidation refreshes every list and page. */
export const videoKeys = {
  all: ['videos'] as const,
  list: (filter: { mine?: boolean; sessionId?: number; courseId?: number }) => ['videos', 'list', filter] as const,
  one: (id: number) => ['videos', id] as const,
};

/** How often the queue and an open video page are read again while on screen. */
export const VIDEOS_REFRESH_MS = 30_000;

/** GET /api/videos — the queue (all I may see, or only mine), a session's or a workshop's. */
export function useVideos(filter: { mine?: boolean; sessionId?: number; courseId?: number }, enabled = true) {
  return useQuery({
    queryKey: videoKeys.list(filter),
    queryFn: () => api.get<ListResponse<Video>>(`/videos${qs({ mine: filter.mine ? 1 : undefined, sessionId: filter.sessionId, courseId: filter.courseId })}`),
    enabled,
    refetchInterval: VIDEOS_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** GET /api/videos/:id — the video with its history. */
export function useVideo(id: number) {
  return useQuery({
    queryKey: videoKeys.one(id),
    queryFn: () => api.get<VideoDetail>(`/videos/${id}`),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: VIDEOS_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

/** The video pipeline's counts from the 20-second poll (null without any videos permission; undefined until it answers). */
export function useVideoCounts(): VideoCounts | null | undefined {
  return useUnread().data?.videos;
}

/** After any change: the videos, and the poll behind the badges and the bell. */
function useRefreshVideos() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: videoKeys.all }), qc.invalidateQueries({ queryKey: teamKeys.unread }), qc.invalidateQueries({ queryKey: teamKeys.notifications })]);
}

/** Every write on videos. A refused move (409) refreshes too: the video has moved on. */
export function useVideoActions() {
  const refresh = useRefreshVideos();
  const qc = useQueryClient();
  /**
   * Answers with the video: put it straight into its page's cache, and into
   * every list that holds it — the card shows its new state at once (the
   * queue keeps it in place for a moment: utils.QUEUE_MOVE_REST_MS).
   */
  const store = (answer: VideoDetail | VideoStepResult) => {
    const { told: _told, ...v } = answer as VideoStepResult;
    qc.setQueryData(videoKeys.one(v.id), v);
    const { events: _events, ...row } = v;
    qc.setQueriesData<ListResponse<Video>>({ queryKey: [...videoKeys.all, 'list'] }, (old) =>
      old?.items.some((x) => x.id === row.id) ? { ...old, items: old.items.map((x) => (x.id === row.id ? row : x)) } : old,
    );
  };
  const opts = { onSettled: refresh };
  return {
    add: useMutation({
      mutationFn: (data: VideoInput) => api.post<VideoStepResult>('/videos', data),
      onSuccess: store,
      ...opts,
    }),
    update: useMutation({
      mutationFn: ({ id, ...data }: VideoUpdateInput & { id: number }) => api.patch<VideoDetail>(`/videos/${id}`, data),
      onSuccess: store,
      ...opts,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.delete(`/videos/${id}`),
      ...opts,
    }),
    take: useMutation({
      mutationFn: (id: number) => api.post<VideoStepResult>(`/videos/${id}/take`),
      onSuccess: store,
      ...opts,
    }),
    submit: useMutation({
      mutationFn: ({ id, editedLink, notes }: { id: number; editedLink: string; notes: string | null }) =>
        api.post<VideoStepResult>(`/videos/${id}/submit`, {
          editedLink,
          notes,
        }),
      onSuccess: store,
      ...opts,
    }),
    approve: useMutation({
      mutationFn: (id: number) => api.post<VideoStepResult>(`/videos/${id}/approve`),
      onSuccess: store,
      ...opts,
    }),
    requestChanges: useMutation({
      mutationFn: ({ id, note }: { id: number; note: string }) => api.post<VideoStepResult>(`/videos/${id}/request-changes`, { note }),
      onSuccess: store,
      ...opts,
    }),
    reopen: useMutation({
      mutationFn: ({ id, note }: { id: number; note: string }) => api.post<VideoStepResult>(`/videos/${id}/reopen`, { note }),
      onSuccess: store,
      ...opts,
    }),
    comment: useMutation({
      mutationFn: ({ id, note }: { id: number; note: string }) => api.post<VideoEvent>(`/videos/${id}/comments`, { note }),
      ...opts,
    }),
  };
}

/** The video as it is now, when a move was refused because it had moved on (409 video_moved / video_locked). */
export function movedVideo(err: unknown): VideoDetail | null {
  if (err instanceof ApiError && (err.code === VIDEO_ERROR_CODES.moved || err.code === VIDEO_ERROR_CODES.locked)) {
    const details = err.details as { video?: VideoDetail } | undefined;
    return details?.video ?? null;
  }
  return null;
}

/** Message keys for the videos' errors (falls back to the generic ones). */
export function videoErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const issue = err.issues?.find((i) => /^[a-z]+:errors\./i.test(i.message));
    if (issue) return issue.message;
    switch (err.code) {
      case VIDEO_ERROR_CODES.moved:
        return 'videos:toasts.moved';
      case VIDEO_ERROR_CODES.locked:
        return 'videos:errors.locked';
      case VIDEO_ERROR_CODES.notYourEdit:
        return 'videos:errors.notYourEdit';
      case VIDEO_ERROR_CODES.ownEdit:
        return 'videos:errors.ownEdit';
    }
  }
  return errorMessageKey(err);
}
