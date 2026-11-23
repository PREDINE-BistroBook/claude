import { ChevronRight, GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CourseListItem } from '@shared/schemas/courses';
import { EmptyState, ErrorState, Modal, Spinner } from '@web/components/ui';
import { useFormat } from '@web/lib/format';
import { useCourses } from '../../classes/api';
import { CourseTile } from '../../classes/components/CourseColor';
import { SessionFormModal } from '../../classes/components/SessionFormModal';

/**
 * "+ Add a session" on the School schedule (courses.write): first which
 * workshop — its active workshops as big rows —, then the workshop's own
 * "Add session" form (classes/components/SessionFormModal: an extra session
 * on POST /api/courses/:id/sessions), starting on the day shown. Saving opens
 * the new session.
 */
export function AddSessionModal({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const [course, setCourse] = useState<CourseListItem | null>(null);
  const navigate = useNavigate();
  const close = () => {
    setCourse(null);
    onClose();
  };
  return (
    <>
      {open && !course && <WorkshopPicker onClose={close} onPick={setCourse} />}
      <SessionFormModal
        open={open && !!course}
        onClose={close}
        course={course ?? { id: 0, room: null, teacherId: null, teacherName: null }}
        defaultDate={date}
        onSaved={(s) => {
          close();
          navigate(`/sessions/${s.id}`);
        }}
      />
    </>
  );
}

function WorkshopPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: CourseListItem) => void }) {
  const { t } = useTranslation(['schedule', 'classes', 'common']);
  const f = useFormat();
  const courses = useCourses({ status: 'active' });
  const items = courses.data?.items ?? [];
  return (
    <Modal open onClose={onClose} title={t('addSession.title')} description={t('addSession.hint')}>
      {courses.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : courses.isError ? (
        <ErrorState error={courses.error} onRetry={() => void courses.refetch()} className="py-6" />
      ) : !items.length ? (
        <EmptyState icon={GraduationCap} title={t('addSession.none')} className="py-8" />
      ) : (
        <ul className="-mx-2 grid gap-1">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-start hover:bg-surface-2"
                data-testid="pick-workshop"
              >
                <CourseTile color={c.color} />
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate font-medium text-ink">{c.name}</bdi>
                  {c.nextSession && (
                    <span className="block truncate text-sm text-muted">
                      {t('addSession.next', { when: `${f.date(c.nextSession.date, 'weekday')} · ${f.time(c.nextSession.startTime)}` })}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
