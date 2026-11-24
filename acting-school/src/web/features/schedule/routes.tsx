import { lazy } from 'react';
import { Navigate, useSearchParams, type RouteObject } from 'react-router';
import { useAuth } from '@web/lib/auth';
import { CASTING_SCHEDULE_KINDS, SCHOOL_SCHEDULE_KINDS, legacyScheduleRedirect } from './utils';

const SchedulePage = lazy(() => import('./SchedulePage'));

/** /schedule: the School schedule — or, for an old link that was after auditions, on to the Casting one (utils.ts legacyScheduleRedirect). */
function SchoolSchedule() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const moved = legacyScheduleRedirect(params, can);
  if (moved) return <Navigate to={moved} replace />;
  return <SchedulePage key="school" kinds={SCHOOL_SCHEDULE_KINDS} />;
}

/** One schedule view per section: School (workshops + admissions interviews) and Casting (auditions). */
export const scheduleRoutes: RouteObject[] = [
  { path: 'schedule', element: <SchoolSchedule /> },
  { path: 'casting/schedule', element: <SchedulePage key="casting" kinds={CASTING_SCHEDULE_KINDS} /> },
];
