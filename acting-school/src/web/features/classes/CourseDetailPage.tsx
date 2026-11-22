import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CircleAlert, Ellipsis, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { todayISO } from '@shared/dates';
import type { EnrollmentStatus } from '@shared/enums';
import type { ClassSession, CourseDetail, CourseEnrollment } from '@shared/schemas/courses';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ErrorState,
  IconButton,
  List,
  ListRow,
  Modal,
  PageHeader,
  PageLoader,
  Segmented,
  StatusBadge,
  Tabs,
  useToast,
} from '@web/components/ui';
import { api } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { classesErrorKey, useCourse, useInvalidateClasses, useWeekStart } from './api';
import { AddStudentModal } from './components/AddStudentModal';
import { CourseTile } from './components/CourseColor';
import { SessionFormModal } from './components/SessionFormModal';
import { isPast, needsAttendance, rateTone, scheduleLines } from './utils';

type Tab = 'students' | 'sessions';

export default function CourseDetailPage() {
  const { t } = useTranslation('classes');
  const id = Number(useParams().id);
  const course = useCourse(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'sessions' ? 'sessions' : 'students';
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete(`/courses/${id}`),
    onSuccess: () => {
      invalidate({ students: true });
      toast.success(t('detail.deleted'));
      navigate('/classes', { replace: true });
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(t(classesErrorKey(err)));
    },
  });

  if (course.isPending) return <PageLoader />;
  if (course.isError) return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  const c = course.data;
  const canWrite = can('courses.write');
  const enrolled = c.enrollments.filter((e) => e.status === 'enrolled').length;

  return (
    <div>
      <PageHeader
        back="/classes"
        leading={<CourseTile color={c.color} />}
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {c.level && <Badge>{t(`common:enums.courseLevel.${c.level}`)}</Badge>}
            <StatusBadge group="courseStatus" value={c.status} />
          </span>
        }
        actions={
          canWrite && (
            <>
              <ButtonLink to={`/classes/${c.id}/edit`} icon={Pencil}>
                {t('common:actions.edit')}
              </ButtonLink>
              <IconButton icon={Trash2} label={t('detail.delete')} variant="danger-ghost" onClick={() => setConfirmDelete(true)} />
            </>
          )
        }
      />

      <div className="grid gap-5">
        <InfoCard course={c} enrolled={enrolled} />

        <div>
          <Tabs<Tab>
            value={tab}
            onChange={(v) => setParams(v === 'students' ? {} : { tab: v }, { replace: true })}
            tabs={[
              { id: 'students', label: t('detail.tabStudents'), count: enrolled },
              { id: 'sessions', label: t('detail.tabSessions'), count: c.sessions.length },
            ]}
          />
          <div className="mt-4" role="tabpanel">
            {tab === 'students' ? <StudentsTab course={c} canWrite={canWrite} /> : <SessionsTab course={c} canWrite={canWrite} />}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('detail.deleteTitle')}
        message={t('detail.deleteMessage', { name: c.name })}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function InfoCard({ course: c, enrolled }: { course: CourseDetail; enrolled: number }) {
  const { t } = useTranslation('classes');
  const f = useFormat();
  const weekStart = useWeekStart();
  const lines = scheduleLines(c.schedule, f, weekStart);
  return (
    <Card>
      <DescriptionList
        columns={3}
        items={[
          { label: t('fields.teacher'), value: c.teacherName },
          { label: t('fields.room'), value: c.room },
          {
            label: t('fields.enrolled'),
            value: c.capacity !== null ? t('detail.enrolledOf', { enrolled, capacity: c.capacity }) : t('detail.enrolledNoLimit', { enrolled }),
          },
          {
            label: t('fields.schedule'),
            value: lines.length ? lines.map((l) => <div key={l}>{l}</div>) : <span className="text-muted">{t('list.noSchedule')}</span>,
          },
          { label: t('fields.dates'), value: t('detail.dateRange', { start: f.date(c.startDate), end: f.date(c.endDate) }) },
          {
            label: t('fields.nextSession'),
            value: c.nextSession ? (
              <Link to={`/sessions/${c.nextSession.id}`} className="font-medium text-accent hover:underline">
                {f.date(c.nextSession.date, 'weekday')} · {f.time(c.nextSession.startTime)}
              </Link>
            ) : (
              <span className="text-muted">{t('list.noUpcoming')}</span>
            ),
          },
          ...(c.description ? [{ label: t('fields.description'), value: <p className="whitespace-pre-line">{c.description}</p>, wide: true }] : []),
        ]}
      />
    </Card>
  );
}

// ── Students ────────────────────────────────────────────────────────────────

