import { useQuery } from '@tanstack/react-query';
import type { DashboardData } from '@shared/schemas/dashboard';
import { api } from '@web/lib/api';

export const dashboardKeys = { all: ['dashboard'] as const };

/** GET /api/dashboard — refreshed whenever the home screen is opened (other screens change what it shows). */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => api.get<DashboardData>('/dashboard'),
    staleTime: 0,
  });
}
