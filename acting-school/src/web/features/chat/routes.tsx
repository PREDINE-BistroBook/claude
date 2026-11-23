import { lazy } from 'react';
import type { RouteObject } from 'react-router';

const MessagesPage = lazy(() => import('./MessagesPage'));
const ConversationPage = lazy(() => import('./ConversationPage'));

/** /messages and /messages/:id: every signed-in worker, outside the three sections like /profile. */
export const chatRoutes: RouteObject[] = [
  { path: 'messages', element: <MessagesPage /> },
  { path: 'messages/:id', element: <ConversationPage /> },
];
