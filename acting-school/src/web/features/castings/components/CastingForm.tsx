import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { CASTING_STATUSES, CASTING_TYPES, type CastingStatus } from '@shared/enums';
import { castingInput, type CastingDetail } from '@shared/schemas/castings';
import {
  Button,
  ButtonLink,
  EnumSelect,
  Field,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  TextAreaField,
  TextField,
  useToast,
} from '@web/components/ui';
import { useForm } from '@web/lib/forms';
import { useSaveCasting } from '../api';

interface CastingFormValues extends Record<string, unknown> {
  title: string;
  production: string;
  type: string;
  status: CastingStatus;
  castingDirector: string;
  contactEmail: string;
  contactPhone: string;
  submissionDeadline: string;
  shootStart: string;
  shootEnd: string;
  location: string;
  rate: string;
  description: string;
}

function initialValues(c?: CastingDetail): CastingFormValues {
  return {
    title: c?.title ?? '',
    production: c?.production ?? '',
    type: c?.type ?? '',
    status: c?.status ?? 'open',
    castingDirector: c?.castingDirector ?? '',
    contactEmail: c?.contactEmail ?? '',
    contactPhone: c?.contactPhone ?? '',
    submissionDeadline: c?.submissionDeadline ?? '',
    shootStart: c?.shootStart ?? '',
    shootEnd: c?.shootEnd ?? '',
    location: c?.location ?? '',
    rate: c?.rate ?? '',
    description: c?.description ?? '',
  };
}

/** Move focus to the first field with an error, so it's visible on a phone. */
function focusFirstError() {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('form [aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 0);
}

/** Create (no `casting`) or edit a casting. Used by /castings/new and /castings/:id/edit. */
export function CastingForm({ casting }: { casting?: CastingDetail }) {
  const { t } = useTranslation(['castings', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<CastingFormValues>(initialValues(casting));
  const save = useSaveCasting(casting?.id);
  const v = form.values;

  const submit = () => {
    // The form always sends every field, so the full create schema (with its
    // shoot-date order check) applies to edits too; the API re-checks a PATCH
    // against the stored values.
    const data = form.validate(castingInput);
    if (!data) return focusFirstError();
    save.mutate(data, {
      onSuccess: (saved) => {
        toast.success(casting ? t('form.saved') : t('form.created'));
        navigate(`/castings/${saved.id}`, { replace: true });
      },
      onError: (err) => {
        form.setServerError(err);
        focusFirstError();
      },
    });
  };

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />

      <FormSection title={t('form.project')}>
        <TextField
          label={t('form.title')}
          required
          autoComplete="off"
          dir="auto"
          placeholder={t('form.titlePlaceholder')}
          {...form.bind('title')}
          error={form.error('title')}
        />
        <FormGrid>
          <TextField
            label={t('form.production')}
            optional
            autoComplete="off"
            dir="auto"
            placeholder={t('form.productionPlaceholder')}
            className="sm:col-span-2"
            {...form.bind('production')}
            error={form.error('production')}
          />
          <Field label={t('form.type')} htmlFor="f-type" optional error={form.error('type')}>
            <EnumSelect group="castingType" values={CASTING_TYPES} allowEmpty {...form.bind('type')} />
          </Field>
          <Field label={t('form.status')} htmlFor="f-status" error={form.error('status')}>
            <EnumSelect group="castingStatus" values={CASTING_STATUSES} {...form.bind('status')} />
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={t('form.contact')} description={t('form.contactHint')}>
        <TextField
          label={t('form.castingDirector')}
          optional
          autoComplete="off"
          dir="auto"
          {...form.bind('castingDirector')}
          error={form.error('castingDirector')}
        />
        <FormGrid>
          <TextField
            label={t('form.contactEmail')}
            type="email"
            inputMode="email"
            autoComplete="off"
            dir="ltr"
            optional
            {...form.bind('contactEmail')}
            error={form.error('contactEmail')}
          />
          <TextField
            label={t('form.contactPhone')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            optional
            {...form.bind('contactPhone')}
            error={form.error('contactPhone')}
          />
        </FormGrid>
      </FormSection>

      <FormSection title={t('form.datesPlace')}>
        <FormGrid cols={3}>
          <TextField
            label={t('form.submissionDeadline')}
            type="date"
            optional
            {...form.bind('submissionDeadline')}
            error={form.error('submissionDeadline')}
          />
          <TextField label={t('form.shootStart')} type="date" optional {...form.bind('shootStart')} error={form.error('shootStart')} />
          <TextField
            label={t('form.shootEnd')}
            type="date"
            optional
            min={v.shootStart || undefined}
            {...form.bind('shootEnd')}
            error={form.error('shootEnd')}
          />
        </FormGrid>
        <TextField
          label={t('form.location')}
          optional
          autoComplete="off"
          dir="auto"
          placeholder={t('form.locationPlaceholder')}
          {...form.bind('location')}
          error={form.error('location')}
        />
      </FormSection>

      <FormSection title={t('form.details')}>
        <TextField
          label={t('form.rate')}
          optional
          autoComplete="off"
          dir="auto"
          placeholder={t('form.ratePlaceholder')}
          hint={t('form.rateHint')}
          {...form.bind('rate')}
          error={form.error('rate')}
        />
        <TextAreaField
          label={t('form.description')}
          optional
          rows={6}
          dir="auto"
          placeholder={t('form.descriptionPlaceholder')}
          {...form.bind('description')}
          error={form.error('description')}
        />
      </FormSection>

      <FormActions>
        <ButtonLink to={casting ? `/castings/${casting.id}` : '/castings'} variant="ghost">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : casting ? t('common:actions.saveChanges') : t('common:actions.create')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
