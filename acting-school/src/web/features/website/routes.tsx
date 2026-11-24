import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { RequireSection } from '@web/layout/RequireSection';
import { Guard } from '@web/lib/auth';

const WebsiteHomePage = lazy(() => import('./WebsiteHomePage'));
const StudioPage = lazy(() => import('./StudioPage'));
const CoachesPage = lazy(() => import('./CoachesPage'));
const CoachFormPage = lazy(() => import('./CoachFormPage'));
const WorkshopsPage = lazy(() => import('./WorkshopsPage'));
const WorkshopPage = lazy(() => import('./WorkshopPage'));
const CastingCallPage = lazy(() => import('./CastingCallPage'));
const LinksPage = lazy(() => import('./LinksPage'));

const manage = (page: ReactNode) => <Guard permission="website.manage">{page}</Guard>;

/** The Website section (website.manage): its home and the pages the menu lists (layout/nav.ts). */
export const websiteRoutes: RouteObject[] = [
  {
    path: 'website',
    element: (
      <RequireSection section="website">
        <WebsiteHomePage />
      </RequireSection>
    ),
  },
  { path: 'website/pages', element: manage(<StudioPage />) },
  { path: 'website/coaches', element: manage(<CoachesPage />) },
  { path: 'website/coaches/new', element: manage(<CoachFormPage />) },
  { path: 'website/coaches/:id', element: manage(<CoachFormPage />) },
  { path: 'website/workshops', element: manage(<WorkshopsPage />) },
  { path: 'website/workshops/:courseId', element: manage(<WorkshopPage />) },
  { path: 'website/casting-call', element: manage(<CastingCallPage />) },
  { path: 'website/links', element: manage(<LinksPage />) },
];
