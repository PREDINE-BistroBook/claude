import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, CheckCheck, ChevronLeft, ChevronRight, Info, Pencil, RotateCcw, StickyNote, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@shared/enums';
import type { CourseDetail, SessionDetail } from '@shared/schemas/courses';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormActions,
  Input,
  List,
  ListRow,
  PageHeader,
  PageLoader,
  StatusBadge,
  useToast,
} from '@web/components/ui';
import { api } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { fullName, useFormat } from '@web/lib/format';
import { classesErrorKey, keys, useCourse, useInvalidateClasses, useSession } from './api';
import { AttendanceControl } from './components/AttendanceControl';
import { CourseTile } from './components/CourseColor';
import { InfoGrid } from './components/InfoGrid';
import { SessionFormModal } from './components/SessionFormModal';

export default function SessionPage() {
  const { t } = useTranslation('classes');
  const f = useFormat();
  const id = Number(useParams().id);
  const session = useSession(id);
  const course = useCourse(session.data?.courseId ?? 0, !!session.data);
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const setStatus = useMutation({
    mutationFn: (status: 'scheduled' | 'cancelled') => api.patch(`/sessions/${id}`, { status }),
    onSuccess: (_r, status) => {
      invalidate();
      setConfirmCancel(false);
      toast.success(t(status === 'cancelled' ? 'session.cancelledToast' : 'session.restoredToast'));
    },
    onError: (err) => {
      setConfirmCancel(false);
      toast.error(t(classesErrorKey(err)));
    },
  });

  if (session.isPending) return <PageLoader />;
  if (session.isError) return <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  const s = session.data;
  const c = course.data;
  const canWrite = can('courses.write');
  const cancelled = s.status === 'cancelled';
  const courseTeacherId = c?.teacherId;
  const isSubstitute = c !== undefined && s.teacherId !== null && s.teacherId !== courseTeacherId;

  return (
    <div>
      <PageHeader
        back={`/classes/${s.courseId}`}
        leading={<CourseTile color={s.color} />}
        documentTitle={`${s.courseName} · ${f.date(s.date, 'short')}`}
        title={
          <Link to={`/classes/${s.courseId}`} className="hover:underline">
            {s.courseName}
          </Link>
        }
        subtitle={
          <span className="grid gap-1">
            <span className="font-medium text-ink">{f.date(s.date, 'full')}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="me-1">{f.timeRange(s.startTime, s.endTime)}</span>
              <StatusBadge group="sessionStatus" value={s.status} />
              {s.extra && <Badge tone="info">{t('sessions.extra')}</Badge>}
            </span>
          </span>
        }
        actions={
          canWrite && (
            <>
              <Button icon={Pencil} onClick={() => setEditing(true)} disabled={!c}>
                {t('common:actions.edit')}
              </Button>
              {cancelled ? (
                <Button icon={RotateCcw} loading={setStatus.isPending} onClick={() => setStatus.mutate('scheduled')}>
                  {t('session.restore')}
                </Button>
              ) : (
                <Button icon={Ban} variant="danger-ghost" onClick={() => setConfirmCancel(true)}>
                  {t('session.cancel')}
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-5">
        {c && <SessionNav course={c} sessionId={s.id} />}

        <Card>
          <InfoGrid
            items={[
              {
                label: t('fields.teacher'),
                value: s.teacherName ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {s.teacherName}
                    {isSubstitute && <Badge tone="warning">{t('sessions.substitute')}</Badge>}
                  </span>
                ) : null,
              },
              { label: t('fields.room'), value: s.room },
              { label: t('fields.topic'), value: s.topic, span: 'row' },
              ...(s.notes ? [{ label: t('fields.notes'), value: <p dir="auto" className="text-start whitespace-pre-line break-words">{s.notes}</p>, span: 'full' as const }] : []),
            ]}
          />
        </Card>

        {cancelled && (
          <div role="status" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
            <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('session.cancelledBanner')}</span>
          </div>
        )}

        {s.canMarkAttendance ? (
          <AttendanceEditor session={s} />
        ) : (
          <AttendanceReadOnly session={s} showRule={!cancelled && can('attendance.write')} canWrite={canWrite} />
        )}
      </div>

      {c && (
        <SessionFormModal
          open={editing}
          onClose={() => setEditing(false)}
          course={c}
          session={s}
          onDeleted={() => navigate(`/classes/${s.courseId}?tab=sessions`, { replace: true })}
        />
      )}
      <ConfirmDialog
        open={confirmCancel}
        tone="danger"
        title={t('session.cancelTitle')}
        message={t('session.cancelMessage')}
        confirmLabel={t('session.cancel')}
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate('cancelled')}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

/** Previous / next session of the same class. */
function SessionNav({ course, sessionId }: { course: CourseDetail; sessionId: number }) {
  const { t } = useTranslation('classes');
  const f = useFormat();
  const i = course.sessions.findIndex((x) => x.id === sessionId);
  if (i < 0) return null;
  const prev = course.sessions[i - 1];
  const next = course.sessions[i + 1];
  if (!prev && !next) return null;
  return (
    <nav aria-label={t('session.navLabel')} className="-mt-2 flex items-center justify-between gap-2">
      {prev ? (
        <ButtonLink to={`/sessions/${prev.id}`} variant="ghost" size="sm" className="min-w-0">
          <ChevronLeft className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
          <span className="sr-only">{t('session.previous')}: </span>
          <span className="truncate">{f.date(prev.date, 'weekday')}</span>
        </ButtonLink>
      ) : (
        <span />
      )}
      {next ? (
        <ButtonLink to={`/sessions/${next.id}`} variant="ghost" size="sm" className="min-w-0">
          <span className="sr-only">{t('session.next')}: </span>
          <span className="truncate">{f.date(next.date, 'weekday')}</span>
          <ChevronRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
        </ButtonLink>
      ) : (
        <span />
      )}
    </nav>
  );
}

type Edit = { status: AttendanceStatus | null; note: string };

const MARK_TONE = { present: 'success', late: 'warning', absent: 'danger', excused: 'info' } as const;

/** Count per mark (same colours as the status badges), plus how many are still unmarked. */
function AttendanceSummary({ marks }: { marks: (AttendanceStatus | null)[] }) {
  const { t } = useTranslation('classes');
  const unmarked = marks.filter((m) => m === null).length;
  return (
    <div className="flex flex-wrap gap-1.5" aria-live="polite">
      {ATTENDANCE_STATUSES.map((st) => {
        const n = marks.filter((m) => m === st).length;
        return (
          <Badge key={st} tone={MARK_TONE[st]} className={clsx(n === 0 && 'opacity-60')}>
            {t(`common:enums.attendanceStatus.${st}`)}
            <span className="font-semibold tabular-nums">{n}</span>
          </Badge>
        );
      })}
      {unmarked > 0 && (
        <Badge>
          {t('attendance.notMarked')}
          <span className="font-semibold tabular-nums">{unmarked}</span>
        </Badge>
      )}
    </div>
  );
}

function AttendanceEditor({ session }: { session: SessionDetail }) {
  const { t } = useTranslation('classes');
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidateClasses();
  // Only rows changed here; everything else shows what the server has (so a background refresh never wipes edits).
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [openNotes, setOpenNotes] = useState<Set<number>>(() => new Set());

  const value = (r: SessionDetail['roster'][number]): Edit => edits[r.studentId] ?? { status: r.status, note: r.note ?? '' };
  const change = (r: SessionDetail['roster'][number], patch: Partial<Edit>) =>
    setEdits((prev) => {
      const nextValue = { ...value(r), ...patch };
      const same = nextValue.status === r.status && nextValue.note.trim() === (r.note ?? '');
      const { [r.studentId]: _drop, ...rest } = prev;
      return same ? rest : { ...rest, [r.studentId]: nextValue };
    });

  const dirty = Object.keys(edits).length;
  const marks = session.roster.map((r) => value(r).status);
  const unmarked = marks.filter((m) => m === null).length;

  const save = useMutation({
    mutationFn: () =>
      api.put<SessionDetail>(`/sessions/${session.id}/attendance`, {
        records: session.roster
          .map((r) => ({ studentId: r.studentId, ...value(r) }))
          .filter((r): r is { studentId: number; status: AttendanceStatus; note: string } => r.status !== null),
      }),
    onSuccess: (fresh) => {
      qc.setQueryData(keys.session(session.id), fresh);
      setEdits({});
      invalidate({ students: true });
      toast.success(t('attendance.saved'));
    },
    onError: (err) => toast.error(t(classesErrorKey(err))),
  });

  const markRest = () =>
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of session.roster) {
        const v = next[r.studentId] ?? { status: r.status, note: r.note ?? '' };
        if (v.status === null) next[r.studentId] = { ...v, status: 'present' };
      }
      return next;
    });

  if (session.roster.length === 0) return <EmptyRoster session={session} />;

  return (
    <section aria-labelledby="attendance-title" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-2">
          <h2 id="attendance-title" className="text-lg font-semibold text-ink">
            {t('attendance.title')}
            <span className="ms-2 text-sm font-normal text-muted">{t('attendance.students', { count: session.roster.length })}</span>
          </h2>
          <AttendanceSummary marks={marks} />
        </div>
        <Button icon={CheckCheck} onClick={markRest} disabled={unmarked === 0}>
          {unmarked === session.roster.length ? t('attendance.markAll') : t('attendance.markRest')}
        </Button>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {session.roster.map((r) => {
          const name = fullName(r);
          const v = value(r);
          const noteOpen = openNotes.has(r.studentId) || !!v.note;
          const noteId = `note-${r.studentId}`;
          return (
            <li key={r.studentId} className={clsx('grid gap-2.5 px-4 py-3 sm:px-5', edits[r.studentId] && 'bg-accent-soft/30')}>
              <div className="grid items-center gap-2.5 md:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={name} fileId={r.photoFileId} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
                  <button
                    type="button"
                    onClick={() => setOpenNotes((s) => new Set(s).add(r.studentId))}
                    aria-label={t('attendance.addNoteFor', { name })}
                    aria-expanded={noteOpen}
                    aria-controls={noteId}
                    disabled={noteOpen}
                    className={clsx(
                      'inline-flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
                      noteOpen ? 'text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <StickyNote className="size-[18px]" aria-hidden />
                  </button>
                </div>
                <AttendanceControl value={v.status} onChange={(status) => change(r, { status })} label={t('attendance.statusFor', { name })} />
              </div>
              {noteOpen && (
                <div className="md:ps-11">
                  <label htmlFor={noteId} className="sr-only">
                    {t('attendance.noteFor', { name })}
                  </label>
                  <Input
                    id={noteId}
                    value={v.note}
                    maxLength={500}
                    placeholder={t('attendance.notePlaceholder')}
                    onChange={(e) => change(r, { note: e.target.value })}
                    autoFocus={openNotes.has(r.studentId) && !r.note}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <FormActions className="items-center">
        <span className="me-auto text-sm text-muted" aria-live="polite">
          {dirty > 0 ? t('attendance.unsaved', { count: dirty }) : session.attendanceTaken ? t('attendance.upToDate') : ''}
        </span>
        <Button variant="primary" loading={save.isPending} disabled={dirty === 0} onClick={() => save.mutate()}>
          {t('attendance.save')}
        </Button>
      </FormActions>
    </section>
  );
}

function AttendanceReadOnly({ session, showRule, canWrite }: { session: SessionDetail; showRule: boolean; canWrite: boolean }) {
  const { t } = useTranslation('classes');
  if (session.roster.length === 0) return <EmptyRoster session={session} canWrite={canWrite} />;
  return (
    <section aria-labelledby="attendance-title" className="grid gap-3">
      <div className="grid gap-2">
        <h2 id="attendance-title" className="text-lg font-semibold text-ink">
          {t('attendance.title')}
          <span className="ms-2 text-sm font-normal text-muted">{t('attendance.students', { count: session.roster.length })}</span>
        </h2>
        <AttendanceSummary marks={session.roster.map((r) => r.status)} />
      </div>
      {showRule && (
        <p className="flex items-start gap-2 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('attendance.readOnly')}
        </p>
      )}
      <List>
        {session.roster.map((r) => {
          const name = fullName(r);
          return (
            <ListRow
              key={r.studentId}
              leading={<Avatar name={name} fileId={r.photoFileId} size="sm" />}
              title={name}
              subtitle={r.note ?? undefined}
              trailing={r.status ? <StatusBadge group="attendanceStatus" value={r.status} /> : <span className="text-sm text-muted">{t('attendance.notMarked')}</span>}
            />
          );
        })}
      </List>
    </section>
  );
}

function EmptyRoster({ session, canWrite }: { session: SessionDetail; canWrite?: boolean }) {
  const { t } = useTranslation('classes');
  const { can } = useAuth();
  return (
    <Card title={t('attendance.title')}>
      <EmptyState
        icon={Users}
        title={t('attendance.emptyTitle')}
        description={t('attendance.emptyHint')}
        action={
          (canWrite ?? can('courses.write')) && (
            <ButtonLink to={`/classes/${session.courseId}`} icon={Users}>
              {t('attendance.manageStudents')}
            </ButtonLink>
          )
        }
        className="py-8"
      />
    </Card>
  );
}
