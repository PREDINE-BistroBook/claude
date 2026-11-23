import clsx from 'clsx';
import { ChevronRight, CircleCheck, Film, ScanEye, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { VideoCounts } from '@shared/schemas/videos';
import { useVideoCounts } from '../api';
import { VIDEOS_PATH } from '../utils';

/** The cards a person gets on the School home, from the poll's counts (editor, reviewer, coach — any that apply). */
export function videoHomeCardKinds(counts: VideoCounts | null | undefined): ('editor' | 'reviewer' | 'coach')[] {
  if (!counts) return [];
  const out: ('editor' | 'reviewer' | 'coach')[] = [];
  if (counts.toEdit !== null) out.push('editor');
  if (counts.toCheck !== null) out.push('reviewer');
  if (counts.addedByMe > 0) out.push('coach');
  return out;
}

/**
 * The School home's video cards, one per role (Part L): the editor's "5 videos
 * to edit (2 due today)", the reviewer's "2 edits to check", the coach's "1 of
 * your videos approved this week". Each is one big link to the queue.
 */
export function VideoHomeCards() {
  const counts = useVideoCounts();
  const kinds = videoHomeCardKinds(counts);
  if (!counts || !kinds.length) return null;
  return (
    <section className={clsx('grid gap-3', kinds.length > 1 && 'sm:grid-cols-2')}>
      {kinds.map((k) => (k === 'editor' ? <EditorCard key={k} counts={counts} /> : k === 'reviewer' ? <ReviewerCard key={k} counts={counts} /> : <CoachCard key={k} counts={counts} />))}
    </section>
  );
}

function HomeCard({ to, icon: Icon, title, detail, action, urgent }: { to: string; icon: LucideIcon; title: ReactNode; detail?: ReactNode; action: string; urgent?: boolean }) {
  return (
    <Link
      to={to}
      className={clsx(
        'group flex min-h-12 items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:bg-surface-2',
        urgent ? 'border-warning/50' : 'border-line',
      )}
    >
      <span className={clsx('flex size-11 shrink-0 items-center justify-center rounded-xl', urgent ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent')}>
        <Icon className="size-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{title}</span>
        {detail && <span className="mt-0.5 block text-sm text-muted">{detail}</span>}
        <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-accent">
          {action}
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </span>
      </span>
    </Link>
  );
}

function EditorCard({ counts }: { counts: VideoCounts }) {
  const { t } = useTranslation('videos');
  const toEdit = counts.toEdit ?? 0;
  const dueToday = counts.dueToday ?? 0;
  const late = counts.late ?? 0;
  return (
    <HomeCard
      to={`${VIDEOS_PATH}?tab=toEdit`}
      icon={Film}
      urgent={toEdit > 0}
      title={t('home.toEdit', { count: toEdit })}
      detail={
        dueToday || late ? (
          <>
            {dueToday > 0 && t('home.dueToday', { count: dueToday })}
            {dueToday > 0 && late > 0 && ' · '}
            {late > 0 && <span className="font-medium text-danger">{t('home.late', { count: late })}</span>}
          </>
        ) : undefined
      }
      action={t('home.open')}
    />
  );
}

function ReviewerCard({ counts }: { counts: VideoCounts }) {
  const { t } = useTranslation('videos');
  const toCheck = counts.toCheck ?? 0;
  return <HomeCard to={`${VIDEOS_PATH}?tab=toCheck`} icon={ScanEye} urgent={toCheck > 0} title={t('home.toCheck', { count: toCheck })} action={t(toCheck ? 'home.check' : 'home.open')} />;
}

function CoachCard({ counts }: { counts: VideoCounts }) {
  const { t } = useTranslation('videos');
  return <HomeCard to={`${VIDEOS_PATH}?tab=approved`} icon={CircleCheck} title={t('home.approved', { count: counts.approvedThisWeek })} action={t('home.open')} />;
}
