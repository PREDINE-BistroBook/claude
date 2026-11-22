import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const TalentPage = lazy(() => import('./TalentPage'));

export const talentRoutes: RouteObject[] = [
  {
    path: 'talent',
    element: (
      <Guard permission="talent.read">
        <TalentPage />
      </Guard>
    ),
  },
];
