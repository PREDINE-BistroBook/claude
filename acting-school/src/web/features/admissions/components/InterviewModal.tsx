import { CalendarX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, splitDateTime, todayISO } from '@shared/dates';
import {
  ADMISSIONS_ERROR_CODES,
  DEFAULT_INTERVIEW_MINUTES,
  interviewScheduleInput,
  interviewUpdateInput,
  type Interview,
  type LeadDetail,
} from '@shared/schemas/admissions';
import { Button, ConfirmDialog, Field, FormError, FormGrid, Modal, Select, TextAreaField, TextField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { admissionsErrorKey, isApiCode, useScheduleInterview, useUpdateInterview } from '../api';
import { StaffSelect } from './bits';

const DURATIONS = [15, 20, 30, 45, 60, 90, 120];

interface Props {
  open: boolean;
  onClose: () => void;
  lead: LeadDetail;
  /** Editing a scheduled interview (reschedule, room, interviewer, notes, cancel); absent = schedule a new one. */
  interview?: Interview;
}

/** Schedule an admissions interview, or change / cancel a scheduled one. Mounted only while open. */
export function InterviewModal(props: Props) {
  return props.open ? <InterviewDialog {...props} /> : null;
}

function InterviewDialog({ onClose, lead, interview }: Props) {
  const { t } = useTranslation(['admissions', 'common']);
  const { can, user } = useAuth();
  const f = useFormat();
  const toast = useToast();
  const schedule = useScheduleInterview(lead.id);
  const update = useUpdateInterview(lead.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const editing = !!interview;
  const at = interview ? splitDateTime(interview.scheduledAt) : null;

  const form = useForm({
    date: at?.date ?? addDays(todayISO(), 1),
    time: at?.time ?? '',
    durationMinutes: String(interview?.durationMinutes ?? DEFAULT_INTERVIEW_MINUTES),
    room: interview?.room ?? '',
    // The person who interviews is usually the one who decides (the director); default to them when they schedule.
    interviewerId: interview ? (interview.interviewerId ? String(interview.interviewerId) : '') : can('admissions.decide') && user ? String(user.id) : '',
    notes: interview?.notes ?? '',
  });
  const v = form.values;
  const durations = DURATIONS.includes(Number(v.durationMinutes)) ? DURATIONS : [...DURATIONS, Number(v.durationMinutes)].sort((a, b) => a - b);

  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.issues?.length) {
      form.setServerError(err);
      // The API checks the combined date-time; show its problem on the date.
      const issue = err.issues.find((i) => i.path[0] === 'scheduledAt');
      if (issue) form.setErrors((e) => ({ ...e, date: issue.message.startsWith('errors.') ? `common:${issue.message}` : issue.message }));
    } else if (isApiCode(err, ADMISSIONS_ERROR_CODES.interviewNotScheduled)) {
      form.setFormError('admissions:errors.interviewNotScheduled');
    } else form.setFormError(admissionsErrorKey(err));
  };

  const submit = () => {
    const missing: Record<string, string> = {};
    if (!v.date) missing.date = 'common:errors.required';
    if (!v.time) missing.time = 'common:errors.required';
    if (Object.keys(missing).length) return form.setErrors(missing);
    const payload = {
      scheduledAt: `${v.date}T${v.time}`,
      durationMinutes: Number(v.durationMinutes),
      room: v.room,
      interviewerId: v.interviewerId,
      notes: v.notes,
    };
    if (editing) {
      const data = form.validate(interviewUpdateInput, payload);
      if (!data) return;
      update.mutate(
        { interviewId: interview.id, data },
        {
          onSuccess: () => {
            toast.success(t('interview.updated'));
            onClose();
          },
          onError,
        },
      );
    } else {
      const data = form.validate(interviewScheduleInput, payload);
      if (!data) return;
      schedule.mutate(data, {
        onSuccess: (iv) => {
          toast.success(t('interview.scheduled', { when: f.dateTime(iv.scheduledAt) }));
          onClose();
        },
        onError,
      });
    }
  };

  const cancelInterview = () =>
    update.mutate(
      { interviewId: interview!.id, data: { status: 'cancelled' } },
      {
        onSuccess: () => {
          toast.success(t('interview.cancelled'));
          setConfirmCancel(false);
          onClose();
        },
        onError: (err) => {
          setConfirmCancel(false);
          onError(err);
        },
      },
    );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={t(editing ? 'interview.editTitle' : 'interview.scheduleTitle')}
        description={editing ? undefined : t('interview.scheduleHint')}
        footer={
          <>
            {editing && (
              <Button variant="danger-ghost" icon={CalendarX} className="me-auto" onClick={() => setConfirmCancel(true)}>
                {t('interview.cancel')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button type="submit" form="interview-form" variant="primary" loading={schedule.isPending || (update.isPending && !confirmCancel)}>
              {t(editing ? 'common:actions.saveChanges' : 'interview.schedule')}
            </Button>
          </>
        }
      >
        <form
          id="interview-form"
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormError messageKey={form.formError} />
          <FormGrid>
            <TextField label={t('fields.date')} type="date" required {...form.bind('date')} error={form.error('date')} />
            <TextField label={t('fields.time')} type="time" step={300} required {...form.bind('time')} error={form.error('time')} />
          </FormGrid>
          <FormGrid>
            <Field label={t('fields.duration')} htmlFor="f-durationMinutes" error={form.error('durationMinutes')}>
              <Select {...form.bind('durationMinutes')}>
                {durations.map((m) => (
                  <option key={m} value={m}>
                    {t('interview.minutes', { count: m })}
                  </option>
                ))}
              </Select>
            </Field>
            <TextField label={t('fields.room')} optional autoComplete="off" {...form.bind('room')} error={form.error('room')} />
          </FormGrid>
          <StaffSelect
            label={t('fields.interviewer')}
            emptyLabel={t('interview.noInterviewer')}
            optional
            current={interview?.interviewerId ? { id: interview.interviewerId, name: interview.interviewerName } : null}
            {...form.bind('interviewerId')}
            error={form.error('interviewerId')}
          />
          <TextAreaField label={t('fields.notes')} optional rows={3} dir="auto" {...form.bind('notes')} error={form.error('notes')} />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmCancel}
        title={t('interview.cancelTitle')}
        message={t('interview.cancelMessage')}
        confirmLabel={t('interview.cancel')}
        loading={update.isPending}
        onConfirm={cancelInterview}
        onCancel={() => setConfirmCancel(false)}
      />
    </>
  );
}
