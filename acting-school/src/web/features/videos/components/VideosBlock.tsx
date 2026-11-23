import { Clapperboard, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayISO } from '@shared/dates';
import { usesVideos } from '@shared/schemas/videos';
import { Button, Card, EmptyState, ErrorState, Spinner } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useVideos } from '../api';
import { AddVideoModal, type VideoFormStudent } from './AddVideoModal';
import { VideoRow } from './VideoParts';

/**
 * The "Videos" block on a session's page (and on a workshop's): its videos with
 * their status in words, and "+ Add video" for whoever adds class videos
 * (videos.add). Shown to anyone who uses the video pipeline at all.
 */
export function VideosBlock({
  course,
  session,
  sessions,
  students,
}: {
  course: { id: number; name: string };
  /** On a session's page: its videos, and new ones go to it. */
  session?: { id: number; date: string };
  /** On a workshop's page: its sessions so far, to pick one for a new video. */
  sessions?: { id: number; date: string; startTime: string }[];
  students: VideoFormStudent[];
}) {
  const { t } = useTranslation('videos');
  const { user, can } = useAuth();
  const [adding, setAdding] = useState(false);
  const show = !!user && usesVideos(user);
  const list = useVideos(session ? { sessionId: session.id } : { courseId: course.id }, show);
  if (!show) return null;
  const canAdd = can('videos.add');
  const today = todayISO();

  return (
    <section aria-labelledby="videos-title">
      <Card
        padded={false}
        title={
          <span id="videos-title" className="inline-flex items-center gap-2">
            <Clapperboard className="size-5 text-muted" aria-hidden />
            {t('block.title')}
          </span>
        }
        actions={
          canAdd && (
            <Button variant="primary" size="lg" icon={Plus} onClick={() => setAdding(true)}>
              {t('actions.add')}
            </Button>
          )
        }
      >
        {list.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data.items.length ? (
          <ul className="divide-y divide-line">
            {list.data.items.map((v) => (
              <VideoRow key={v.id} video={v} today={today} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Clapperboard}
            title={t(session ? 'block.empty' : 'block.emptyWorkshop')}
            description={canAdd ? t('block.emptyHint') : undefined}
            className="py-8"
          />
        )}
      </Card>
      {canAdd && (
        <AddVideoModal
          open={adding}
          onClose={() => setAdding(false)}
          course={course}
          session={session ?? null}
          sessions={sessions}
          students={students}
        />
      )}
    </section>
  );
}
