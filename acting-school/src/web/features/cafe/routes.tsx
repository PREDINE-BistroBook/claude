import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { NoAccess } from '@web/components/ui';
import { Guard, useAuth } from '@web/lib/auth';

const CafeOrderPage = lazy(() => import('./CafeOrderPage'));
const CafeBoardPage = lazy(() => import('./CafeBoardPage'));
const CafeMenuPage = lazy(() => import('./CafeMenuPage'));
const CafeReportPage = lazy(() => import('./CafeReportPage'));

/** The menu editor is for whoever serves — or holds settings.manage, like the Executive Director. */
function MenuGuard({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  return can('cafeteria.serve') || can('settings.manage') ? <>{children}</> : <NoAccess />;
}

/**
 * The cafeteria (Part J), outside the three sections like /team: /cafeteria is
 * ordering, for every signed-in person; /cafeteria/board is the orders board
 * (cafeteria.serve — the Office helper's home); /cafeteria/menu the menu and
 * places editor; /cafeteria/report who had what in a month (cafeteria.report —
 * the owners). Each page shows "switched off" instead while the
 * cafeteriaEnabled setting is off.
 */
export const cafeRoutes: RouteObject[] = [
  { path: 'cafeteria', element: <CafeOrderPage /> },
  {
    path: 'cafeteria/board',
    element: (
      <Guard permission="cafeteria.serve">
        <CafeBoardPage />
      </Guard>
    ),
  },
  {
    path: 'cafeteria/menu',
    element: (
      <MenuGuard>
        <CafeMenuPage />
      </MenuGuard>
    ),
  },
  {
    path: 'cafeteria/report',
    element: (
      <Guard permission="cafeteria.report">
        <CafeReportPage />
      </Guard>
    ),
  },
];
