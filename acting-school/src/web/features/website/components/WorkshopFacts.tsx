import { CalendarDays, Clock, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SiteWorkshop } from '@shared/schemas/site';
import { useEnumLabel } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { useWeekStart } from '../../classes/api';
import { scheduleLines } from '../../classes/utils';

/**
 * The facts the public page shows for a workshop: dates, days and times, coach
 * (and level). No fees — the website never shows them.
 */
export function WorkshopFacts({ workshop: w, className }: { workshop: SiteWorkshop; className?: string }) {
  const { t } = useTranslation(['website', 'common']);
  const f = useFormat();
  const enumLabel = useEnumLabel();
  const weekStart = useWeekStart();
  const times = scheduleLines(w.schedule, f, weekStart);
  return (
    <ul className={className ?? 'grid gap-1.5 text-sm text-muted'}>
      <li className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {t('workshops.dates', { start: f.date(w.startDate), end: f.date(w.endDate) })}
          {w.level && ` · ${enumLabel('courseLevel', w.level)}`}
        </span>
      </li>
      <li className="flex items-start gap-2">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{times.length ? times.join(' · ') : t('workshops.noTimes')}</span>
      </li>
      <li className="flex items-start gap-2">
        <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{w.teacherName ? t('workshops.coach', { name: w.teacherName }) : t('workshops.noCoach')}</span>
      </li>
    </ul>
  );
}
