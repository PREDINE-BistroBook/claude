import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Gender, TalentStatus } from '@shared/enums';
import type { ListResponse } from '@shared/schemas/common';
import type { Talent, TalentDetail, TalentInput, TalentListItem, TalentPhoto, TalentTags } from '@shared/schemas/talent';
import { api, qs } from '@web/lib/api';

export interface TalentFilters {
  q?: string;
  status?: TalentStatus;
  gender?: Gender;
  age?: number;
  skill?: string;
  language?: string;
}

/** Everything about talent starts with 'talent', so one invalidation refreshes lists, details and tags. */
export const talentKeys = {
  all: ['talent'] as const,
  list: (filters: TalentFilters) => ['talent', 'list', filters] as const,
  detail: (id: number) => ['talent', id] as const,
  tags: ['talent', 'tags'] as const,
};

export function useTalentList(filters: TalentFilters) {
  return useQuery({
    queryKey: talentKeys.list(filters),
    queryFn: () => api.get<ListResponse<TalentListItem>>(`/talent${qs({ ...filters })}`),
    // Keep the previous grid while a new search loads instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

export function useTalent(id: number, enabled = true) {
  return useQuery({
    queryKey: talentKeys.detail(id),
    queryFn: () => api.get<TalentDetail>(`/talent/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/** Skills and languages already in use, for autocomplete. */
export function useTalentTags() {
  return useQuery({ queryKey: talentKeys.tags, queryFn: () => api.get<TalentTags>('/talent/tags'), staleTime: 5 * 60_000 });
}

/** Talent names and headshots also show on castings, the schedule, the dashboard and student pages. */
function invalidateRelated(qc: QueryClient) {
  for (const key of ['castings', 'schedule', 'dashboard', 'students']) void qc.invalidateQueries({ queryKey: [key] });
}

/** Create (no id) or update (id) a profile. */
export function useSaveTalent(id?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TalentInput>) => (id ? api.patch<Talent>(`/talent/${id}`, data) : api.post<Talent>('/talent', data)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: talentKeys.all });
      invalidateRelated(qc);
    },
  });
}

export function useDeleteTalent(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/talent/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: talentKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: talentKeys.all });
      invalidateRelated(qc);
    },
  });
}

/** Attach an uploaded file to the gallery (the first photo becomes the headshot). */
export function addTalentPhoto(talentId: number, fileId: string) {
  return api.post<TalentPhoto>(`/talent/${talentId}/photos`, { fileId });
}

export function useSetHeadshot(talentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => api.patch<Talent>(`/talent/${talentId}`, { headshotFileId: fileId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: talentKeys.all });
      invalidateRelated(qc);
    },
  });
}

export function useDeletePhoto(talentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: number) => api.delete(`/talent/${talentId}/photos/${photoId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: talentKeys.all });
      invalidateRelated(qc);
    },
  });
}
