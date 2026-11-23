import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const LeadsPage = lazy(() => import('./LeadsPage'));
const LeadDetailPage = lazy(() => import('./LeadDetailPage'));
const NewLeadPage = lazy(() => import('./NewLeadPage'));
const EditLeadPage = lazy(() => import('./EditLeadPage'));

export const admissionsRoutes: RouteObject[] = [
  {
    path: 'admissions',
    element: (
      <Guard permission="admissions.read">
        <LeadsPage />
      </Guard>
    ),
  },
  {
    path: 'admissions/new',
    element: (
      // The enquiries API is behind admissions.read as well (routes/leads.ts): writing alone would be refused on Save.
      <Guard permission="admissions.write" also="admissions.read">
        <NewLeadPage />
      </Guard>
    ),
  },
  {
    path: 'admissions/:id',
    element: (
      <Guard permission="admissions.read">
        <LeadDetailPage />
      </Guard>
    ),
  },
  {
    path: 'admissions/:id/edit',
    element: (
      <Guard permission="admissions.write" also="admissions.read">
        <EditLeadPage />
      </Guard>
    ),
  },
];
