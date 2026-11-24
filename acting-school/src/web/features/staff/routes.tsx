import { lazy, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const StaffNewPage = lazy(() => import('./StaffNewPage'));
const StaffMemberPage = lazy(() => import('./StaffMemberPage'));

const manage = (page: ReactNode) => <Guard permission="staff.manage">{page}</Guard>;

/**
 * The team list itself is the Team page (/team, features/team): everyone sees
 * it, and staff.manage adds "Add team member" and a link on each row to the
 * two screens here. /staff (the old Staff list) forwards to it.
 */
export const staffRoutes: RouteObject[] = [
  { path: 'staff', element: <Navigate to="/team" replace /> },
  { path: 'staff/new', element: manage(<StaffNewPage />) },
  { path: 'staff/:id', element: manage(<StaffMemberPage />) },
];
