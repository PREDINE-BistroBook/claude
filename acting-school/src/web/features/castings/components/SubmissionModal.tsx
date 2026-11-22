import clsx from 'clsx';
import { ExternalLink, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SUBMISSION_STATUSES, type SubmissionStatus } from '@shared/enums';
import { submissionUpdateInput, type Submission } from '@shared/schemas/castings';
import { Avatar, Button, ConfirmDialog, Field, FormError, Input, Modal, TextAreaField, TextField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { displayName, fullName } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { castingsErrorKey, useDeleteSubmission, useUpdateSubmission } from '../api';
import { FINAL_STATUSES, SUBMISSION_TONES, isolate, joinAudition, splitAudition } from '../utils';

interface Props {
  submission: Submission | null;
  roleName: string;
  onClose: () => void;
}

/** Edit one talent's submission on a role: status, audition, notes — or remove it. */
export function SubmissionModal(props: Props) {
  return props.submission ? <SubmissionDialog key={props.submission.id} {...props} submission={props.submission} /> : null;
}

const DOT: Record<string, string> = {
  neutral: 'bg-muted/50',
  info: 'bg-info',
  warning: 'bg-warning',
  accent: 'bg-accent',
  success: 'bg-success',
  danger: 'bg-danger',
};

function SubmissionDialog({ submission: s, roleName, onClose }: Props & { submission: Submission }) {
  const { t } = useTranslation(['castings', 'common']);
  const toast = useToast();
  const update = useUpdateSubmission(s.id);
  const remove = useDeleteSubmission(s.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const audition = splitAudition(s.auditionAt);
  const form = useForm({
    status: s.status as SubmissionStatus,
    auditionDate: audition.date,
    auditionTime: audition.time,
    auditionLocation: s.auditionLocation ?? '',
    notes: s.notes ?? '',
  });
  const v = form.values;
  const name = displayName(s.talent);
  const realName = fullName(s.talent);

  const submit = () => {
    const auditionAt = joinAudition(v.auditionDate, v.auditionTime);
    if (auditionAt === 'incomplete') {
      form.setErrors({ [v.auditionDate ? 'auditionTime' : 'auditionDate']: 'castings:errors.auditionIncomplete' });
      return;
    }
    const data = form.validate(submissionUpdateInput, {
      status: v.status,
      auditionAt,
      auditionLocation: v.auditionLocation,
      notes: v.notes,
    });
    // A bad date/time is reported on auditionAt, shown under the two inputs.
    if (!data) return;
    update.mutate(data, {
      onSuccess: () => {
        toast.success(t('submission.saved'));
        onClose();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.issues?.length) form.setServerError(err);
        else form.setFormError(castingsErrorKey(err));
      },
    });
  };

  const onRemove = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('submission.removed'));
        onClose();
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(t(castingsErrorKey(err)));
      },
    });

  const auditionError = form.error('auditionDate') ?? form.error('auditionTime') ?? form.error('auditionAt');
  const hasAudition = !!(v.auditionDate || v.auditionTime);
  const formId = `submission-form-${s.id}`;

  return (
    <>
      {/* One dialog at a time: the editor steps aside while the remove confirmation is up. */}
      <Modal
        open={!confirmOpen}
        onClose={onClose}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={name} fileId={s.talent.headshotFileId} size="md" shape="rounded" />
            <span className="min-w-0">
              <bdi className="block truncate">{name}</bdi>
              <span className="block truncate text-sm font-normal text-muted">
                <bdi>{roleName}</bdi>
                {name !== realName && (
                  <>
                    <span aria-hidden> · </span>
                    <bdi>{realName}</bdi>
                  </>
                )}
              </span>
            </span>
          </span>
        }
        footer={
          <>
            <Button variant="danger-ghost" icon={UserMinus} onClick={() => setConfirmOpen(true)} className="me-auto max-sm:px-3" title={t('submission.remove')}>
              <span className="max-sm:sr-only">{t('submission.remove')}</span>
            </Button>
            <Button onClick={onClose} disabled={update.isPending}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={update.isPending}>
              {t('common:actions.save')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormError messageKey={form.formError} />

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">{t('submission.status')}</legend>
            <div className="grid gap-1.5">
              {SUBMISSION_STATUSES.map((status) => {
                const checked = v.status === status;
                return (
                  <div key={status}>
                    {status === FINAL_STATUSES[0] && (
                      <p className="mt-2 mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">{t('submission.final')}</p>
                    )}
                    <label
                      className={clsx(
                        'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors',
                        checked ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-surface-2',
                      )}
                    >
                      <input
                        type="radio"
                        name="status"
                        value={status}
                        checked={checked}
                        onChange={() => form.set('status', status)}
                        className="size-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{t(`common:enums.submissionStatus.${status}`)}</span>
                        <span className="block text-xs text-muted">{t(`submission.statusHints.${status}`)}</span>
                      </span>
                      <span aria-hidden className={clsx('size-2.5 shrink-0 rounded-full', DOT[SUBMISSION_TONES[status]])} />
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-sm font-medium text-ink">{t('submission.audition')}</legend>
              {hasAudition && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    form.set('auditionDate', '');
                    form.set('auditionTime', '');
                    form.setErrors({});
                  }}
                >
                  {t('submission.clearAudition')}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
              <Field label={t('submission.auditionDate')} htmlFor={`aud-date-${s.id}`}>
                <Input
                  type="date"
                  {...form.bind('auditionDate')}
                  id={`aud-date-${s.id}`}
                  aria-invalid={form.error('auditionDate') || form.error('auditionAt') ? true : undefined}
                />
              </Field>
              <Field label={t('submission.auditionTime')} htmlFor={`aud-time-${s.id}`}>
                <Input type="time" step={300} {...form.bind('auditionTime')} id={`aud-time-${s.id}`} />
              </Field>
            </div>
            {auditionError ? (
              <p className="-mt-1 text-sm text-danger" role="alert">
                {t(auditionError)}
              </p>
            ) : (
              <p className="-mt-1 text-xs text-muted">{t('submission.auditionHint')}</p>
            )}
            <TextField
              label={t('submission.auditionLocation')}
              optional
              autoComplete="off"
              dir="auto"
              placeholder={t('submission.auditionLocationPlaceholder')}
              {...form.bind('auditionLocation')}
              id={`aud-loc-${s.id}`}
              error={form.error('auditionLocation')}
            />
          </fieldset>

          <TextAreaField
            label={t('submission.notes')}
            optional
            rows={4}
            dir="auto"
            placeholder={t('submission.notesPlaceholder')}
            {...form.bind('notes')}
            id={`sub-notes-${s.id}`}
            error={form.error('notes')}
          />

          <Link to={`/talent/${s.talentId}`} className="inline-flex items-center gap-1.5 justify-self-start text-sm font-medium text-accent hover:underline">
            <ExternalLink className="size-4 rtl:-scale-x-100" aria-hidden />
            {t('submission.openProfile', { name: isolate(name) })}
          </Link>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title={t('submission.removeTitle', { name: isolate(name) })}
        message={t('submission.removeMessage')}
        confirmLabel={t('common:actions.remove')}
        loading={remove.isPending}
        onConfirm={onRemove}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
