import { useMutation } from '@tanstack/react-query';
import { Check, GraduationCap, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StudentDetail } from '@shared/schemas/students';
import type { CourseListItem } from '@shared/schemas/courses';
import { Button, EmptyState, ErrorState, FormError, Modal, Spinner, useToast } from '@web/components/ui';
import { api } from '@web/lib/api';
import { fullName } from '@web/lib/format';
import { classesErrorKey, useCourses, useInvalidateClasses } from '../../classes/api';
import { CourseTile } from '../../classes/components/CourseColor';

/**
 * "+ Add to a workshop" on a student's page (courses.write): the active
 * workshops as big rows, tap "Enrol" on one (POST /api/courses/:id/enrollments,
 * the same rules as from the workshop: a full workshop or an earlier enrolment
 * says so). Stays open so a student can join two workshops in a row.
 */
export function EnrolModal({ open, onClose, student }: { open: boolean; onClose: () => void; student: StudentDetail }) {
  return open ? <EnrolDialog onClose={onClose} student={student} /> : null;
}

function EnrolDialog({ onClose, student }: { onClose: () => void; student: StudentDetail }) {
  const { t } = useTranslation(['students', 'classes', 'common']);
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const courses = useCourses({ status: 'active' });
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(() => new Set());
  const current = new Set(student.enrollments.filter((e) => e.status === 'enrolled').map((e) => e.courseId));
  for (const id of added) current.add(id);

  const enrol = useMutation({
    mutationFn: (c: CourseListItem) => api.post(`/courses/${c.id}/enrollments`, { studentId: student.id }),
    onSuccess: (_r, c) => {
      setAdded((s) => new Set(s).add(c.id));
      setError(null);
      invalidate({ students: true });
      toast.success(t('classes:students.enrolledToast', { name: fullName(student) }));
    },
    onError: (err) => setError(classesErrorKey(err)),
  });

  const items = courses.data?.items ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      title={t('enrol.title', { name: fullName(student) })}
      description={t('enrol.hint')}
      footer={
        <Button variant="primary" size="lg" onClick={onClose}>
          {t('common:actions.done')}
        </Button>
      }
    >
      {/* grid-cols-1 (minmax(0, 1fr)): the rows stay inside the dialog at 375 px. */}
      <div className="grid grid-cols-1 gap-3">
        <FormError messageKey={error} />
        {courses.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : courses.isError ? (
          <ErrorState error={courses.error} onRetry={() => void courses.refetch()} className="py-6" />
        ) : !items.length ? (
          <EmptyState icon={GraduationCap} title={t('enrol.none')} className="py-8" />
        ) : (
          <ul className="-mx-2 divide-y divide-line">
            {items.map((c) => {
              const isIn = current.has(c.id);
              const pending = enrol.isPending && enrol.variables?.id === c.id;
              const full = c.capacity !== null && c.enrolledCount >= c.capacity && !isIn;
              return (
                <li key={c.id} className="flex items-center gap-3 px-2 py-2.5">
                  <CourseTile color={c.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <bdi className="block font-medium leading-snug text-ink break-words">{c.name}</bdi>
                    {c.teacherName && <bdi className="block truncate text-sm text-muted">{c.teacherName}</bdi>}
                  </div>
                  {isIn ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-success">
                      <Check className="size-4" aria-hidden />
                      {t('common:enums.enrollmentStatus.enrolled')}
                    </span>
                  ) : (
                    <Button
                      size="lg"
                      variant="primary"
                      icon={Plus}
                      loading={pending}
                      disabled={full || enrol.isPending}
                      onClick={() => enrol.mutate(c)}
                      aria-label={t('enrol.enrolIn', { name: c.name })}
                      data-testid="enrol-in-workshop"
                      className="shrink-0 px-4"
                    >
                      {full ? t('enrol.full') : t('classes:students.enroll')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
