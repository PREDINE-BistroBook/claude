import { lazy } from 'react';
import type { RouteObject } from 'react-router';

const TeamPage = lazy(() => import('./TeamPage'));

/** /team: every signed-in worker (no permission needed), outside the three sections like /profile. */
export const teamRoutes: RouteObject[] = [{ path: 'team', element: <TeamPage /> }];
