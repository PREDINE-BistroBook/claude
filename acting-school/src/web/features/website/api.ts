import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ListResponse } from '@shared/schemas/common';
import type { SiteCoach, SiteCoachInput, SiteContent, SiteSummary, SiteWorkshop, SiteWorkshopInput } from '@shared/schemas/site';
import { api } from '@web/lib/api';
import { withContentChange } from './utils';

/** Everything about the website starts with 'site', so one invalidation refreshes the home, the lists and the forms. */
export const siteKeys = {
  all: ['site'] as const,
  summary: ['site', 'summary'] as const,
  content: ['site', 'content'] as const,
  coaches: ['site', 'coaches'] as const,
  coach: (id: number) => ['site', 'coaches', id] as const,
  workshops: ['site', 'workshops'] as const,
  workshop: (courseId: number) => ['site', 'workshops', courseId] as const,
};

/** The website's counts show on the School and Casting homes too. */
function invalidateSite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: siteKeys.all });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useSiteSummary() {
  return useQuery({ queryKey: siteKeys.summary, queryFn: () => api.get<SiteSummary>('/site/summary') });
}

export function useSiteContent() {
  return useQuery({ queryKey: siteKeys.content, queryFn: () => api.get<SiteContent>('/site/content') });
}

/**
 * Change part of the site content (texts, contact lines, the casting call, the
 * links). The API stores the whole object, so this reads the latest copy first
 * and puts it back with only `change` applied — two screens never overwrite
 * each other with stale data.
 */
export function useUpdateSiteContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (change: (current: SiteContent) => Partial<SiteContent>) => {
      const current = await api.get<SiteContent>('/site/content');
      return api.put<SiteContent>('/site/content', withContentChange(current, change(current)));
    },
    onSuccess: (saved) => {
      qc.setQueryData(siteKeys.content, saved);
      // The home's casting-call switch follows at once (the refetch below confirms it).
      const summary = qc.getQueryData<SiteSummary>(siteKeys.summary);
      if (summary) qc.setQueryData(siteKeys.summary, { ...summary, castingCallOpen: saved.castingCall.open });
      invalidateSite(qc);
    },
  });
}

// ── Coaches ─────────────────────────────────────────────────────────────────

export function useSiteCoaches() {
  return useQuery({ queryKey: siteKeys.coaches, queryFn: () => api.get<ListResponse<SiteCoach>>('/site/coaches') });
}

export function useSiteCoach(id: number, enabled = true) {
  return useQuery({
    queryKey: siteKeys.coach(id),
    queryFn: () => api.get<SiteCoach>(`/site/coaches/${id}`),
    enabled: enabled && Number.isInteger(id) && id > 0,
  });
}

/** Create (no id) or update (id) a coach. */
export function useSaveSiteCoach(id?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SiteCoachInput) => (id ? api.patch<SiteCoach>(`/site/coaches/${id}`, data) : api.post<SiteCoach>('/site/coaches', data)),
    onSuccess: () => invalidateSite(qc),
  });
}

export function useDeleteSiteCoach(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/site/coaches/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: siteKeys.coach(id) });
      invalidateSite(qc);
    },
  });
}

/** Save a new order (ids top to bottom). The list is updated at once so the move feels instant. */
export function useOrderSiteCoaches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.post<ListResponse<SiteCoach>>('/site/coaches/order', { ids }),
    onMutate: (ids) => {
      const prev = qc.getQueryData<ListResponse<SiteCoach>>(siteKeys.coaches);
      if (prev) qc.setQueryData(siteKeys.coaches, { items: ids.map((id) => prev.items.find((c) => c.id === id)).filter(Boolean) as SiteCoach[] });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(siteKeys.coaches, ctx.prev);
    },
    onSuccess: (data) => {
      qc.setQueryData(siteKeys.coaches, data);
      invalidateSite(qc);
    },
  });
}

// ── Workshops on the site ───────────────────────────────────────────────────

export function useSiteWorkshops() {
  return useQuery({ queryKey: siteKeys.workshops, queryFn: () => api.get<ListResponse<SiteWorkshop>>('/site/workshops') });
}

export function useSiteWorkshop(courseId: number, enabled = true) {
  return useQuery({
    queryKey: siteKeys.workshop(courseId),
    queryFn: () => api.get<SiteWorkshop>(`/site/workshops/${courseId}`),
    enabled: enabled && Number.isInteger(courseId) && courseId > 0,
  });
}

/** Create or update a workshop's site row; only what is sent changes. */
export function useSaveSiteWorkshop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ courseId, data }: { courseId: number; data: SiteWorkshopInput }) => api.put<SiteWorkshop>(`/site/workshops/${courseId}`, data),
    onSuccess: (saved) => {
      qc.setQueryData(siteKeys.workshop(saved.courseId), saved);
      const list = qc.getQueryData<ListResponse<SiteWorkshop>>(siteKeys.workshops);
      if (list) qc.setQueryData(siteKeys.workshops, { items: list.items.map((w) => (w.courseId === saved.courseId ? saved : w)) });
      invalidateSite(qc);
    },
  });
}

export function useOrderSiteWorkshops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.post<ListResponse<SiteWorkshop>>('/site/workshops/order', { ids }),
    onMutate: (ids) => {
      const prev = qc.getQueryData<ListResponse<SiteWorkshop>>(siteKeys.workshops);
      if (prev) qc.setQueryData(siteKeys.workshops, { items: ids.map((id) => prev.items.find((w) => w.courseId === id)).filter(Boolean) as SiteWorkshop[] });
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(siteKeys.workshops, ctx.prev);
    },
    onSuccess: (data) => {
      qc.setQueryData(siteKeys.workshops, data);
      invalidateSite(qc);
    },
  });
}
