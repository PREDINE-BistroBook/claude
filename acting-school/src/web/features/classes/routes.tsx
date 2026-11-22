import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const ClassesPage = lazy(() => import('./ClassesPage'));

export const classesRoutes: RouteObject[] = [
  {
    path: 'classes',
    element: (
      <Guard permission="courses.read">
        <ClassesPage />
      </Guard>
    ),
  },
];
