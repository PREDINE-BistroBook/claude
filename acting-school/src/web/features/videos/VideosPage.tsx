import clsx from 'clsx';
import { CircleCheck, Clapperboard, Hammer, Hourglass, ScanEye, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { todayISO } from '@shared/dates';
import { EmptyState, ErrorState, PageHeader, PageLoader, Tabs } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { PushCard } from '../team/components/PushCard';
import { useVideoCounts, useVideos } from './api';
import { ReviewerNotice } from './components/VideoHomeCards';
import { VideoCard } from './components/VideoParts';
import { QUEUE_MOVE_REST_MS, afterStep, firstTab, pinnedVideos, queueIsMine, queueResting, queueTabs, reviewerNotice, tabCounts, tabVideos, videoRoles, type QueueTab } from './utils';

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
const EMPTY_HINT: Partial<Record<QueueTab, string>> = {
  toEdit: 'empty.toEditHint',
  editing: 'empty.editingHint',
  toCheck: 'empty.toCheckHint',
  mine: 'empty.mineHint',
};

/**
 * /videos — the video queue (School section). Tabs for the person's role
 * (utils.queueTabs): the editor works through "To edit" (sent back first, then
 * by due date, late ones in red) → "Editing" → "Being checked" →
 * "Approved"; the reviewer starts on "To check", each card with "Watch the
 * edit" and the two big buttons; a coach sees the videos they added. The
 * first tab with work in it opens by itself; `?tab=` keeps one.
 *
 * After a tap on a card's step button the cards stay where they are for two
 * seconds, every step button resting (QUEUE_MOVE_REST_MS, as on the cafeteria
 * board): nothing slides under the finger. "Start editing" then shows the
 * video on top of the editor's "Editing" tab, where "Open raw footage" and
 * "Done" are.
 */
export default function VideosPage() {
  const { t } = useTranslation(['videos', 'common']);
  const { can, user } = useAuth();
  const roles = videoRoles(can);
  const tabs = queueTabs(roles);
  const mine = queueIsMine(roles);
  const list = useVideos({ mine });
  const counts = useVideoCounts();
  const [params, setParams] = useSearchParams();
  const [chosen, setChosen] = useState<QueueTab | null>(null);
  const me = user?.id ?? 0;
  const isOwner = !!user?.isOwner;
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const tabCount = useMemo(() => tabCounts(items, tabs, me, isOwner), [items, tabs, me, isOwner]);
  const fromUrl = params.get('tab') as QueueTab | null;
  const tab: QueueTab = chosen ?? (fromUrl && tabs.includes(fromUrl) ? fromUrl : firstTab(tabs, tabCount));
  const today = todayISO();
  const subtitle = isOwner ? 'subtitle.viewer' : roles.edit ? 'subtitle.editor' : roles.review ? 'subtitle.reviewer' : mine ? 'subtitle.coach' : 'subtitle.viewer';
  const tabsRef = useRef<HTMLDivElement>(null);

  // The cards in place after a tap: which tab, which ids in which order, since when.
  const [rest, setRest] = useState<{
    at: number;
    tab: QueueTab;
    ids: number[];
  } | null>(null);
  useEffect(() => {
    if (!rest) return;
    const id = setTimeout(() => setRest(null), Math.max(0, QUEUE_MOVE_REST_MS - (Date.now() - rest.at)));
    return () => clearTimeout(id);
  }, [rest]);
  const resting = queueResting(rest?.at ?? null, Date.now());
  const sorted = tabVideos(items, tab, me, isOwner);
  const shown = resting && rest!.tab === tab ? pinnedVideos(items, rest!.ids) : sorted;

  const openTab = (next: QueueTab) => {
    setChosen(next);
    setParams(next === tabs[0] ? {} : { tab: next }, { replace: true });
  };
  const onTap = () => setRest({ at: Date.now(), tab, ids: shown.map((v) => v.id) });
  const onStep = (step: Parameters<typeof afterStep>[0], result: { id: number }) => {
    const next = afterStep(
      step,
      tab,
      tabs,
      result.id,
      tabVideos(items, 'editing', me, isOwner).map((v) => v.id),
    );
    if (next.pinned) {
      openTab(next.tab);
      setRest({ at: Date.now(), tab: next.tab, ids: next.pinned });
      // The taken video is on top of "Editing": bring the top of the list into view (the buttons rest meanwhile).
      requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      return { movedToEditing: true };
    }
    // The rest starts again from the answer: the moved card keeps its place a moment longer.
    setRest((r) => (r ? { ...r, at: Date.now() } : r));
    return {};
  };

  const notice = reviewerNotice(counts, can);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('title')} subtitle={t(subtitle)} />
      {list.isPending ? (
        <PageLoader />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="grid gap-4">
          {notice && <ReviewerNotice kind={notice} />}
          {/* The editor and the reviewer are alerted on their phones: offer to switch that on here. */}
          {(roles.edit || roles.review) && !isOwner && (
            <PushCard
              prompt={{
                title: t('push.title'),
                description: t(roles.review ? 'push.reviewer' : 'push.editor'),
              }}
            />
          )}
          {/* fill: four tabs with counts stay in sight at 375 px (a long label wraps onto two lines). */}
          <div ref={tabsRef} className="min-w-0 scroll-mt-20">
            <Tabs<QueueTab>
              fill
              value={tab}
              onChange={openTab}
              tabs={tabs.map((id) => ({
                id,
                label: t(`tabs.${id}`),
                count: tabCount[id],
              }))}
            />
          </div>
          <div role="tabpanel">
            {shown.length ? (
              // While resting, nothing on the cards answers a tap (links included): a second tap on the same spot does nothing.
              <ul className={clsx('grid gap-4', resting && 'pointer-events-none [&_dialog]:pointer-events-auto')} aria-busy={resting || undefined}>
                {shown.map((v) => (
                  <VideoCard key={v.id} video={v} today={today} resting={resting} onTap={onTap} onStep={onStep} />
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
