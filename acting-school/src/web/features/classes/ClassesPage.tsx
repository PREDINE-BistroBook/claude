import clsx from 'clsx';
import { CalendarClock, Check, GraduationCap, MapPin, UserRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { CourseStatus } from '@shared/enums';
import type { CourseListItem } from '@shared/schemas/courses';
import { Badge, EmptyState, ErrorState, PageHeader, PageLoader, SearchInput, Segmented, StatusBadge } from '@web/components/ui';
import { ScreenAddAction, ScreenEmptyAdd } from '@web/layout/ScreenAdd';
import { useAuth } from '@web/lib/auth';
import { courseColor } from '@web/lib/colors';
import { useFormat } from '@web/lib/format';
import { useCourses, useWeekStart } from './api';
import { PersonAvatar } from '../team/components/PersonAvatar';
import { ColorDot } from './components/CourseColor';
import { scheduleLines } from './utils';

export default function ClassesPage() {
  const { t } = useTranslation('classes');
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  // Without classes.all the API only answers your own classes (taught, covered or created), so there's nothing to toggle.
  const seesAll = can('classes.all');
  const status: CourseStatus = params.get('status') === 'archived' ? 'archived' : 'active';
  // People who see every class can narrow it to their own with ?mine=1.
  const mine = seesAll && params.get('mine') === '1';
  const [q, setQ] = useState('');

  const courses = useCourses({ status, teacherId: mine ? user?.id : undefined });

  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const items = useMemo(() => {
    const all = courses.data?.items ?? [];
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) return all;
    return all.filter((c) => c.name.toLocaleLowerCase().includes(needle) || (c.teacherName ?? '').toLocaleLowerCase().includes(needle));
  }, [courses.data, q]);

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={courses.data ? t('list.count', { count: courses.data.items.length }) : undefined}
        documentTitle={t('title')}
        actions={<ScreenAddAction screen="classes" />}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<CourseStatus>
            label={t('list.statusFilter')}
            value={status}
            onChange={(v) => setParam('status', v === 'active' ? null : v)}
            options={[
              { value: 'active', label: t('common:enums.courseStatus.active') },
              { value: 'archived', label: t('common:enums.courseStatus.archived') },
            ]}
          />
          {seesAll && (
            <button
              type="button"
              aria-pressed={mine}
              onClick={() => setParam('mine', mine ? null : '1')}
              className={clsx(
                'inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors',
                mine ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface text-muted hover:text-ink',
              )}
            >
              {mine && <Check className="size-4" aria-hidden />}
              {t('list.myClasses')}
            </button>
          )}
        </div>
        {(courses.data?.items.length ?? 0) > 0 && (
          <SearchInput value={q} onChange={setQ} placeholder={t('list.searchPlaceholder')} className="sm:w-72" />
        )}
      </div>

      {courses.isPending ? (
        <PageLoader />
      ) : courses.isError ? (
        <ErrorState error={courses.error} onRetry={() => void courses.refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          {q.trim() ? (
            <EmptyState title={t('common:states.noResults')} description={t('common:states.noResultsHint')} />
          ) : mine ? (
            <EmptyState icon={GraduationCap} title={t('list.emptyMine')} description={t('list.emptyMineHint')} />
          ) : status === 'archived' ? (
            <EmptyState icon={GraduationCap} title={t('list.emptyArchived')} />
          ) : !seesAll ? (
            <EmptyState icon={GraduationCap} title={t('list.emptyOwn')} description={t('list.emptyOwnHint')} />
          ) : (
            <EmptyState
              icon={GraduationCap}
              title={t('list.emptyTitle')}
              description={t('list.emptyHint')}
              action={<ScreenEmptyAdd screen="classes" />}
            />
          )}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((c) => (
            <li key={c.id}>
              <CourseCard course={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ course: c }: { course: CourseListItem }) {
  const { t } = useTranslation('classes');
  const f = useFormat();
  const weekStart = useWeekStart();
  const lines = scheduleLines(c.schedule, f, weekStart);

  return (
    <Link
      to={`/classes/${c.id}`}
      className={clsx(
        'flex h-full flex-col gap-3 rounded-2xl border border-line border-s-4 bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2/50 sm:p-5',
        courseColor(c.color).bar,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-ink">
            <ColorDot color={c.color} />
            <span className="truncate">{c.name}</span>
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {c.level && <Badge>{t(`common:enums.courseLevel.${c.level}`)}</Badge>}
            {c.status === 'archived' && <StatusBadge group="courseStatus" value="archived" />}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-sm text-muted" title={t('fields.enrolled')}>
          <Users className="size-4" aria-hidden />
          <span className="tabular-nums">
            {c.capacity !== null ? t('list.seats', { enrolled: c.enrolledCount, capacity: c.capacity }) : c.enrolledCount}
          </span>
          <span className="sr-only">{t('fields.enrolled')}</span>
        </div>
      </div>

      <dl className="grid gap-1.5 text-sm">
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t('fields.schedule')}</dt>
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <dd className="min-w-0 text-ink">
            {lines.length ? lines.map((l) => <div key={l}>{l}</div>) : <span className="text-muted">{t('list.noSchedule')}</span>}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt className="sr-only">{t('fields.teacher')}</dt>
          {c.teacherName ? (
            <PersonAvatar userId={c.teacherId} name={c.teacherName} size="xs" className="mt-px" />
          ) : (
            <UserRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          )}
          <dd className={clsx('min-w-0 truncate', c.teacherName ? 'text-ink' : 'text-muted')}>{c.teacherName ?? t('list.noTeacher')}</dd>
        </div>
        {c.room && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">{t('fields.room')}</dt>
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <dd className="min-w-0 truncate text-ink">{c.room}</dd>
          </div>
        )}
      </dl>

      <div className="mt-auto border-t border-line pt-3 text-sm">
        {c.nextSession ? (
          <span className="text-muted">
            {t('list.next')}{' '}
            <span className="font-medium text-ink">
              {f.date(c.nextSession.date, 'weekday')} · {f.time(c.nextSession.startTime)}
            </span>
          </span>
        ) : (
          <span className="text-muted">{t('list.noUpcoming')}</span>
        )}
      </div>
    </Link>
  );
}
