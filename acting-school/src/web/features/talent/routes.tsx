import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const TalentPage = lazy(() => import('./TalentPage'));
const TalentDetailPage = lazy(() => import('./TalentDetailPage'));
const NewTalentPage = lazy(() => import('./NewTalentPage'));
const EditTalentPage = lazy(() => import('./EditTalentPage'));

export const talentRoutes: RouteObject[] = [
  {
    path: 'talent',
    element: (
      <Guard permission="talent.read">
        <TalentPage />
      </Guard>
    ),
  },
  {
    path: 'talent/new',
    element: (
      <Guard permission="talent.write">
        <NewTalentPage />
      </Guard>
    ),
  },
  {
    path: 'talent/:id',
    element: (
      <Guard permission="talent.read">
        <TalentDetailPage />
      </Guard>
    ),
  },
  {
    path: 'talent/:id/edit',
    element: (
      <Guard permission="talent.write">
        <EditTalentPage />
      </Guard>
    ),
  },
];
