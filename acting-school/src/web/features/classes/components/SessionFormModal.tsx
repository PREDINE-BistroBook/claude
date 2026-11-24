import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COURSE_ERROR_CODES, sessionCreateInput, sessionUpdateInput, type ClassSession } from '@shared/schemas/courses';
import { Button, ConfirmDialog, FormError, FormGrid, Modal, TextAreaField, TextField, useToast } from '@web/components/ui';
import { api } from '@web/lib/api';
import { useForm } from '@web/lib/forms';
import { classesErrorKey, isApiCode, useInvalidateClasses } from '../api';
import { TeacherSelect } from './TeacherSelect';

export interface SessionCourseInfo {
  id: number;
  room: string | null;
  teacherId: number | null;
  teacherName: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  course: SessionCourseInfo;
  /** Present when editing an existing session. */
  session?: ClassSession;
  /** Prefill for a new session. */
  defaultDate?: string;
  onSaved?: (s: ClassSession) => void;
  onDeleted?: () => void;
}

/**
 * Add a one-off extra session to a class, or edit a session (date/time, room,
 * substitute teacher, topic, notes). Mounted only while open so every opening
 * starts from fresh values.
 */
export function SessionFormModal(props: Props) {
  return props.open ? <SessionFormDialog {...props} /> : null;
}

function SessionFormDialog({ onClose, course, session, defaultDate, onSaved, onDeleted }: Props) {
  const { t } = useTranslation('classes');
  const toast = useToast();
  const invalidate = useInvalidateClasses();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = !!session;

  // The session answers effective values (override ?? class value); an override equal to the class value is the same thing.
  const form = useForm({
    date: session?.date ?? defaultDate ?? '',
    startTime: session?.startTime ?? '',
    endTime: session?.endTime ?? '',
    room: session && session.room !== course.room ? (session.room ?? '') : '',
    teacherId: session && session.teacherId !== course.teacherId && session.teacherId ? String(session.teacherId) : '',
    topic: session?.topic ?? '',
    notes: session?.notes ?? '',
  });

  const onError = (err: unknown) => {
    if (isApiCode(err, COURSE_ERROR_CODES.sessionExists)) form.setErrors({ date: 'classes:errors.sessionExists' });
    else if (isApiCode(err, 'validation')) form.setServerError(err);
    else form.setFormError(classesErrorKey(err));
  };

  const save = useMutation({
    mutationFn: (data: unknown) =>
      editing ? api.patch<ClassSession>(`/sessions/${session.id}`, data) : api.post<ClassSession>(`/courses/${course.id}/sessions`, data),
    onSuccess: (saved) => {
      invalidate();
      toast.success(t(editing ? 'common:states.saved' : 'session.added'));
      onSaved?.(saved);
      onClose();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/sessions/${session!.id}`),
    onSuccess: () => {
      invalidate({ students: true });
      toast.success(t('session.deleted'));
      setConfirmDelete(false);
      onClose();
      onDeleted?.();
    },
    onError: (err) => {
      setConfirmDelete(false);
      toast.error(t(classesErrorKey(err)));
    },
  });

  function submit() {
    if (editing) {
      const data = form.validate(sessionUpdateInput, form.values);
      if (!data) return;
      if (data.startTime && data.endTime && data.endTime <= data.startTime) {
        form.setErrors({ endTime: 'common:errors.endBeforeStart' });
        return;
      }
      save.mutate(data);
    } else {
      const { notes: _notes, ...rest } = form.values;
      const data = form.validate(sessionCreateInput, rest);
      if (data) save.mutate(data);
    }
  }

  const formId = editing ? `session-edit-${session.id}` : 'session-new';
  const classTeacher = course.teacherName ? t('session.classTeacher', { name: course.teacherName }) : t('session.classTeacherNone');

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t(editing ? 'session.editTitle' : 'session.addTitle')}
        description={editing ? undefined : t('session.addHint')}
        footer={
          <>
            {editing && (
              <Button variant="danger-ghost" icon={Trash2} className="me-auto" onClick={() => setConfirmDelete(true)}>
                {t('session.delete')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
              {t(editing ? 'common:actions.saveChanges' : 'session.add')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormError messageKey={form.formError} />
          <TextField label={t('fields.date')} type="date" required {...form.bind('date')} error={form.error('date')} />
          <FormGrid>
            <TextField label={t('fields.startTime')} type="time" step={300} required {...form.bind('startTime')} error={form.error('startTime')} />
            <TextField label={t('fields.endTime')} type="time" step={300} required {...form.bind('endTime')} error={form.error('endTime')} />
          </FormGrid>
          <FormGrid>
            <TextField
              label={t('fields.room')}
              optional
              placeholder={course.room ? t('session.classRoom', { room: course.room }) : undefined}
              hint={t('session.roomHint')}
              {...form.bind('room')}
              error={form.error('room')}
            />
            <TeacherSelect
              label={t('fields.teacher')}
              emptyLabel={classTeacher}
              hint={t('session.teacherHint')}
              current={session && session.teacherId !== course.teacherId && session.teacherId ? { id: session.teacherId, name: session.teacherName } : null}
              {...form.bind('teacherId')}
              error={form.error('teacherId')}
            />
          </FormGrid>
          <TextField label={t('fields.topic')} optional placeholder={t('session.topicPlaceholder')} {...form.bind('topic')} error={form.error('topic')} />
          {editing && <TextAreaField label={t('fields.notes')} optional rows={3} {...form.bind('notes')} error={form.error('notes')} />}
        </form>
      </Modal>
      {editing && (
        <ConfirmDialog
          open={confirmDelete}
          title={t('session.deleteTitle')}
          message={t('session.deleteMessage')}
          loading={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
