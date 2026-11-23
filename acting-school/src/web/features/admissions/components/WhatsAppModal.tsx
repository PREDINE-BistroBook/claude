import { ExternalLink, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { splitDateTime } from '@shared/dates';
import { LOCALES, type Locale } from '@shared/enums';
import { whatsAppLink } from '@shared/phone';
import type { LeadDetail } from '@shared/schemas/admissions';
import { Button, Checkbox, Field, Modal, Segmented, Textarea, buttonClasses, useToast } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { makeFormat } from '@web/lib/format';
import { useAdmissionsSettings, useLogActivity } from '../api';
import { WHATSAPP_TEMPLATES, nextScheduledInterview, suggestedTemplate, type WhatsAppTemplate } from '../utils';
import { Chip } from './bits';

interface Props {
  open: boolean;
  onClose: () => void;
  lead: LeadDetail;
}

/**
 * Pre-written WhatsApp messages ($0: a wa.me link opens the chat with the text
 * filled in). Pick the message and its language (independent of the app's),
 * edit it if needed, open WhatsApp — and optionally log it on the timeline.
 * Mounted only while open.
 */
export function WhatsAppModal(props: Props) {
  return props.open ? <WhatsAppDialog {...props} /> : null;
}

type Recipient = 'lead' | 'guardian';

function WhatsAppDialog({ onClose, lead }: Props) {
  const { t, i18n } = useTranslation(['admissions', 'common']);
  // The school's names come from /auth/me, which the signed-in shell has already loaded (settings may still be on its way, with a placeholder name).
  const { can, schoolName, schoolNameAr } = useAuth();
  const settings = useAdmissionsSettings();
  const toast = useToast();
  const log = useLogActivity(lead.id);
  const interview = nextScheduledInterview(lead.interviews);
  const [template, setTemplate] = useState<WhatsAppTemplate>(() => suggestedTemplate(lead.status, !!interview));
  const [lang, setLang] = useState<Locale>(i18n.language === 'ar' ? 'ar' : 'en');
  const [recipient, setRecipient] = useState<Recipient>('lead');
  const canWrite = can('admissions.write');
  const [logIt, setLogIt] = useState(canWrite);

  // The message in the chosen language, with the app's own date/time formatting for that language.
  const generated = useMemo(() => {
    const tt = i18n.getFixedT(lang, 'admissions');
    const fmt = makeFormat(lang);
    const at = interview ? splitDateTime(interview.scheduledAt) : null;
    return tt(`whatsapp.templates.${template}.text`, {
      name: lead.firstName,
      // An Arabic message names the school in Arabic when it has an Arabic name.
      school: (lang === 'ar' && schoolNameAr) || schoolName,
      date: at ? fmt.date(at.date, 'full') : '',
      time: at ? fmt.time(at.time) : '',
    });
  }, [i18n, lang, template, lead.firstName, schoolName, schoolNameAr, interview]);

  // Editing the text keeps the edit until another message or language is picked.
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(null);
  const key = `${template}-${lang}`;
  const text = edited?.key === key ? edited.text : generated;

  const phone = recipient === 'guardian' ? lead.guardianPhone : lead.phone;
  const href = whatsAppLink(phone, settings.defaultCountryCode, text);

  // The link opens WhatsApp in a new tab; this dialog closes once the timeline entry is saved.
  const onOpen = () => {
    if (!logIt || !canWrite) return onClose();
    log.mutate(
      { type: 'whatsapp', body: text },
      {
        onSuccess: () => {
          toast.success(t('whatsapp.logged'));
          onClose();
        },
        onError: () => {
          toast.error(t('whatsapp.logFailed'));
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('whatsapp.title')}
      description={t('whatsapp.subtitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={buttonClasses('primary')}>
              <ExternalLink className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
              {t('whatsapp.open')}
            </a>
          ) : (
            <Button variant="primary" disabled>
              {t('whatsapp.open')}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">{t('whatsapp.message')}</legend>
          <div className="flex flex-wrap gap-2">
            {WHATSAPP_TEMPLATES.map((tpl) => {
              const disabled = tpl === 'interview_invite' && !interview;
              return (
                <Chip key={tpl} pressed={tpl === template} disabled={disabled} onClick={() => setTemplate(tpl)} className="disabled:opacity-50">
                  {t(`whatsapp.templates.${tpl}.label`)}
                </Chip>
              );
            })}
          </div>
          {!interview && <p className="mt-1.5 text-xs text-muted">{t('whatsapp.inviteNeedsInterview')}</p>}
        </fieldset>

        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('whatsapp.language')}>
            <Segmented<Locale>
              label={t('whatsapp.language')}
              value={lang}
              onChange={setLang}
              options={LOCALES.map((l) => ({ value: l, label: <span lang={l}>{t(`common:enums.locale.${l}`)}</span> }))}
            />
          </Field>
          {lead.guardianPhone && (
            <Field label={t('whatsapp.sendTo')}>
              <Segmented<Recipient>
                label={t('whatsapp.sendTo')}
                value={recipient}
                onChange={setRecipient}
                options={[
                  { value: 'lead', label: lead.firstName },
                  { value: 'guardian', label: t('whatsapp.guardian') },
                ]}
              />
            </Field>
          )}
        </div>

        <Field label={t('whatsapp.preview')} htmlFor="wa-text" hint={t('whatsapp.previewHint')}>
          <Textarea id="wa-text" rows={6} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} value={text} onChange={(e) => setEdited({ key, text: e.target.value })} />
        </Field>

        {href ? (
          <p className="text-xs text-muted">
            {t('whatsapp.to')}{' '}
            <bdi dir="ltr" className="font-medium text-ink">
              {phone}
            </bdi>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('whatsapp.badNumber')}
          </p>
        )}

        {canWrite && <Checkbox label={t('whatsapp.logIt')} checked={logIt} onChange={(e) => setLogIt(e.target.checked)} className="min-h-10" />}
      </div>
    </Modal>
  );
}
