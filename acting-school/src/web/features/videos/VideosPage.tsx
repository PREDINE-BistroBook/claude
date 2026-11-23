import { CircleCheck, Clapperboard, Hammer, Hourglass, ScanEye, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { todayISO } from '@shared/dates';
import { EmptyState, ErrorState, PageHeader, PageLoader, Tabs } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { PushCard } from '../team/components/PushCard';
import { useVideos } from './api';
import { VideoCard } from './components/VideoParts';
import { firstTab, queueIsMine, queueTabs, tabCounts, tabVideos, videoRoles, type QueueTab } from './utils';

const EMPTY_ICON: Record<QueueTab, LucideIcon> = {
  toCheck: ScanEye,
  toEdit: Clapperboard,
  editing: Hammer,
  withEditor: Hourglass,
  waiting: Hourglass,
  approved: CircleCheck,
  mine: Clapperboard,
};

/** Empty states with a hint (the others have only a title). */
const EMPTY_HINT: Partial<Record<QueueTab, string>> = { toEdit: 'empty.toEditHint', editing: 'empty.editingHint', toCheck: 'empty.toCheckHint', mine: 'empty.mineHint' };

/**
 * /videos — the video queue (School section). Tabs for the person's role
 * (utils.queueTabs): the editor works through "To edit" (sent back first, then
 * by due date, late ones in red) → "Editing" → "Waiting for check" →
 * "Approved"; the reviewer starts on "To check", each card with "Watch the
 * edit" and the two big buttons; a coach sees the videos they added. The
 * first tab with work in it opens by itself; `?tab=` keeps one.
 */
export default function VideosPage() {
  const { t } = useTranslation(['videos', 'common']);
  const { can, user } = useAuth();
  const roles = videoRoles(can);
  const tabs = queueTabs(roles);
  const mine = queueIsMine(roles);
  const list = useVideos({ mine });
  const [params, setParams] = useSearchParams();
  const [chosen, setChosen] = useState<QueueTab | null>(null);
  const me = user?.id ?? 0;
  const isOwner = !!user?.isOwner;
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const counts = useMemo(() => tabCounts(items, tabs, me, isOwner), [items, tabs, me, isOwner]);
  const fromUrl = params.get('tab') as QueueTab | null;
  const tab: QueueTab = chosen ?? (fromUrl && tabs.includes(fromUrl) ? fromUrl : firstTab(tabs, counts));
  const shown = tabVideos(items, tab, me, isOwner);
  const today = todayISO();
  const subtitle = roles.edit ? 'subtitle.editor' : roles.review ? 'subtitle.reviewer' : mine ? 'subtitle.coach' : 'subtitle.viewer';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('title')} subtitle={t(subtitle)} />
      {list.isPending ? (
        <PageLoader />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="grid gap-4">
          {/* The editor and the reviewer are alerted on their phones: offer to switch that on here. */}
          {(roles.edit || roles.review) && !isOwner && <PushCard prompt={{ title: t('push.title'), description: t(roles.review ? 'push.reviewer' : 'push.editor') }} />}
          <Tabs<QueueTab>
            value={tab}
            onChange={(next) => {
              setChosen(next);
              setParams(next === tabs[0] ? {} : { tab: next }, { replace: true });
            }}
            tabs={tabs.map((id) => ({ id, label: t(`tabs.${id}`), count: counts[id] }))}
          />
          <div role="tabpanel">
            {shown.length ? (
              <ul className="grid gap-4">
                {shown.map((v) => (
                  <VideoCard key={v.id} video={v} today={today} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={EMPTY_ICON[tab]}
                title={t(`empty.${tab}`)}
                description={EMPTY_HINT[tab] ? t(EMPTY_HINT[tab]!) : undefined}
                className="rounded-2xl border border-dashed border-line-strong py-10"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
