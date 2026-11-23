import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { OpportunityStatus } from '@shared/enums';
import type { ListResponse } from '@shared/schemas/common';
import type { Opportunity, OpportunityCounts, OpportunityInput, OpportunityToCastingResult, OpportunityUpdateInput } from '@shared/schemas/opportunities';
import { api, qs } from '@web/lib/api';

export interface OpportunityFilters {
  status?: OpportunityStatus;
  q?: string;
}

/** Everything about opportunities starts with 'opportunities' (the menu's count badge too). */
export const opportunityKeys = {
  all: ['opportunities'] as const,
  list: (filters: OpportunityFilters) => ['opportunities', 'list', filters] as const,
  counts: ['opportunities', 'counts'] as const,
  detail: (id: number) => ['opportunities', id] as const,
};

export function useOpportunities(filters: OpportunityFilters) {
  return useQuery({
    queryKey: opportunityKeys.list(filters),
    queryFn: () => api.get<ListResponse<Opportunity>>(`/opportunities${qs({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

/** Numbers per status: the tabs, and the count of new ones on the Casting menu's entry. */
export function useOpportunityCounts(enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.counts,
    queryFn: () => api.get<OpportunityCounts>('/opportunities/counts'),
    enabled,
    staleTime: 60_000,
  });
}

export function useOpportunity(id: number, enabled = true) {
  return useQuery({
    queryKey: opportunityKeys.detail(id),
    queryFn: () => api.get<Opportunity>(`/opportunities/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/** The counts show on the Casting home too. */
function invalidateRelated(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: opportunityKeys.all });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
}

/** Add (no id) or edit (id) an opportunity. */
export function useSaveOpportunity(id?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OpportunityInput | OpportunityUpdateInput) =>
      id ? api.patch<Opportunity>(`/opportunities/${id}`, data) : api.post<Opportunity>('/opportunities', data),
    onSuccess: (saved) => {
      qc.setQueryData(opportunityKeys.detail(saved.id), saved);
      invalidateRelated(qc);
    },
  });
}

/** Interested / Applied / Not for us (or back to New). */
export function useMoveOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: OpportunityStatus }) => api.patch<Opportunity>(`/opportunities/${id}`, { status }),
    onSuccess: (saved) => {
      qc.setQueryData(opportunityKeys.detail(saved.id), saved);
      invalidateRelated(qc);
    },
  });
}

/** "Turn into a casting": answers the new casting's id. */
export function useTurnIntoCasting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<OpportunityToCastingResult>(`/opportunities/${id}/to-casting`),
    onSuccess: () => {
      invalidateRelated(qc);
      void qc.invalidateQueries({ queryKey: ['castings'] });
    },
  });
}

export function useDeleteOpportunity(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/opportunities/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: opportunityKeys.detail(id) });
      invalidateRelated(qc);
    },
  });
}
