import clsx from 'clsx';
import { Clapperboard, MapPin, UserRoundSearch, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AuditionEvent, ClassEvent, InterviewEvent, ScheduleEvent } from '@shared/schemas/schedule';
import { DataLine, StatusBadge } from '@web/components/ui';
import { courseColor } from '@web/lib/colors';
import { useFormat } from '@web/lib/format';
import { DataText } from './DataText';

/** On the accent-tinted audition card an accent badge would vanish: outline every badge in its own colour. */
const ON_TINT = 'ring-1 ring-inset ring-current/25';

export type Density = 'compact' | 'comfortable';

/**
 * One calendar entry. `compact` fits the narrow desktop day columns;
 * `comfortable` is the phone agenda row (time on the start side).
 */
export function EventCard({ event, density }: { event: ScheduleEvent; density: Density }) {
  if (event.kind === 'class') return <ClassCard event={event} density={density} />;
  if (event.kind === 'interview') return <InterviewCard event={event} density={density} />;
  return <AuditionCard event={event} density={density} />;
}

function ClassCard({ event: e, density }: { event: ClassEvent; density: Density }) {
  const { t } = useTranslation(['schedule', 'common']);
  const f = useFormat();
  const cancelled = e.status === 'cancelled';
  const place = e.room || e.teacherName ? [e.room, e.teacherName] : null;
  const base = clsx(
    'group block border border-line border-s-4 bg-surface transition-colors hover:bg-surface-2 focus-visible:bg-surface-2',
    courseColor(e.color).bar,
    cancelled && 'opacity-70',
  );

  if (density === 'compact') {
    return (
      <Link to={`/sessions/${e.id}`} className={clsx(base, 'rounded-lg px-2 py-1.5 text-xs shadow-[0_1px_2px_rgb(0_0_0/0.04)]')}>
        <span className="block text-muted tabular-nums">
          <span className="whitespace-nowrap">{f.time(e.startTime)}</span> – <span className="whitespace-nowrap">{f.time(e.endTime)}</span>
        </span>
        <span className={clsx('mt-0.5 block text-[13px] font-medium leading-snug text-ink break-words', cancelled && 'line-through')}>
          <bdi>{e.title}</bdi>
        </span>
        {place && <DataLine parts={place} className="mt-0.5 text-muted" />}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          <span className="inline-flex items-center gap-1" title={t('event.enrolled', { count: e.enrolledCount })}>
            <Users className="size-3" aria-hidden />
            <span className="tabular-nums" aria-hidden>
              {f.number(e.enrolledCount)}
            </span>
            <span className="sr-only">{t('event.enrolled', { count: e.enrolledCount })}</span>
          </span>
          {cancelled && <StatusBadge group="sessionStatus" value="cancelled" className="px-1.5 text-[11px]" />}
        </span>
      </Link>
    );
  }

  return (
    <Link to={`/sessions/${e.id}`} className={clsx(base, 'flex gap-3 rounded-2xl p-3')}>
      <span className="w-16 shrink-0 tabular-nums">
        <span className="block text-sm font-semibold text-ink">{f.time(e.startTime)}</span>
        <span className="block text-xs text-muted">{f.time(e.endTime)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={clsx('min-w-0 font-medium leading-snug text-ink break-words', cancelled && 'line-through')}>
            <bdi>{e.title}</bdi>
          </span>
          {cancelled && <StatusBadge group="sessionStatus" value="cancelled" className="shrink-0" />}
        </span>
        {place && <DataLine parts={place} className="mt-0.5 text-sm text-muted" />}
        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Users className="size-3.5" aria-hidden />
          {t('event.enrolled', { count: e.enrolledCount })}
        </span>
      </span>
    </Link>
  );
}

function AuditionCard({ event: e, density }: { event: AuditionEvent; density: Density }) {
  const { t } = useTranslation(['schedule', 'common']);
  const f = useFormat();
  const base = 'group block border border-accent/20 bg-accent-soft transition-colors hover:border-accent/40 focus-visible:border-accent/40';
  const what = `${e.title} · ${e.roleName}`;

  if (density === 'compact') {
    return (
      <Link to={`/castings/${e.castingId}`} className={clsx(base, 'rounded-lg px-2 py-1.5 text-xs')}>
        <span className="flex items-center gap-1 text-accent">
          <Clapperboard className="size-3 shrink-0" aria-hidden />
          <span className="tabular-nums">{f.time(e.startTime)}</span>
          <span className="sr-only">{t('event.audition')}</span>
        </span>
        <span className="mt-0.5 block text-[13px] font-medium leading-snug text-ink break-words">
          <bdi>{e.talentName}</bdi>
        </span>
        <span className="mt-0.5 block text-ink/75 break-words">
          <bdi>{what}</bdi>
        </span>
        {e.location && <DataText className="mt-0.5 text-muted">{e.location}</DataText>}
        <StatusBadge group="submissionStatus" value={e.status} className={clsx('mt-1 px-1.5 text-[11px]', ON_TINT)} />
      </Link>
    );
  }

  return (
    <Link to={`/castings/${e.castingId}`} className={clsx(base, 'flex gap-3 rounded-2xl p-3')}>
      <span className="w-16 shrink-0 tabular-nums">
        <span className="block text-sm font-semibold text-ink">{f.time(e.startTime)}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent">
          <Clapperboard className="size-3.5" aria-hidden />
          {t('event.audition')}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium leading-snug text-ink break-words">
            <bdi>{e.talentName}</bdi>
          </span>
          <StatusBadge group="submissionStatus" value={e.status} className={clsx('shrink-0', ON_TINT)} />
        </span>
        <span className="mt-0.5 block text-sm text-ink/75 break-words">
          <bdi>{what}</bdi>
        </span>
        {e.location && (
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <DataText>{e.location}</DataText>
          </span>
        )}
      </span>
    </Link>
  );
}

/** An admissions interview: the person's name, time, room and interviewer; opens the enquiry. */
function InterviewCard({ event: e, density }: { event: InterviewEvent; density: Density }) {
  const { t } = useTranslation(['schedule', 'common']);
  const f = useFormat();
  const base = 'group block border border-line border-s-4 border-s-info bg-info-soft/40 transition-colors hover:bg-info-soft focus-visible:bg-info-soft';
  const place = e.room || e.interviewerName ? [e.room, e.interviewerName && t('event.interviewWith', { name: e.interviewerName })] : null;
  const settled = e.status !== 'scheduled';
  const to = `/admissions/${e.leadId}`;

  if (density === 'compact') {
    return (
      <Link to={to} className={clsx(base, 'rounded-lg px-2 py-1.5 text-xs')}>
        <span className="flex items-center gap-1 text-info">
          <UserRoundSearch className="size-3 shrink-0" aria-hidden />
          <span className="tabular-nums">{f.time(e.startTime)}</span>
          <span className="sr-only">{t('event.interview')}</span>
        </span>
        <span className="mt-0.5 block text-[13px] font-medium leading-snug text-ink break-words">
          <bdi>{e.title}</bdi>
        </span>
        {place && <DataLine parts={place} className="mt-0.5 text-muted" />}
        {settled && <StatusBadge group="interviewStatus" value={e.status} className="mt-1 px-1.5 text-[11px]" />}
      </Link>
    );
  }

  return (
    <Link to={to} className={clsx(base, 'flex gap-3 rounded-2xl p-3')}>
      <span className="w-16 shrink-0 tabular-nums">
        <span className="block text-sm font-semibold text-ink">{f.time(e.startTime)}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-info">
          <UserRoundSearch className="size-3.5" aria-hidden />
          {t('event.interview')}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium leading-snug text-ink break-words">
            <bdi>{e.title}</bdi>
          </span>
          {settled && <StatusBadge group="interviewStatus" value={e.status} className="shrink-0" />}
        </span>
        <span className="mt-0.5 block text-xs text-muted tabular-nums">{f.timeRange(e.startTime, e.endTime)}</span>
        {place && <DataLine parts={place} className="mt-0.5 text-sm text-muted" />}
      </span>
    </Link>
  );
}
