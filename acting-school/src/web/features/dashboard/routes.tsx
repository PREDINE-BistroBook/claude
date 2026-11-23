import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireSection } from '@web/layout/RequireSection';

const StartPage = lazy(() => import('./StartPage'));
const SchoolHomePage = lazy(() => import('./SchoolHomePage'));
const CastingHomePage = lazy(() => import('./CastingHomePage'));

/** "/" (sends you to your section's home) and the School and Casting homes. The Website home lives in features/website. */
export const dashboardRoutes: RouteObject[] = [
  { index: true, element: <StartPage /> },
  {
    path: 'school',
    element: (
      <RequireSection section="school">
        <SchoolHomePage />
      </RequireSection>
    ),
  },
  {
    path: 'casting',
    element: (
      <RequireSection section="casting">
        <CastingHomePage />
      </RequireSection>
    ),
  },
];
