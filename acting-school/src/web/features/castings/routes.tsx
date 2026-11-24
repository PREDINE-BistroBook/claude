import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const CastingsPage = lazy(() => import('./CastingsPage'));
const CastingDetailPage = lazy(() => import('./CastingDetailPage'));
const NewCastingPage = lazy(() => import('./NewCastingPage'));
const EditCastingPage = lazy(() => import('./EditCastingPage'));

export const castingsRoutes: RouteObject[] = [
  {
    path: 'castings',
    element: (
      <Guard permission="castings.read">
        <CastingsPage />
      </Guard>
    ),
  },
  {
    path: 'castings/new',
    element: (
      <Guard permission="castings.write">
        <NewCastingPage />
      </Guard>
    ),
  },
  {
    path: 'castings/:id',
    element: (
      <Guard permission="castings.read">
        <CastingDetailPage />
      </Guard>
    ),
  },
  {
    path: 'castings/:id/edit',
    element: (
      <Guard permission="castings.write">
        <EditCastingPage />
      </Guard>
    ),
  },
];
