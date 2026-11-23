import { lazy } from 'react';
import { createBrowserRouter } from 'react-router';
import { admissionsRoutes } from './features/admissions/routes';
import { applicationsRoutes } from './features/applications/routes';
import { cafeRoutes } from './features/cafe/routes';
import { castingsRoutes } from './features/castings/routes';
import { chatRoutes } from './features/chat/routes';
import { classesRoutes } from './features/classes/routes';
import { dashboardRoutes } from './features/dashboard/routes';
import { positionsRoutes } from './features/positions/routes';
import { scheduleRoutes } from './features/schedule/routes';
import { settingsRoutes } from './features/settings/routes';
import { staffRoutes } from './features/staff/routes';
import { studentsRoutes } from './features/students/routes';
import { talentRoutes } from './features/talent/routes';
import { teamRoutes } from './features/team/routes';
import { websiteRoutes } from './features/website/routes';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './lib/auth';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import SetupPage from './pages/SetupPage';

const ProfilePage = lazy(() => import('./pages/ProfilePage'));

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
      ...applicationsRoutes,
      ...websiteRoutes,
      ...staffRoutes,
      ...positionsRoutes,
      ...settingsRoutes,
      ...teamRoutes,
      ...chatRoutes,
      ...cafeRoutes,
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
