import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const ApplicationsPage = lazy(() => import('./ApplicationsPage'));
const ApplicationDetailPage = lazy(() => import('./ApplicationDetailPage'));

/** Casting › Applications (talent.read). /casting/schedule lives in schedule/routes.tsx, so no "casting/*" catch-all here. */
export const applicationsRoutes: RouteObject[] = [
  {
    path: 'casting/applications',
    element: (
      <Guard permission="talent.read">
        <ApplicationsPage />
      </Guard>
    ),
  },
  {
    path: 'casting/applications/:id',
    element: (
      <Guard permission="talent.read">
        <ApplicationDetailPage />
      </Guard>
    ),
  },
];
