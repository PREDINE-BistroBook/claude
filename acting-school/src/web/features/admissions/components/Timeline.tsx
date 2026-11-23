import clsx from 'clsx';
import { ArrowRight, ArrowRightLeft, CalendarCheck, CalendarPlus, CalendarX, GraduationCap, History, UserX, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeadActivityType } from '@shared/enums';
import type { LeadActivity } from '@shared/schemas/admissions';
import { EmptyState, StatusBadge } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { CONTACT_ICONS } from './LogContactModal';

const ICONS: Record<LeadActivityType, LucideIcon> = {
  ...CONTACT_ICONS,
  status_change: ArrowRightLeft,
  interview_scheduled: CalendarPlus,
  interview_recorded: CalendarCheck,
  enrolled: GraduationCap,
};

/** Tint of the round icon: things people did are neutral, what the app recorded is coloured. */
const TONES: Partial<Record<LeadActivityType, string>> = {
  status_change: 'bg-info-soft text-info',
  interview_scheduled: 'bg-warning-soft text-warning',
  interview_recorded: 'bg-warning-soft text-warning',
  enrolled: 'bg-success-soft text-success',
};

/** The lead's history, newest first. */
export function Timeline({ activities }: { activities: LeadActivity[] }) {
  const { t } = useTranslation('admissions');
  if (!activities.length) return <EmptyState icon={History} title={t('timeline.empty')} className="py-8" />;
  return (
    <ol className="relative grid gap-4 before:absolute before:inset-y-2 before:start-[1.0625rem] before:w-px before:bg-line">
      {activities.map((a) => (
        <TimelineItem key={a.id} activity={a} />
      ))}
    </ol>
  );
}

function TimelineItem({ activity: a }: { activity: LeadActivity }) {
  const { t } = useTranslation(['admissions', 'common']);
  const f = useFormat();
  const m = a.meta ?? {};
  let Icon = ICONS[a.type];
  let tone = TONES[a.type];
  let title: ReactNode = t(`common:enums.leadActivityType.${a.type}`);
  let detail: ReactNode = null;

  switch (a.type) {
    case 'status_change':
      title = t('timeline.statusChange');
      detail =
        m.from && m.to ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge group="leadStatus" value={m.from} />
            <ArrowRight className="size-3.5 text-muted rtl:-scale-x-100" aria-hidden />
            <StatusBadge group="leadStatus" value={m.to} />
            {m.to === 'lost' && m.lostReason && <span className="text-muted">· {t(`common:enums.leadLostReason.${m.lostReason}`)}</span>}
          </span>
        ) : null;
      break;
    case 'interview_scheduled':
      title = m.previousScheduledAt ? t('timeline.interviewMoved') : t('timeline.interviewScheduled');
      if (m.scheduledAt)
        detail = m.previousScheduledAt
          ? t('timeline.movedFromTo', { from: f.dateTime(m.previousScheduledAt), to: f.dateTime(m.scheduledAt) })
          : f.dateTime(m.scheduledAt, 'full');
      break;
    case 'interview_recorded':
      if (m.interviewStatus === 'no_show') {
        Icon = UserX;
        tone = 'bg-danger-soft text-danger';
        title = t('timeline.noShow');
      } else if (m.interviewStatus === 'cancelled') {
        Icon = CalendarX;
        tone = 'bg-surface-2 text-muted';
        title = t('timeline.interviewCancelled');
      } else title = t('timeline.interviewDone');
      detail = (
        <span className="flex flex-wrap items-center gap-1.5">
          {m.scheduledAt && <span>{f.dateTime(m.scheduledAt)}</span>}
          {m.recommendation && (
            <>
              <span className="text-muted">· {t('timeline.recommendation')}</span>
              <StatusBadge group="interviewRecommendation" value={m.recommendation} />
            </>
          )}
        </span>
      );
      break;
    case 'enrolled':
      title = m.courseName ? t('timeline.enrolledIn', { course: m.courseName }) : t('common:enums.leadActivityType.enrolled');
      detail = m.linkedExistingStudent ? t('timeline.linkedExisting') : t('timeline.createdStudent');
      break;
  }

  const followUp =
    m.nextFollowUpOn !== undefined ? (m.nextFollowUpOn ? t('timeline.followUpSet', { date: f.date(m.nextFollowUpOn, 'weekday') }) : t('timeline.followUpCleared')) : null;

  return (
    <li className="relative flex gap-3">
      <span className={clsx('relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', tone ?? 'bg-surface-2 text-ink')}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <p className="text-sm font-medium text-ink">
          <bdi>{title}</bdi>
        </p>
        {detail && <div className="mt-1 text-sm text-ink/80">{detail}</div>}
        {a.body && (
          <p dir="auto" className="mt-1 text-start text-sm leading-relaxed whitespace-pre-line break-words text-ink">
            {a.body}
          </p>
        )}
        {followUp && <p className="mt-1 text-xs text-muted">{followUp}</p>}
        <p className="mt-1 text-xs text-muted">
          {a.createdByName ? (
            <>
              <bdi>{a.createdByName}</bdi> · {f.timestampTime(a.createdAt)}
            </>
          ) : (
            f.timestampTime(a.createdAt)
          )}
        </p>
      </div>
    </li>
  );
}
