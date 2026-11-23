import clsx from 'clsx';
import { Mail, MessageCircle, Phone, StickyNote, Users, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LEAD_CONTACT_TYPES, LEAD_LOST_REASONS, isClosedLeadStatus, type LeadContactType, type LeadStatus } from '@shared/enums';
import { leadActivityInput, type LeadDetail } from '@shared/schemas/admissions';
import { Button, EnumSelect, Field, FormError, Modal, Select, TextAreaField, useToast } from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { useForm } from '@web/lib/forms';
import { admissionsErrorKey, useLogActivity } from '../api';
import { manualStatusOptions } from '../utils';
import { FollowUpPicker } from './bits';

export const CONTACT_ICONS: Record<LeadContactType, LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: Users,
  note: StickyNote,
};

interface Props {
  open: boolean;
  onClose: () => void;
  lead: LeadDetail;
  defaultType?: LeadContactType;
}

/**
 * Log a call / WhatsApp / email / meeting / note on the lead's timeline, with
 * the next follow-up and (optionally) a new status. Mounted only while open.
 */
export function LogContactModal(props: Props) {
  return props.open ? <LogContactDialog {...props} /> : null;
}

function LogContactDialog({ onClose, lead, defaultType = 'call' }: Props) {
  const { t } = useTranslation(['admissions', 'common']);
  const { can } = useAuth();
  const toast = useToast();
  const log = useLogActivity(lead.id);
  const [type, setType] = useState<LeadContactType>(defaultType);
  const form = useForm({ body: '', nextFollowUpOn: lead.nextFollowUpOn ?? '', status: '', lostReason: '' });
  const v = form.values;

  const statusOptions = manualStatusOptions(lead.status, can('admissions.decide'));
  // Contacting a new lead moves it to contacted on the server; a note alone doesn't.
  const autoContacted = !v.status && type !== 'note' && lead.status === 'new';
  const resulting = (v.status as LeadStatus) || (autoContacted ? 'contacted' : lead.status);
  const closedAfter = isClosedLeadStatus(resulting);

  const submit = () => {
    const payload: Record<string, unknown> = { type, body: v.body };
    if (v.status) payload.status = v.status;
    if (v.status === 'lost') payload.lostReason = v.lostReason;
    // Only send the follow-up when it changed (omitted = keep it); closing clears it anyway.
    if (!closedAfter && v.nextFollowUpOn !== (lead.nextFollowUpOn ?? '')) payload.nextFollowUpOn = v.nextFollowUpOn || null;
    const data = form.validate(leadActivityInput, payload);
    if (!data) return;
    if (data.status === 'lost' && !data.lostReason) {
      form.setErrors({ lostReason: 'admissions:errors.lostReasonRequired' });
      return;
    }
    log.mutate(data, {
      onSuccess: () => {
        toast.success(t('log.saved'));
        onClose();
      },
      onError: (err) => {
        if (err instanceof ApiError && err.issues?.length) form.setServerError(err);
        else form.setFormError(admissionsErrorKey(err));
      },
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('log.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" form="log-contact" variant="primary" loading={log.isPending}>
            {t('log.save')}
          </Button>
        </>
      }
    >
      <form
        id="log-contact"
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError messageKey={form.formError} />
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">{t('log.type')}</legend>
          <div role="radiogroup" aria-label={t('log.type')} className="grid grid-cols-5 gap-1.5">
            {LEAD_CONTACT_TYPES.map((ct) => {
              const Icon = CONTACT_ICONS[ct];
              const active = ct === type;
              return (
                <button
                  key={ct}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(ct)}
                  className={clsx(
                    'flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1 py-2 text-xs font-medium transition-colors',
                    active ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface text-ink hover:bg-surface-2',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="max-w-full truncate">{t(`common:enums.leadActivityType.${ct}`)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <TextAreaField
          label={type === 'note' ? t('log.note') : t('log.summary')}
          optional={type !== 'note'}
          rows={3}
          dir="auto"
          placeholder={t(type === 'note' ? 'log.notePlaceholder' : 'log.summaryPlaceholder')}
          {...form.bind('body')}
          error={form.error('body')}
        />

        {statusOptions.length > 0 && (
          <Field
            label={t('log.status')}
            htmlFor="f-status"
            optional
            error={form.error('status')}
            hint={autoContacted ? t('log.autoContacted') : undefined}
          >
            <Select {...form.bind('status')}>
              <option value="">{t('log.keepStatus', { status: t(`common:enums.leadStatus.${lead.status}`) })}</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {t(`common:enums.leadStatus.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {v.status === 'lost' && (
          <Field label={t('fields.lostReason')} htmlFor="f-lostReason" required error={form.error('lostReason')}>
            <EnumSelect group="leadLostReason" values={LEAD_LOST_REASONS} allowEmpty emptyLabel={t('lost.pickReason')} {...form.bind('lostReason')} />
          </Field>
        )}

        {closedAfter ? (
          <p className="text-sm text-muted">{t('log.closedNoFollowUp')}</p>
        ) : (
          <FollowUpPicker id="f-nextFollowUpOn" value={v.nextFollowUpOn} onChange={(d) => form.set('nextFollowUpOn', d)} error={form.error('nextFollowUpOn')} />
        )}
      </form>
    </Modal>
  );
}
