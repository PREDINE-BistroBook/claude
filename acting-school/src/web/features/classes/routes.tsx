import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const ClassesPage = lazy(() => import('./ClassesPage'));
const CourseFormPage = lazy(() => import('./CourseFormPage'));
const CourseDetailPage = lazy(() => import('./CourseDetailPage'));
const SessionPage = lazy(() => import('./SessionPage'));

export const classesRoutes: RouteObject[] = [
  {
    path: 'classes',
    element: (
      <Guard permission="courses.read">
        <ClassesPage />
      </Guard>
    ),
  },
  {
    path: 'classes/new',
    element: (
      <Guard permission="courses.write">
        <CourseFormPage />
      </Guard>
    ),
  },
  {
    path: 'classes/:id',
    element: (
      <Guard permission="courses.read">
        <CourseDetailPage />
      </Guard>
    ),
  },
  {
    path: 'classes/:id/edit',
    element: (
      <Guard permission="courses.write">
        <CourseFormPage key="edit" />
      </Guard>
    ),
  },
  {
    path: 'sessions/:id',
    element: (
      <Guard permission="courses.read">
        <SessionPage />
      </Guard>
    ),
  },
];
