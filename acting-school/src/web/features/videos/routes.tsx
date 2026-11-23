import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { usesVideos } from '@shared/schemas/videos';
import { NoAccess } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';

const VideosPage = lazy(() => import('./VideosPage'));
const VideoPage = lazy(() => import('./VideoPage'));

/** Anyone who holds a videos permission (videos.read, .add, .edit or .review); the API decides which videos they see. */
function VideosGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user && usesVideos(user) ? <>{children}</> : <NoAccess />;
}

/**
 * The video pipeline (Part L), in the School section: /videos is the queue
 * (tabs for the person's role), /videos/:id one video with its history.
 */
export const videosRoutes: RouteObject[] = [
  {
    path: 'videos',
    element: (
      <VideosGuard>
        <VideosPage />
      </VideosGuard>
    ),
  },
  {
    path: 'videos/:id',
    element: (
      <VideosGuard>
        <VideoPage />
      </VideosGuard>
    ),
  },
];
