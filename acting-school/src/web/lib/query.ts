import { onlineManager, QueryClient } from '@tanstack/react-query';
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

// TanStack assumes "online" until it sees an 'offline' event, so an app opened with no signal would
// fail its first reads (and think nobody is signed in). Start from what the browser knows: reads then
// wait while offline and run by themselves when the connection comes back.
if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') onlineManager.setOnline(navigator.onLine);
