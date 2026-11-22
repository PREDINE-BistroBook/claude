import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const StudentsPage = lazy(() => import('./StudentsPage'));

export const studentsRoutes: RouteObject[] = [
  {
    path: 'students',
    element: (
      <Guard permission="students.read">
        <StudentsPage />
      </Guard>
    ),
  },
];
