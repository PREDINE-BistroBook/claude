import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { CASTING_SCHEDULE_KINDS, SCHOOL_SCHEDULE_KINDS } from './utils';

const SchedulePage = lazy(() => import('./SchedulePage'));

/** One schedule view per section: School (workshops + admissions interviews) and Casting (auditions). */
export const scheduleRoutes: RouteObject[] = [
  { path: 'schedule', element: <SchedulePage key="school" kinds={SCHOOL_SCHEDULE_KINDS} /> },
  { path: 'casting/schedule', element: <SchedulePage key="casting" kinds={CASTING_SCHEDULE_KINDS} /> },
];
