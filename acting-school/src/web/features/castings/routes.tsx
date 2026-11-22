import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const CastingsPage = lazy(() => import('./CastingsPage'));

export const castingsRoutes: RouteObject[] = [
  {
    path: 'castings',
    element: (
      <Guard permission="castings.read">
        <CastingsPage />
      </Guard>
    ),
  },
];
