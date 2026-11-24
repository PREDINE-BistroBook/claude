import clsx from 'clsx';
import { Clapperboard, Clock, Drama, Film, Hourglass, Megaphone, Mic, Music, Tv, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CastingStatus, CastingType } from '@shared/enums';
import type { CastingRole } from '@shared/schemas/castings';
import { Badge, useEnumLabel } from '@web/components/ui';
import { deadlineState } from '../utils';

const TYPE_ICONS: Record<CastingType, LucideIcon> = {
  film: Film,
  tv: Tv,
  commercial: Megaphone,
  theatre: Drama,
  music_video: Music,
  voice: Mic,
  other: Clapperboard,
};

/** Tinted square with the casting type's icon; muted once the casting isn't open. */
export function CastingTypeIcon({ type, status, className }: { type: CastingType | null; status: CastingStatus; className?: string }) {
  const Icon = type ? TYPE_ICONS[type] : Clapperboard;
  return (
    <span
      aria-hidden
      className={clsx(
        'flex size-10 shrink-0 items-center justify-center rounded-xl',
        status === 'open' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted',
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** "Closes in 2 days" / "Deadline passed" for open castings near or past their deadline; nothing otherwise. */
export function DeadlineBadge({ casting, className }: { casting: { status: CastingStatus; submissionDeadline: string | null }; className?: string }) {
  const { t } = useTranslation('castings');
  const state = deadlineState(casting);
  if (!state) return null;
  if (state.kind === 'passed')
    return (
      <Badge tone="danger" className={className}>
        <Hourglass className="size-3" aria-hidden />
        {t('deadline.passed')}
      </Badge>
    );
  const label = state.days === 0 ? t('deadline.today') : state.days === 1 ? t('deadline.tomorrow') : t('deadline.inDays', { count: state.days });
  return (
    <Badge tone="warning" className={className}>
      <Clock className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

/** "Age 25–35" / "Age 25+" / "Age up to 35", or '' when the role has no age range. */
export function useAgeRangeLabel() {
  const { t } = useTranslation('castings');
  return (min: number | null, max: number | null): string => {
    if (min != null && max != null) return min === max ? t('roles.ageExact', { age: min }) : t('roles.ageRange', { min, max });
    if (min != null) return t('roles.ageFrom', { min });
    if (max != null) return t('roles.ageUpTo', { max });
    return '';
  };
}

/** Gender and age chips for a role. */
export function RoleRequirementChips({ role, className }: { role: Pick<CastingRole, 'gender' | 'ageMin' | 'ageMax'>; className?: string }) {
  const enumLabel = useEnumLabel();
  const ageLabel = useAgeRangeLabel();
  const chips: ReactNode[] = [];
  if (role.gender) chips.push(<Badge key="g">{enumLabel('gender', role.gender)}</Badge>);
  const age = ageLabel(role.ageMin, role.ageMax);
  if (age)
    chips.push(
      <Badge key="a">
        <bdi>{age}</bdi>
      </Badge>,
    );
  if (!chips.length) return null;
  return <span className={clsx('flex flex-wrap items-center gap-1.5', className)}>{chips}</span>;
}

export { BidiText } from '@web/components/ui';
