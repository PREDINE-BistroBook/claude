import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CastingStatus } from '@shared/enums';
import type { CastingDetail, CastingListItem, CastingRole, Submission } from '@shared/schemas/castings';
import type { ListResponse } from '@shared/schemas/common';
import type { TalentListItem } from '@shared/schemas/talent';
import { ApiError, api, qs } from '@web/lib/api';
import { errorMessageKey } from '@web/lib/forms';

/** Query keys: everything about castings starts with 'castings' so one invalidation refreshes it all. */
export const castingKeys = {
  all: ['castings'] as const,
  list: (filters: { q?: string; status?: CastingStatus }) => ['castings', 'list', filters] as const,
  detail: (id: number) => ['castings', id] as const,
};

export function useCastings(filters: { q?: string; status?: CastingStatus }, enabled = true) {
  return useQuery({
    queryKey: castingKeys.list(filters),
    queryFn: () => api.get<ListResponse<CastingListItem>>(`/castings${qs(filters)}`),
    enabled,
    // Keep the previous rows on screen while a new search loads.
    placeholderData: keepPreviousData,
  });
}

export function useCasting(id: number, enabled = true) {
  return useQuery({
    queryKey: castingKeys.detail(id),
    queryFn: () => api.get<CastingDetail>(`/castings/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/**
 * Refresh castings and everything that shows casting data elsewhere: talent
 * profiles list their submissions, the schedule and dashboard show auditions
 * and closing deadlines.
 */
export function useInvalidateCastings() {
  const qc = useQueryClient();
  return async (opts: { talent?: boolean } = {}) => {
    const keys = ['schedule', 'dashboard', ...(opts.talent ? ['talent'] : [])];
    for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
    await qc.invalidateQueries({ queryKey: castingKeys.all });
  };
}

/** Create (no id) or update (id) a casting. */
export function useSaveCasting(id?: number) {
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: (data: unknown) => (id ? api.patch<CastingDetail>(`/castings/${id}`, data) : api.post<CastingDetail>('/castings', data)),
    onSuccess: () => invalidate({ talent: !!id }),
  });
}

export function useDeleteCasting(id: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: () => api.delete(`/castings/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: castingKeys.detail(id) });
      void invalidate({ talent: true });
    },
  });
}

/** Create (no roleId) or update a role of a casting. */
export function useSaveRole(castingId: number, roleId?: number) {
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: (data: unknown) =>
      roleId ? api.patch<CastingRole>(`/castings/${castingId}/roles/${roleId}`, data) : api.post<CastingRole>(`/castings/${castingId}/roles`, data),
    onSuccess: () => invalidate({ talent: !!roleId }),
  });
}

export function useDeleteRole(castingId: number) {
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: (roleId: number) => api.delete(`/castings/${castingId}/roles/${roleId}`),
    onSuccess: () => invalidate({ talent: true }),
  });
}

export function useUpdateSubmission(id: number) {
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: (data: unknown) => api.patch<Submission>(`/submissions/${id}`, data),
    onSuccess: () => invalidate({ talent: true }),
  });
}

export function useDeleteSubmission(id: number) {
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: () => api.delete(`/submissions/${id}`),
    onSuccess: () => invalidate({ talent: true }),
  });
}

/** Put several talent forward for one role; resolves with who made it and who didn't. */
export function useAddSubmissions(roleId: number) {
  const invalidate = useInvalidateCastings();
  return useMutation({
    mutationFn: async (talentIds: number[]) => {
      const results = await Promise.allSettled(talentIds.map((talentId) => api.post<Submission>('/submissions', { roleId, talentId })));
      const added: number[] = [];
      const failed: { talentId: number; error: unknown }[] = [];
      results.forEach((r, i) => (r.status === 'fulfilled' ? added.push(talentIds[i]!) : failed.push({ talentId: talentIds[i]!, error: r.reason })));
      return { added, failed };
    },
    onSettled: () => invalidate({ talent: true }),
  });
}

/** Active roster for the "add talent" picker (GET /api/talent, owned by the talent module). */
export function useActiveTalent(q: string, enabled = true) {
  return useQuery({
    queryKey: ['talent', 'castingPicker', { q }] as const,
    queryFn: () => api.get<ListResponse<TalentListItem>>(`/talent${qs({ q, status: 'active' })}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Message key for a failed casting/submission request, with this module's own error codes. */
export function castingsErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.code === 'already_submitted') return 'castings:errors.alreadySubmitted';
  if (err instanceof ApiError && err.code === 'cannot_send') return 'castings:errors.cannotSend';
  if (err instanceof ApiError && err.code === 'validation' && err.issues?.length) {
    const own = err.issues.find((i) => /^castings:errors\./.test(i.message));
    if (own) return own.message;
  }
  return errorMessageKey(err);
}
