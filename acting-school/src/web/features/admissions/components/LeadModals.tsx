import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LEAD_LOST_REASONS } from '@shared/enums';
import type { LeadDetail } from '@shared/schemas/admissions';
import { Button, EnumSelect, Field, FormError, Modal, TextAreaField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { fullName } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { admissionsErrorKey, useLogActivity, useUpdateLead } from '../api';
import { FollowUpPicker } from './bits';

interface Props {
  open: boolean;
  onClose: () => void;
  lead: LeadDetail;
}

/** Close a lead as lost: a reason (required) and an optional note for the timeline. Mounted only while open. */
export function LostModal(props: Props) {
  return props.open ? <LostDialog {...props} /> : null;
}

function LostDialog({ onClose, lead }: Props) {
  const { t } = useTranslation(['admissions', 'common']);
  const toast = useToast();
  const update = useUpdateLead(lead.id);
  const log = useLogActivity(lead.id);
  const form = useForm({ lostReason: '', note: '' });
  const pending = update.isPending || log.isPending;

  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.issues?.length) form.setServerError(err);
    else form.setFormError(admissionsErrorKey(err));
  };
  const done = () => {
    toast.success(t('lost.done'));
    onClose();
  };

  const submit = () => {
    const { lostReason, note } = form.values;
    if (!lostReason) return form.setErrors({ lostReason: 'admissions:errors.lostReasonRequired' });
    const reason = lostReason as (typeof LEAD_LOST_REASONS)[number];
    // With a note, one timeline entry carries both the note and the status change.
    if (note.trim()) log.mutate({ type: 'note', body: note.trim(), status: 'lost', lostReason: reason }, { onSuccess: done, onError });
    else update.mutate({ status: 'lost', lostReason: reason }, { onSuccess: done, onError });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('lost.title', { name: fullName(lead) })}
      description={t('lost.hint')}
      footer={
        <>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" form="lost-form" variant="danger" loading={pending}>
            {t('lost.confirm')}
          </Button>
        </>
      }
    >
      <form
        id="lost-form"
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError messageKey={form.formError} />
        <Field label={t('fields.lostReason')} htmlFor="f-lostReason" required error={form.error('lostReason')}>
          <EnumSelect group="leadLostReason" values={LEAD_LOST_REASONS} allowEmpty emptyLabel={t('lost.pickReason')} {...form.bind('lostReason')} />
        </Field>
        <TextAreaField label={t('lost.note')} optional rows={3} dir="auto" {...form.bind('note')} error={form.error('body')} />
      </form>
    </Modal>
  );
}

/** Change just the next follow-up date (quick chips or a date). Mounted only while open. */
export function FollowUpModal(props: Props) {
  return props.open ? <FollowUpDialog {...props} /> : null;
}

function FollowUpDialog({ onClose, lead }: Props) {
  const { t } = useTranslation(['admissions', 'common']);
  const toast = useToast();
  const update = useUpdateLead(lead.id);
  const [value, setValue] = useState(lead.nextFollowUpOn ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    update.mutate(
      { nextFollowUpOn: value || null },
      {
        onSuccess: () => {
          toast.success(value ? t('followUp.saved') : t('followUp.cleared'));
          onClose();
        },
        onError: (err) => setError(admissionsErrorKey(err)),
      },
    );

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('followUp.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button variant="primary" onClick={save} loading={update.isPending}>
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormError messageKey={error} />
        <FollowUpPicker id="f-followUp" value={value} onChange={setValue} />
      </div>
    </Modal>
  );
}
