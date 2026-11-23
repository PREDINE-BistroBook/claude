import clsx from 'clsx';
import {
  Camera,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  DoorOpen,
  Globe,
  Handshake,
  Mail,
  MessageCircle,
  Music,
  Phone,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { todayISO } from '@shared/dates';
import { INTERVIEW_SCORE_MAX, INTERVIEW_SCORE_MIN, type LeadSource } from '@shared/enums';
import type { AdmissionsCourseOption } from '@shared/schemas/admissions';
import { Field, Input, Select } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { useStaffDirectory } from '../../classes/api';
import { useCalendarFormat } from '../../schedule/format';
import { followUpChoices, followUpTone } from '../utils';

// lucide no longer ships brand logos, so social sources get a plain pictogram.
const SOURCE_ICONS: Record<LeadSource, LucideIcon> = {
  whatsapp: MessageCircle,
  phone_call: Phone,
  email: Mail,
  walk_in: DoorOpen,
  instagram: Camera,
  facebook: ThumbsUp,
  tiktok: Music,
  referral: Handshake,
  google_form: ClipboardList,
  website: Globe,
  other: CircleHelp,
};

export const sourceIcon = (source: LeadSource) => SOURCE_ICONS[source] ?? CircleHelp;

/** Round tile with the source's pictogram (list rows). Decorative: the source is also written out. */
export function SourceTile({ source, className }: { source: LeadSource; className?: string }) {
  const Icon = sourceIcon(source);
  return (
    <span aria-hidden className={clsx('flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted', className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

/** Source pictogram + label inline ("📷 Instagram"). */
export function SourceLabel({ source, className }: { source: LeadSource; className?: string }) {
  const { t } = useTranslation();
  const Icon = sourceIcon(source);
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-1', className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{t(`common:enums.leadSource.${source}`)}</span>
    </span>
  );
}

/** Small toggle pill (quick choices). */
export function Chip({ pressed, className, children, ...rest }: { pressed: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={clsx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
        pressed ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const TONE_TEXT = { danger: 'text-danger', warning: 'text-warning', neutral: 'text-muted' } as const;

/** "3 days overdue" / "Due today" / "Follow up in 5 days", coloured by urgency. */
export function FollowUpLabel({ date, today = todayISO(), className, wrap }: { date: string; today?: string; className?: string; wrap?: boolean }) {
  const { t } = useTranslation('admissions');
  const f = useCalendarFormat();
  const tone = followUpTone(date, today);
  const days = f.daysBetween(today, date);
  const text = days < 0 ? t('followUp.overdue', { count: -days }) : days === 0 ? t('followUp.dueToday') : t('followUp.due', { when: f.relativeDays(date, today) });
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-1 text-xs font-medium', TONE_TEXT[tone], className)} title={f.date(date, 'full')}>
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      <span className={wrap ? 'min-w-0' : 'truncate'}>{text}</span>
    </span>
  );
}

/**
 * Next follow-up date: quick chips (tomorrow, in 3 days, next week, none) and a
 * date field for anything else. '' means no follow-up.
 */
export function FollowUpPicker({ value, onChange, id, label, error, optional }: { value: string; onChange: (v: string) => void; id: string; label?: string; error?: string | null; optional?: boolean }) {
  const { t } = useTranslation('admissions');
  const f = useFormat();
  const today = todayISO();
  return (
    <Field label={label ?? t('fields.nextFollowUpOn')} htmlFor={id} error={error} optional={optional} hint={value ? f.date(value, 'full') : t('followUp.noneHint')}>
      <div role="group" aria-label={t('followUp.quick')} className="flex flex-wrap gap-2">
        {followUpChoices(today).map((c) => (
          <Chip key={c.key} pressed={value === c.date} onClick={() => onChange(c.date)}>
            {t(`followUp.${c.key}`)}
          </Chip>
        ))}
        <Chip pressed={!value} onClick={() => onChange('')}>
          {t('followUp.none')}
        </Chip>
      </div>
      <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="sm:max-w-56" aria-label={t('followUp.pickDate')} />
    </Field>
  );
}

/**
 * Active staff picker (GET /api/staff/directory) for assignees and interviewers.
 * Keeps showing `current` when that person isn't offered (no longer active, or an
 * owner account the directory leaves out for non-owners) so saving doesn't drop them.
 */
export function StaffSelect({
  label,
  emptyLabel,
  current,
  error,
  hint,
  optional,
  ...select
}: {
  label: string;
  emptyLabel: string;
  current?: { id: number; name: string | null } | null;
  error?: string | null;
  hint?: string;
  optional?: boolean;
} & SelectHTMLAttributes<HTMLSelectElement> & { id: string }) {
  const { t } = useTranslation(['admissions', 'common']);
  const directory = useStaffDirectory();
  const active = (directory.data?.items ?? []).filter((s) => s.active);
  const currentMissing = current && current.id && !active.some((s) => s.id === current.id);
  return (
    <Field label={label} htmlFor={select.id} error={error} optional={optional} hint={directory.isError ? t('form.staffError') : hint}>
      <Select {...select} disabled={select.disabled || directory.isPending}>
        <option value="">{directory.isPending ? t('common:states.loading') : emptyLabel}</option>
        {currentMissing && <option value={current.id}>{current.name ?? `#${current.id}`}</option>}
        {active.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** "Class name · Coach" for a class picker option. */
export function courseOptionLabel(c: Pick<AdmissionsCourseOption, 'name' | 'teacherName'>): string {
  return c.teacherName ? `${c.name} · ${c.teacherName}` : c.name;
}

/**
 * Class picker over GET /api/leads/course-options. `current` keeps a class that
 * is no longer offered (archived or ended) visible as the selected value.
 */
export function CourseSelect({
  label,
  emptyLabel,
  options,
  loading,
  current,
  error,
  hint,
  optional,
  ...select
}: {
  label: string;
  emptyLabel: string;
  options: AdmissionsCourseOption[];
  loading?: boolean;
  current?: { id: number; name: string } | null;
  error?: string | null;
  hint?: string;
  optional?: boolean;
} & SelectHTMLAttributes<HTMLSelectElement> & { id: string }) {
  const { t } = useTranslation(['admissions', 'common']);
  const currentMissing = current && !options.some((c) => c.id === current.id);
  return (
    <Field label={label} htmlFor={select.id} error={error} optional={optional} hint={hint}>
      <Select {...select} disabled={select.disabled || loading}>
        <option value="">{loading ? t('common:states.loading') : emptyLabel}</option>
        {currentMissing && <option value={current.id}>{t('form.classNotOffered', { name: current.name })}</option>}
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {courseOptionLabel(c)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** 1–5 segmented control for one interview criterion. Tapping the chosen score again clears it. */
export function ScoreControl({ label, value, onChange, labelledBy }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; labelledBy?: string }) {
  const scores: number[] = [];
  for (let n = INTERVIEW_SCORE_MIN; n <= INTERVIEW_SCORE_MAX; n++) scores.push(n);
  return (
    <div role="radiogroup" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className="grid grid-cols-5 gap-1 rounded-xl bg-surface-2 p-1">
      {scores.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(active ? undefined : n)}
            className={clsx(
              'h-10 rounded-lg text-sm font-semibold tabular-nums transition-colors',
              active ? 'bg-accent text-accent-ink shadow-sm' : 'text-muted hover:bg-surface hover:text-ink',
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** Five small bars showing a 1–5 score (read-only). */
export function ScoreBar({ value, label }: { value: number; label: string }) {
  const bars: number[] = [];
  for (let n = INTERVIEW_SCORE_MIN; n <= INTERVIEW_SCORE_MAX; n++) bars.push(n);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
      {bars.map((n) => (
        <span key={n} className={clsx('h-2 w-3.5 rounded-sm', n <= value ? 'bg-accent' : 'bg-line-strong/60')} />
      ))}
    </span>
  );
}
