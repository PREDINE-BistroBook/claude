import clsx from 'clsx';
import { ChevronDown, HandCoins, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { OPPORTUNITY_PROJECT_TYPES } from '@shared/enums';
import { opportunityInput, type Opportunity } from '@shared/schemas/opportunities';
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
import { useForm } from '@web/lib/forms';
import { useOpportunity, useSaveOpportunity } from './api';
import { ScreenshotsInput } from './components/ScreenshotsInput';

interface Values extends Record<string, unknown> {
  title: string;
  source: string;
  link: string;
  fileIds: string[];
  deadline: string;
  roles: string;
  contact: string;
  asksForPayment: boolean;
  involvesMinors: boolean;
  details: string;
  projectType: string;
  location: string;
}

const initial = (o?: Opportunity): Values => ({
  title: o?.title ?? '',
  source: o?.source ?? '',
  link: o?.link ?? '',
  fileIds: o?.files.map((f) => f.fileId) ?? [],
  deadline: o?.deadline ?? '',
  roles: o?.roles ?? '',
  contact: o?.contact ?? '',
  asksForPayment: o?.asksForPayment ?? false,
  involvesMinors: o?.involvesMinors ?? false,
  details: o?.details ?? '',
  projectType: o?.projectType ?? '',
  location: o?.location ?? '',
});

/** /casting/opportunities/new and /:id/edit. */
export default function OpportunityFormPage() {
  const raw = useParams().id;
  const id = raw ? Number(raw) : undefined;
  const existing = useOpportunity(id ?? 0, id !== undefined);
  if (id === undefined) return <OpportunityForm />;
  if (existing.isPending) return <PageLoader />;
  if (existing.isError) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  return <OpportunityForm opportunity={existing.data} />;
}

/** Move focus to the first field with an error, so it's visible on a phone. */
function focusFirstError() {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('form [aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 0);
}

/**
 * The "Add opportunity" form, made for a phone: only the title is needed;
 * where it was seen, the link, screenshots from the gallery or the camera,
 * the deadline, the roles, the contact, the two warnings and notes are there
 * for what the person knows. Project type and location wait under "More".
 */
function OpportunityForm({ opportunity }: { opportunity?: Opportunity }) {
  const { t } = useTranslation(['opportunities', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<Values>(initial(opportunity));
  const save = useSaveOpportunity(opportunity?.id);
  const v = form.values;
  const back = opportunity ? `/casting/opportunities/${opportunity.id}` : '/casting/opportunities';

  const submit = () => {
    const data = form.validate(opportunityInput);
    if (!data) return focusFirstError();
    save.mutate(data, {
      onSuccess: (saved) => {
        toast.success(t(opportunity ? 'toast.saved' : 'toast.added'));
        navigate(`/casting/opportunities/${saved.id}`, { replace: true });
      },
      onError: (err) => {
        form.setServerError(err);
        focusFirstError();
      },
    });
  };

  const box = 'flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-base';

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t(opportunity ? 'form.editTitle' : 'form.addTitle')} subtitle={t('form.intro')} back={back} />
      </div>
      <FormPage onSubmit={submit}>
        <FormError messageKey={form.formError} />
        <FormSection>
          <TextField label={t('form.title')} required placeholder={t('form.titlePlaceholder')} {...form.bind('title')} error={form.error('title')} dir="auto" />
          <TextField label={t('form.source')} optional placeholder={t('form.sourcePlaceholder')} {...form.bind('source')} error={form.error('source')} dir="auto" />
          <TextField
            label={t('form.link')}
            optional
            type="url"
            inputMode="url"
            dir="ltr"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            hint={t('form.linkHint')}
            {...form.bind('link')}
            error={form.error('link')}
          />
          <Field label={t('form.screenshots')} optional htmlFor="screenshots">
            <ScreenshotsInput value={v.fileIds} onChange={(ids) => form.set('fileIds', ids)} error={form.error('fileIds')} />
          </Field>
        </FormSection>

        <FormSection>
          <FormGrid>
            <TextField label={t('form.deadline')} optional type="date" {...form.bind('deadline')} error={form.error('deadline')} />
            <TextField label={t('form.contact')} optional placeholder={t('form.contactPlaceholder')} {...form.bind('contact')} error={form.error('contact')} dir="auto" />
          </FormGrid>
          <TextAreaField label={t('form.roles')} optional rows={2} placeholder={t('form.rolesPlaceholder')} {...form.bind('roles')} error={form.error('roles')} dir="auto" />
          <label className={clsx(box, v.asksForPayment ? 'border-danger bg-danger-soft' : 'border-line-strong')}>
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-[var(--danger)]"
              checked={v.asksForPayment}
              onChange={(e) => form.set('asksForPayment', e.target.checked)}
              data-testid="asks-for-payment"
            />
            <span className="min-w-0">
              <span className={clsx('flex items-center gap-1.5 font-medium', v.asksForPayment ? 'text-danger' : 'text-ink')}>
                <HandCoins className="size-4 shrink-0" aria-hidden />
                {t('form.asksForPayment')}
              </span>
              <span className="mt-0.5 block text-sm text-muted">{t('form.asksForPaymentHint')}</span>
            </span>
          </label>
          <label className={clsx(box, 'border-line-strong')}>
            <input type="checkbox" className="mt-1 size-5 shrink-0" checked={v.involvesMinors} onChange={(e) => form.set('involvesMinors', e.target.checked)} />
            <span className="font-medium text-ink">{t('form.involvesMinors')}</span>
          </label>
          <TextAreaField label={t('form.details')} optional rows={3} {...form.bind('details')} error={form.error('details')} dir="auto" />
        </FormSection>

        <details className="group rounded-2xl border border-line bg-surface" open={!!(v.projectType || v.location) || undefined}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold text-ink sm:px-5">
            {t('form.more')}
            <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid gap-4 px-4 pb-4 sm:px-5 sm:pb-5">
            <FormGrid>
              <Field label={t('form.projectType')} htmlFor="f-projectType" optional error={form.error('projectType')}>
                <EnumSelect group="opportunityProjectType" values={OPPORTUNITY_PROJECT_TYPES} allowEmpty {...form.bind('projectType')} />
              </Field>
              <TextField label={t('form.location')} optional {...form.bind('location')} error={form.error('location')} dir="auto" />
            </FormGrid>
          </div>
        </details>

        <FormActions>
          <ButtonLink to={back} size="lg">
            {t('common:actions.cancel')}
          </ButtonLink>
          <Button type="submit" variant="primary" size="lg" icon={Save} loading={save.isPending} data-testid="save-opportunity">
            {t(opportunity ? 'form.save' : 'form.add')}
          </Button>
        </FormActions>
      </FormPage>
    </div>
  );
}
