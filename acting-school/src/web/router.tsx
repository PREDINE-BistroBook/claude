import { lazy } from 'react';
import { createBrowserRouter } from 'react-router';
import { admissionsRoutes } from './features/admissions/routes';
import { castingsRoutes } from './features/castings/routes';
import { classesRoutes } from './features/classes/routes';
import { dashboardRoutes } from './features/dashboard/routes';
import { positionsRoutes } from './features/positions/routes';
import { scheduleRoutes } from './features/schedule/routes';
import { settingsRoutes } from './features/settings/routes';
import { staffRoutes } from './features/staff/routes';
import { studentsRoutes } from './features/students/routes';
import { talentRoutes } from './features/talent/routes';
import { AppShell } from './layout/AppShell';
import { RequireSection } from './layout/RequireSection';
import { RequireAuth } from './lib/auth';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import SetupPage from './pages/SetupPage';

const ProfilePage = lazy(() => import('./pages/ProfilePage'));
// Until features/website/routes.tsx exists: the Website tab and its menu open a "being built" page.
const WebsitePlaceholder = lazy(() => import('./layout/WebsitePlaceholder'));

/**
 * Every screen. Each feature owns its paths in features/<name>/routes.tsx;
 * they all render inside the signed-in AppShell. "/" sends people to their
 * section's home (/school, /casting, /website — layout/sections.ts).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      ...dashboardRoutes,
      ...scheduleRoutes,
      ...admissionsRoutes,
      ...studentsRoutes,
      ...classesRoutes,
      ...talentRoutes,
      ...castingsRoutes,
      ...staffRoutes,
      ...positionsRoutes,
      ...settingsRoutes,
      {
        path: 'website/*',
        element: (
          <RequireSection section="website">
            <WebsitePlaceholder />
          </RequireSection>
        ),
      },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
