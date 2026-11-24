import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CastingApplicationStatus } from '@shared/enums';
import type {
  AcceptCastingApplicationResult,
  CastingApplicationCounts,
  CastingApplicationDetail,
  CastingApplicationListItem,
  CastingApplicationUpdateInput,
} from '@shared/schemas/castingApplications';
import type { ListResponse } from '@shared/schemas/common';
import { api, qs } from '@web/lib/api';

export interface ApplicationFilters {
  status?: CastingApplicationStatus;
  q?: string;
}

/** Everything about casting applications starts with 'casting-applications' (the menu's count badge too). */
export const applicationKeys = {
  all: ['casting-applications'] as const,
  list: (filters: ApplicationFilters) => ['casting-applications', 'list', filters] as const,
  counts: ['casting-applications', 'counts'] as const,
  detail: (id: number) => ['casting-applications', id] as const,
};

export function useApplications(filters: ApplicationFilters) {
  return useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => api.get<ListResponse<CastingApplicationListItem>>(`/casting-applications${qs({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** Numbers per status (the tabs, and the count of new ones in the Casting menu). */
export function useApplicationCounts(enabled = true) {
  return useQuery({
    queryKey: applicationKeys.counts,
    queryFn: () => api.get<CastingApplicationCounts>('/casting-applications/counts'),
    enabled,
    staleTime: 60_000,
  });
}

export function useApplication(id: number, enabled = true) {
  return useQuery({
    queryKey: applicationKeys.detail(id),
    queryFn: () => api.get<CastingApplicationDetail>(`/casting-applications/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/** The counts also show on the Casting and Website homes. */
function invalidateRelated(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: applicationKeys.all });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
  void qc.invalidateQueries({ queryKey: ['site'] });
}

/** Mark as reviewing, decline, or move back to new. */
export function useSetApplicationStatus(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: CastingApplicationUpdateInput['status']) => api.patch<CastingApplicationDetail>(`/casting-applications/${id}`, { status }),
    onSuccess: (saved) => {
      qc.setQueryData(applicationKeys.detail(id), saved);
      invalidateRelated(qc);
    },
  });
}

/** "Add to roster": creates the talent profile (with the photos) and answers its id. */
export function useAcceptApplication(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AcceptCastingApplicationResult>(`/casting-applications/${id}/accept`),
    onSuccess: () => {
      invalidateRelated(qc);
      void qc.invalidateQueries({ queryKey: ['talent'] });
    },
  });
}

export function useDeleteApplication(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/casting-applications/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: applicationKeys.detail(id) });
      invalidateRelated(qc);
    },
  });
}
