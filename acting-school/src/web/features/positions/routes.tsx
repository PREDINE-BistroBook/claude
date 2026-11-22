import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const PositionsPage = lazy(() => import('./PositionsPage'));
const PositionFormPage = lazy(() => import('./PositionFormPage'));

const guarded = (el: ReactNode) => <Guard permission="positions.manage">{el}</Guard>;

export const positionsRoutes: RouteObject[] = [
  { path: 'positions', element: guarded(<PositionsPage />) },
  { path: 'positions/new', element: guarded(<PositionFormPage />) },
  { path: 'positions/:id', element: guarded(<PositionFormPage />) },
];
