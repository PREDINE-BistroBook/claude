import { lazy } from 'react';
import type { RouteObject } from 'react-router';

const TeamPage = lazy(() => import('./TeamPage'));

/**
 * /team: the one Team page, for every signed-in person (no permission needed), outside the three
 * sections like /profile. With staff.manage it also carries the management controls; the member
 * pages it links to are features/staff (/staff/new, /staff/:id), and /staff forwards here.
 */
export const teamRoutes: RouteObject[] = [{ path: 'team', element: <TeamPage /> }];