function StudentsTab({ course, canWrite }: { course: CourseDetail; canWrite: boolean }) {
  const { t } = useTranslation('classes');
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<CourseEnrollment | null>(null);
  const current = course.enrollments.filter((e) => e.status === 'enrolled');
  const former = course.enrollments.filter((e) => e.status !== 'enrolled');

  return (
    <div className="grid gap-4">
      {canWrite && course.enrollments.length > 0 && (
        <div className="flex justify-end">
          <Button icon={UserPlus} onClick={() => setAdding(true)}>
            {t('students.add')}
          </Button>
        </div>
      )}
      {course.enrollments.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState
            icon={Users}
            title={t('students.empty')}
            description={t('students.emptyHint')}
            action={
              canWrite && (
                <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
                  {t('students.add')}
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          {current.length > 0 ? (
            <EnrollmentList items={current} canWrite={canWrite} onActions={setActing} />
          ) : (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">{t('students.noneCurrent')}</p>
          )}
          {former.length > 0 && (
            <section>
              <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">{t('students.former')}</h3>
              <EnrollmentList items={former} canWrite={canWrite} onActions={setActing} />
            </section>
          )}
        </>
      )}
      <AddStudentModal open={adding} onClose={() => setAdding(false)} course={course} />
      <EnrollmentActions courseId={course.id} enrollment={acting} onClose={() => setActing(null)} />
    </div>
  );
}

function EnrollmentList({ items, canWrite, onActions }: { items: CourseEnrollment[]; canWrite: boolean; onActions: (e: CourseEnrollment) => void }) {
  const { t } = useTranslation('classes');
  const f = useFormat();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {items.map((e) => {
        const name = fullName(e);
        return (
          <li key={e.id} className="flex items-center gap-1 pe-2 sm:pe-3">
            <Link to={`/students/${e.studentId}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5">
              <Avatar name={name} fileId={e.photoFileId} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{name}</div>
                <div className="mt-0.5 truncate text-sm text-muted">{t('students.since', { date: f.date(e.enrolledOn) })}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                {e.attendanceRate !== null ? (
                  <Badge tone={rateTone(e.attendanceRate)} className="tabular-nums">
                    <span className="sr-only">{t('students.attendanceLabel')}</span>
                    {f.percent(e.attendanceRate)}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted">{t('students.noRate')}</span>
                )}
                {e.status !== 'enrolled' && <StatusBadge group="enrollmentStatus" value={e.status} />}
              </div>
            </Link>
            {canWrite && <IconButton icon={Ellipsis} label={t('students.actionsFor', { name })} onClick={() => onActions(e)} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Bottom sheet (phones) / small dialog with what can be done to one enrollment. */
function EnrollmentActions({ courseId, enrollment, onClose }: { courseId: number; enrollment: CourseEnrollment | null; onClose: () => void }) {
  const { t } = useTranslation('classes');
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const [confirmRemove, setConfirmRemove] = useState<CourseEnrollment | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ e, status }: { e: CourseEnrollment; status: EnrollmentStatus }) => api.patch(`/courses/${courseId}/enrollments/${e.id}`, { status }),
    onSuccess: () => {
      invalidate({ students: true });
      toast.success(t('students.updated'));
      onClose();
    },
    onError: (err) => toast.error(t(classesErrorKey(err))),
  });
  const remove = useMutation({
    mutationFn: (e: CourseEnrollment) => api.delete(`/courses/${courseId}/enrollments/${e.id}`),
    onSuccess: () => {
      invalidate({ students: true });
      toast.success(t('students.removed'));
      setConfirmRemove(null);
    },
    onError: (err) => {
      setConfirmRemove(null);
      toast.error(t(classesErrorKey(err)));
    },
  });

  const e = enrollment;
  const actions: { status: EnrollmentStatus; label: string }[] = e
    ? (
        [
          { status: 'enrolled', label: t('students.reenroll') },
          { status: 'completed', label: t('students.markCompleted') },
          { status: 'withdrawn', label: t('students.markWithdrawn') },
        ] as const
      ).filter((a) => a.status !== e.status)
    : [];

  return (
    <>
      <Modal open={!!e} onClose={onClose} size="sm" title={e ? fullName(e) : ''} description={e ? <StatusBadge group="enrollmentStatus" value={e.status} /> : undefined}>
        {e && (
          <div className="grid gap-2">
            {actions.map((a) => (
              <Button
                key={a.status}
                size="lg"
                className="w-full justify-start"
                loading={setStatus.isPending && setStatus.variables?.status === a.status}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ e, status: a.status })}
              >
                {a.label}
              </Button>
            ))}
            <ButtonLink to={`/students/${e.studentId}`} size="lg" variant="ghost" className="w-full justify-start">
              {t('students.viewProfile')}
            </ButtonLink>
            <Button
              size="lg"
              variant="danger-ghost"
              icon={Trash2}
              className="w-full justify-start"
              onClick={() => {
                setConfirmRemove(e);
                onClose();
              }}
            >
              {t('students.remove')}
            </Button>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!confirmRemove}
        title={t('students.removeTitle')}
        message={confirmRemove ? t('students.removeMessage', { name: fullName(confirmRemove) }) : ''}
        confirmLabel={t('common:actions.remove')}
        loading={remove.isPending}
        onConfirm={() => confirmRemove && remove.mutate(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  );
}

// ── Sessions ────────────────────────────────────────────────────────────────

const PAGE = 20;

function SessionsTab({ course, canWrite }: { course: CourseDetail; canWrite: boolean }) {
  const { t } = useTranslation('classes');
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);

  const { upcoming, past } = useMemo(() => {
    const up: ClassSession[] = [];
    const done: ClassSession[] = [];
    for (const s of course.sessions) (isPast(s) ? done : up).push(s);
    return { upcoming: up, past: done.reverse() };
  }, [course.sessions]);
  const list = when === 'upcoming' ? upcoming : past;
  const missing = past.filter((s) => needsAttendance(s)).length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('detail.tabSessions')}
          value={when}
          onChange={(v) => {
            setWhen(v);
            setLimit(PAGE);
          }}
          options={[
            { value: 'upcoming', label: `${t('sessions.upcoming')} · ${upcoming.length}` },
            { value: 'past', label: `${t('sessions.past')} · ${past.length}` },
          ]}
        />
        {canWrite && (
          <Button icon={Plus} onClick={() => setAdding(true)}>
            {t('sessions.add')}
          </Button>
        )}
      </div>
      {when === 'past' && missing > 0 && (
        <p className="flex items-center gap-2 text-sm text-warning">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {t('sessions.missingCount', { count: missing })}
        </p>
      )}
      {list.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState title={t(when === 'upcoming' ? 'sessions.emptyUpcoming' : 'sessions.emptyPast')} />
        </div>
      ) : (
        <>
          <List>
            {list.slice(0, limit).map((s) => (
              <SessionRow key={s.id} session={s} course={course} />
            ))}
          </List>
          {list.length > limit && (
            <div className="flex justify-center">
              <Button variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>
                {t('sessions.showMore', { count: list.length - limit })}
              </Button>
            </div>
          )}
        </>
      )}
      <SessionFormModal open={adding} onClose={() => setAdding(false)} course={course} defaultDate={todayISO()} />
    </div>
  );
}

function SessionRow({ session: s, course }: { session: ClassSession; course: CourseDetail }) {
  const { t } = useTranslation('classes');
  const f = useFormat();
  const day = Number(s.date.slice(8, 10));
  const sub = s.teacherId !== course.teacherId && s.teacherName;
  const details = [s.topic, s.room !== course.room ? s.room : null, sub ? t('sessions.withTeacher', { name: s.teacherName }) : null].filter(Boolean);
  return (
    <ListRow
      to={`/sessions/${s.id}`}
      leading={
        <span
          className={clsx(
            'flex size-11 flex-col items-center justify-center rounded-xl leading-none',
            s.status === 'cancelled' ? 'bg-surface-2 text-muted line-through' : 'bg-accent-soft text-accent',
          )}
          aria-hidden
        >
          <span className="text-[10px] font-medium uppercase">{f.date(s.date, 'weekdayShort')}</span>
          <span className="mt-0.5 text-base font-semibold tabular-nums">{f.number(day)}</span>
        </span>
      }
      title={
        <span className={clsx(s.status === 'cancelled' && 'text-muted')}>
          {f.date(s.date, 'weekday')} · {f.timeRange(s.startTime, s.endTime)}
        </span>
      }
      subtitle={details.length ? details.join(' · ') : undefined}
      trailing={
        <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
          {s.status === 'cancelled' && <StatusBadge group="sessionStatus" value="cancelled" />}
          {s.extra && <Badge tone="info">{t('sessions.extra')}</Badge>}
          {s.attendanceTaken ? (
            <Badge tone="success">
              <Check className="size-3" aria-hidden />
              <span className="max-sm:sr-only">{t('sessions.attendanceTaken')}</span>
            </Badge>
          ) : needsAttendance(s) ? (
            <Badge tone="warning">{t('sessions.needsAttendance')}</Badge>
          ) : null}
        </span>
      }
    />
  );
}
