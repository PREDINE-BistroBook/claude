import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const OpportunitiesPage = lazy(() => import('./OpportunitiesPage'));
const OpportunityPage = lazy(() => import('./OpportunityPage'));
const OpportunityFormPage = lazy(() => import('./OpportunityFormPage'));

/** Casting › Opportunities (Part K1): castings.read sees them; castings.write adds and edits (the API's own rules). */
export const opportunitiesRoutes: RouteObject[] = [
  {
    path: 'casting/opportunities',
    element: (
      <Guard permission="castings.read">
        <OpportunitiesPage />
      </Guard>
    ),
  },
  {
    path: 'casting/opportunities/new',
    element: (
      <Guard permission="castings.write">
        <OpportunityFormPage />
      </Guard>
    ),
  },
  {
    path: 'casting/opportunities/:id',
    element: (
      <Guard permission="castings.read">
        <OpportunityPage />
      </Guard>
    ),
  },
  {
    path: 'casting/opportunities/:id/edit',
    element: (
      <Guard permission="castings.write">
        <OpportunityFormPage />
      </Guard>
    ),
  },
];
