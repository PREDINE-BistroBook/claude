import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { addDays } from '@shared/dates';
import type { ListResponse } from '@shared/schemas/common';
import type { ScheduleEvent } from '@shared/schemas/schedule';
import type { AppSettings } from '@shared/schemas/settings';
import { api, qs } from '@web/lib/api';

/** Query keys: ['schedule', { from, to }] — invalidate ['schedule'] after any class/audition change. */
export const scheduleKeys = {
  all: ['schedule'] as const,
  range: (from: string, to: string) => ['schedule', { from, to }] as const,
};

const fetchRange = (from: string, to: string) => api.get<ListResponse<ScheduleEvent>>(`/schedule${qs({ from, to })}`);

/** One week (or any range ≤ 62 days). Keeps the previous range on screen while the next one loads. */
export function useSchedule(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: scheduleKeys.range(from, to),
    queryFn: () => fetchRange(from, to),
    enabled,
    placeholderData: keepPreviousData,
    // Other screens change classes and auditions; check again whenever the week is shown.
    staleTime: 0,
  });
}

/** Warm the cache for the weeks either side, so paging feels instant. */
export function usePrefetchAdjacentWeeks(from: string, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    for (const start of [addDays(from, -7), addDays(from, 7)]) {
      const end = addDays(start, 6);
      void qc.prefetchQuery({ queryKey: scheduleKeys.range(start, end), queryFn: () => fetchRange(start, end), staleTime: 30_000 });
    }
  }, [qc, from, enabled]);
}

/**
 * The school's first day of the week (GET /api/settings). `ready` turns true
 * once settings answered or failed — Monday is the fallback — so the week isn't
 * fetched twice with two different starts.
 */
export function useWeekStart(): { weekStartsOn: number; ready: boolean } {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Partial<AppSettings>>('/settings'),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const w = settings.data?.weekStartsOn;
  return { weekStartsOn: w === 0 || w === 1 || w === 6 ? w : 1, ready: !settings.isPending };
}
