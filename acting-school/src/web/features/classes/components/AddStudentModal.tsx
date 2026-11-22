import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CircleAlert, Plus, RotateCcw, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CourseDetail } from '@shared/schemas/courses';
import type { StudentListItem } from '@shared/schemas/students';
import { Avatar, Button, EmptyState, ErrorState, FormError, Modal, SearchInput, Spinner, StatusBadge, useToast } from '@web/components/ui';
import { api } from '@web/lib/api';
import { fullName } from '@web/lib/format';
import { useDebounced } from '@web/lib/hooks';
import { classesErrorKey, useInvalidateClasses, useStudentSearch } from '../api';

const MAX_RESULTS = 50;

interface Props {
  open: boolean;
  onClose: () => void;
  course: Pick<CourseDetail, 'id' | 'capacity' | 'enrolledCount' | 'enrollments'>;
}

/** Search students and tap to enroll them; stays open so several can be added in a row. */
export function AddStudentModal(props: Props) {
  return props.open ? <AddStudentDialog {...props} /> : null;
}

function AddStudentDialog({ onClose, course }: Props) {
  const { t } = useTranslation('classes');
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const search = useStudentSearch(debounced, true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Students added in this dialog, shown as enrolled before the class refetches.
  const [added, setAdded] = useState<Set<number>>(() => new Set());

  const byStudent = new Map(course.enrollments.map((e) => [e.studentId, e]));
  const enrolledIds = new Set(course.enrollments.filter((e) => e.status === 'enrolled').map((e) => e.studentId));
  for (const id of added) enrolledIds.add(id);
  const enrolledNow = enrolledIds.size;
  const full = course.capacity !== null && enrolledNow >= course.capacity;

  const done = (student: StudentListItem) => {
    setAdded((s) => new Set(s).add(student.id));
    setError(null);
    invalidate({ students: true });
    toast.success(t('students.enrolledToast', { name: fullName(student) }));
  };
  const fail = (err: unknown) => setError(classesErrorKey(err));

  const enroll = useMutation({
    mutationFn: (s: StudentListItem) => api.post(`/courses/${course.id}/enrollments`, { studentId: s.id }),
    onMutate: (s) => setPendingId(s.id),
    onSettled: () => setPendingId(null),
    onSuccess: (_r, s) => done(s),
    onError: fail,
  });
  const reenroll = useMutation({
    mutationFn: ({ enrollmentId }: { enrollmentId: number; student: StudentListItem }) =>
      api.patch(`/courses/${course.id}/enrollments/${enrollmentId}`, { status: 'enrolled' }),
    onMutate: ({ student }) => setPendingId(student.id),
    onSettled: () => setPendingId(null),
    onSuccess: (_r, { student }) => done(student),
    onError: fail,
  });

  const items = search.data?.items ?? [];
  const shown = items.slice(0, MAX_RESULTS);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('students.addTitle')}
      description={
        course.capacity !== null
          ? t('students.placesTaken', { count: enrolledNow, capacity: course.capacity })
          : t('students.enrolledCount', { count: enrolledNow })
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common:actions.done')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <SearchInput value={q} onChange={setQ} placeholder={t('students.searchPlaceholder')} autoFocus />
        {full && (
          <div role="status" className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('errors.classFull')}</span>
          </div>
        )}
        <FormError messageKey={error} />
        {search.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} className="py-6" />
        ) : shown.length === 0 ? (
          <EmptyState icon={Users} title={debounced ? t('students.noMatches') : t('students.noStudents')} className="py-8" />
        ) : (
          <>
            <ul className={clsx('-mx-2 divide-y divide-line', search.isFetching && 'opacity-70')} aria-busy={search.isFetching || undefined}>
              {shown.map((s) => {
                const name = fullName(s);
                const existing = byStudent.get(s.id);
                const isIn = added.has(s.id) || existing?.status === 'enrolled';
                const pending = pendingId === s.id;
                return (
                  <li key={s.id} className="flex items-center gap-3 px-2 py-2.5">
                    <Avatar name={name} fileId={s.photoFileId} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge group="studentStatus" value={s.status} />
                        {existing && !isIn && <StatusBadge group="enrollmentStatus" value={existing.status} />}
                      </div>
                    </div>
                    {isIn ? (
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                        <Check className="size-4" aria-hidden />
                        {t('common:enums.enrollmentStatus.enrolled')}
                      </span>
                    ) : existing ? (
                      <Button
                        size="sm"
                        icon={RotateCcw}
                        loading={pending}
                        disabled={full || (pendingId !== null && !pending)}
                        onClick={() => reenroll.mutate({ enrollmentId: existing.id, student: s })}
                        aria-label={t('students.reenrollName', { name })}
                        className="h-10"
                      >
                        {t('students.reenroll')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={Plus}
                        loading={pending}
                        disabled={full || (pendingId !== null && !pending)}
                        onClick={() => enroll.mutate(s)}
                        aria-label={t('students.enrollName', { name })}
                        className="h-10"
                      >
                        {t('students.enroll')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {items.length > MAX_RESULTS && <p className="text-center text-xs text-muted">{t('students.refine', { max: MAX_RESULTS })}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
