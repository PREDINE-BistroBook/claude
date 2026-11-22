import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { Guard } from '@web/lib/auth';

const StudentsPage = lazy(() => import('./StudentsPage'));
const StudentDetailPage = lazy(() => import('./StudentDetailPage'));
const NewStudentPage = lazy(() => import('./NewStudentPage'));
const EditStudentPage = lazy(() => import('./EditStudentPage'));

export const studentsRoutes: RouteObject[] = [
  {
    path: 'students',
    element: (
      <Guard permission="students.read">
        <StudentsPage />
      </Guard>
    ),
  },
  {
    path: 'students/new',
    element: (
      <Guard permission="students.write">
        <NewStudentPage />
      </Guard>
    ),
  },
  {
    path: 'students/:id',
    element: (
      <Guard permission="students.read">
        <StudentDetailPage />
      </Guard>
    ),
  },
  {
    path: 'students/:id/edit',
    element: (
      <Guard permission="students.write">
        <EditStudentPage />
      </Guard>
    ),
  },
];
