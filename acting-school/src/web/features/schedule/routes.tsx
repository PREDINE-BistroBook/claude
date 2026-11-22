import { lazy } from 'react';
import type { RouteObject } from 'react-router';

const SchedulePage = lazy(() => import('./SchedulePage'));

export const scheduleRoutes: RouteObject[] = [{ path: 'schedule', element: <SchedulePage /> }];
