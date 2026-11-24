import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const SettingsPage = lazy(() => import('./SettingsPage'));

export const settingsRoutes: RouteObject[] = [
  {
    path: 'settings',
    element: (
      <Guard permission="settings.manage">
        <SettingsPage />
      </Guard>
    ),
  },
];
