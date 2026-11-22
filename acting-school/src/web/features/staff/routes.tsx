import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const StaffPage = lazy(() => import('./StaffPage'));

export const staffRoutes: RouteObject[] = [
  {
    path: 'staff',
    element: (
      <Guard permission="staff.manage">
        <StaffPage />
      </Guard>
    ),
  },
];
