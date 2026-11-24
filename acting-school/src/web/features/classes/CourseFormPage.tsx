import { useMutation } from '@tanstack/react-query';
import { CalendarRange, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { COURSE_LEVELS, COURSE_STATUSES, type CourseColor } from '@shared/enums';
import { addDays, todayISO } from '@shared/dates';
import { MAX_COURSE_SPAN_DAYS, courseInput, type CourseDetail } from '@shared/schemas/courses';
import {
  Button,
  ButtonLink,
  EnumSelect,
  ErrorState,
  Field,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  PageHeader,
  PageLoader,
  TextAreaField,
  TextField,
  useToast,
} from '@web/components/ui';
import { api } from '@web/lib/api';
import { useForm } from '@web/lib/forms';
import { useCourse, useInvalidateClasses, useWeekStart } from './api';
import { ColorPicker } from './components/CourseColor';
import { ScheduleEditor, toDrafts, type SlotDraft } from './components/ScheduleEditor';
import { TeacherSelect } from './components/TeacherSelect';
import { countOccurrences, daysBetween } from './utils';

/** /classes/new and /classes/:id/edit */
export default function CourseFormPage() {
  const { id } = useParams();
  const courseId = id ? Number(id) : null;
  const course = useCourse(courseId ?? 0, courseId !== null);
  const weekStart = useWeekStart();

  if (courseId === null) return <CourseForm weekStart={weekStart} />;
  if (course.isPending) return <PageLoader />;
  if (course.isError) return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  return <CourseForm key={course.data.id} course={course.data} weekStart={weekStart} />;
}

function CourseForm({ course, weekStart }: { course?: CourseDetail; weekStart: number }) {
  const { t } = useTranslation('classes');
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const editing = !!course;
  const today = todayISO();

  const form = useForm({
    name: course?.name ?? '',
    description: course?.description ?? '',
    level: course?.level ?? '',
    teacherId: course?.teacherId ? String(course.teacherId) : '',
    room: course?.room ?? '',
    capacity: course?.capacity != null ? String(course.capacity) : '',
    startDate: course?.startDate ?? today,
    endDate: course?.endDate ?? addDays(today, 7 * 12 - 1),
    color: (course?.color ?? 'sky') as CourseColor | '',
    status: course?.status ?? 'active',
    schedule: course ? toDrafts(course.schedule, weekStart) : ([] as SlotDraft[]),
  });
  const v = form.values;

  const save = useMutation({
    mutationFn: (data: unknown) => (editing ? api.patch<CourseDetail>(`/courses/${course.id}`, data) : api.post<CourseDetail>('/courses', data)),
    onSuccess: (saved) => {
      invalidate();
      toast.success(t(editing ? 'common:states.saved' : 'form.created'));
      navigate(`/classes/${saved.id}`, { replace: !editing });
    },
    onError: form.setServerError,
  });

  function submit() {
    const payload = {
      ...v,
      status: editing ? v.status : undefined,
      schedule: v.schedule.map((s) => ({ weekday: Number(s.weekday), startTime: s.startTime, endTime: s.endTime })),
    };
    const data = form.validate(courseInput, payload);
    if (!data) return;
    if (daysBetween(data.startDate, data.endDate) > MAX_COURSE_SPAN_DAYS) {
      form.setErrors({ endDate: 'common:errors.dateRangeTooLong' });
      return;
    }
    save.mutate(data);
  }

  const validRange = !!v.startDate && !!v.endDate && v.endDate >= v.startDate;
  const sessionCount = validRange ? countOccurrences(v.schedule.map((s) => ({ weekday: Number(s.weekday), startTime: s.startTime })), v.startDate, v.endDate) : 0;
  const back = editing ? `/classes/${course.id}` : '/classes';

  return (
    <div>
      <PageHeader back={back} title={t(editing ? 'form.editTitle' : 'form.newTitle')} subtitle={editing ? course.name : undefined} />
      <FormPage onSubmit={submit}>
        <FormError messageKey={form.formError} />

        <FormSection title={t('form.sectionDetails')}>
          <TextField label={t('fields.name')} required placeholder={t('form.namePlaceholder')} {...form.bind('name')} error={form.error('name')} />
          <FormGrid>
            <Field label={t('fields.level')} htmlFor="f-level" optional error={form.error('level')}>
              <EnumSelect group="courseLevel" values={COURSE_LEVELS} allowEmpty emptyLabel={t('form.noLevel')} {...form.bind('level')} />
            </Field>
            {editing && (
              <Field label={t('fields.status')} htmlFor="f-status" error={form.error('status')} hint={t('form.statusHint')}>
                <EnumSelect group="courseStatus" values={COURSE_STATUSES} {...form.bind('status')} />
              </Field>
            )}
          </FormGrid>
          <TextAreaField label={t('fields.description')} optional rows={3} {...form.bind('description')} error={form.error('description')} />
        </FormSection>

        <FormSection title={t('form.sectionTeaching')}>
          <FormGrid>
            <TeacherSelect
              label={t('fields.teacher')}
              emptyLabel={t('form.noTeacher')}
              optional
              current={course?.teacherId ? { id: course.teacherId, name: course.teacherName } : null}
              {...form.bind('teacherId')}
              error={form.error('teacherId')}
            />
            <TextField label={t('fields.room')} optional placeholder={t('form.roomPlaceholder')} {...form.bind('room')} error={form.error('room')} />
            <TextField
              label={t('fields.capacity')}
              optional
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              hint={t('form.capacityHint')}
              {...form.bind('capacity')}
              error={form.error('capacity')}
            />
          </FormGrid>
        </FormSection>

        <FormSection title={t('form.sectionSchedule')} description={t('form.sectionScheduleHint')}>
          <FormGrid>
            <TextField label={t('fields.startDate')} type="date" required {...form.bind('startDate')} error={form.error('startDate')} />
            <TextField label={t('fields.endDate')} type="date" required min={v.startDate || undefined} {...form.bind('endDate')} error={form.error('endDate')} />
          </FormGrid>
          <div>
            <h3 id="schedule-label" className="mb-2 text-sm font-medium text-ink">
              {t('fields.schedule')}
            </h3>
            <ScheduleEditor slots={v.schedule} onChange={(s) => form.set('schedule', s)} error={form.error} weekStart={weekStart} />
          </div>
          {validRange && v.schedule.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <CalendarRange className="size-4 shrink-0" aria-hidden />
              {t(editing ? 'form.sessionCountEdit' : 'form.sessionCount', { count: sessionCount })}
            </p>
          )}
          {editing && (
            <div className="flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-3 text-sm text-info">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('form.regenerateNote')}</span>
            </div>
          )}
        </FormSection>

        <FormSection title={<span id="color-label">{t('fields.color')}</span>} description={t('form.colorHint')}>
          <ColorPicker value={v.color} onChange={(c) => form.set('color', c)} labelledBy="color-label" />
        </FormSection>

        <FormActions>
          <ButtonLink to={back}>{t('common:actions.cancel')}</ButtonLink>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t(editing ? 'common:actions.saveChanges' : 'form.create')}
          </Button>
        </FormActions>
      </FormPage>
    </div>
  );
}
