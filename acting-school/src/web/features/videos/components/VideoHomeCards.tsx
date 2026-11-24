import clsx from 'clsx';
import { ChevronRight, CircleCheck, Film, ScanEye, TriangleAlert, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { VideoCounts } from '@shared/schemas/videos';
import { ButtonLink } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { TEAM_PATH } from '@web/layout/nav';
import { useVideoCounts } from '../api';
import { VIDEOS_PATH, reviewerNotice, videoHomeCardKinds } from '../utils';

export { videoHomeCardKinds };

/**
 * The School home's video cards, one per role (Part L): the editor's "5 videos
 * to edit (2 due today)", the reviewer's "2 videos to check", the coach's
 * "1 of your videos approved this week" (or how many are still with the
 * editor or the reviewer — never a "0 approved"). Each is one big link to the
 * queue. Above them, for whoever gives positions, the warning that nobody
 * checks finished edits yet.
 */
export function VideoHomeCards() {
  const counts = useVideoCounts();
  const { can } = useAuth();
  const kinds = videoHomeCardKinds(counts);
  const notice = reviewerNotice(counts, can);
  if (!counts || (!kinds.length && !notice)) return null;
  return (
    <div className="grid gap-3">
      {notice && <ReviewerNotice kind={notice} />}
      {kinds.length > 0 && (
        <section className={clsx('grid gap-3', kinds.length > 1 && 'sm:grid-cols-2')}>
          {kinds.map((k) => (k === 'editor' ? <EditorCard key={k} counts={counts} /> : k === 'reviewer' ? <ReviewerCard key={k} counts={counts} /> : <CoachCard key={k} counts={counts} />))}
        </section>
      )}
    </div>
  );
}

/**
 * "Nobody checks finished edits yet": on the live school until someone (Moaty)
 * is given the Video reviewer position, every "Done" alerts nobody — so whoever
 * can give it (the owners, the director since grant v6) is told where to fix it
 * (with a link to Team), and anyone else who manages the team to ask an owner.
 */
export function ReviewerNotice({ kind }: { kind: 'give' | 'ask' }) {
  const { t } = useTranslation('videos');
  return (
    <div role="status" className="grid gap-3 rounded-2xl border border-warning/50 bg-warning-soft px-4 py-3.5 text-ink">
      <p className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="block font-semibold">{t('home.nobodyChecks')}</span>
          <span className="mt-0.5 block text-sm">{t(kind === 'give' ? 'home.nobodyChecksGive' : 'home.nobodyChecksAsk')}</span>
        </span>
      </p>
      {kind === 'give' && (
        <ButtonLink to={TEAM_PATH} icon={Users} size="lg" className="w-full sm:w-auto sm:justify-self-start">
          {t('home.openTeam')}
        </ButtonLink>
      )}
    </div>
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

/** The coach's card: approved this week first (the good news), else how many are still with the editor or the reviewer. */
function CoachCard({ counts }: { counts: VideoCounts }) {
  const { t } = useTranslation('videos');
  const approved = counts.approvedThisWeek > 0;
  return (
    <HomeCard
      to={approved ? `${VIDEOS_PATH}?tab=approved` : VIDEOS_PATH}
      icon={approved ? CircleCheck : Film}
      title={approved ? t('home.approved', { count: counts.approvedThisWeek }) : t('home.inProgress', { count: counts.addedOpen })}
      detail={approved && counts.addedOpen > 0 ? t('home.inProgress', { count: counts.addedOpen }) : undefined}
      action={t('home.open')}
    />
  );
}
