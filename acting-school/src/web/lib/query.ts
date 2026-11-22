import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Query conventions: keys start with the resource — ['students'],
 * ['students', id], ['students', { q, status }] — so a mutation can
 * invalidate everything about it with { queryKey: ['students'] }.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't retry answers that won't change (403/404/validation).
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});
