import clsx from 'clsx';
import { Lock, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { todayISO } from '@shared/dates';
import { GENDERS, STUDENT_STATUSES, type StudentStatus } from '@shared/enums';
import { STUDENT_CONTACT_FIELDS, studentInput, type Student } from '@shared/schemas/students';
import {
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  EnumSelect,
  Field,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  PhotoInput,
  Textarea,
  TextField,
  useToast,
} from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { ageOn } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { useSaveStudent } from '../api';

interface StudentFormValues extends Record<string, unknown> {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  status: StudentStatus;
  joinedOn: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  emergencyName: string;
  emergencyPhone: string;
  photoFileId: string | null;
  mediaConsent: boolean;
  notes: string;
}

function initialValues(s?: Student): StudentFormValues {
  return {
    firstName: s?.firstName ?? '',
    lastName: s?.lastName ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    dateOfBirth: s?.dateOfBirth ?? '',
    gender: s?.gender ?? '',
    status: s?.status ?? 'active',
    joinedOn: s ? (s.joinedOn ?? '') : todayISO(),
    guardianName: s?.guardianName ?? '',
    guardianPhone: s?.guardianPhone ?? '',
    guardianEmail: s?.guardianEmail ?? '',
    emergencyName: s?.emergencyName ?? '',
    emergencyPhone: s?.emergencyPhone ?? '',
    photoFileId: s?.photoFileId ?? null,
    mediaConsent: s?.mediaConsent ?? false,
    notes: s?.notes ?? '',
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

/** Create (no `student`) or edit a student. Used by /students/new and /students/:id/edit. */
export function StudentForm({ student }: { student?: Student }) {
  const { t } = useTranslation(['students', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const form = useForm<StudentFormValues>(initialValues(student));
  const save = useSaveStudent(student?.id);
  const consentHintId = useId();
  const v = form.values;
  // Without students.contact the contact sections aren't shown or sent (the API would ignore them anyway).
  // Nor when the record was loaded without them (contactHidden): its contact fields are empty placeholders,
  // and sending them after a permission was granted meanwhile would wipe the real contacts.
  const { can } = useAuth();
  const withContact = can('students.contact') && !student?.contactHidden;

  const age = ageOn(v.dateOfBirth || null);
  const isMinor = age !== null && age < 18;
  const displayName = `${v.firstName} ${v.lastName}`.trim();

  const submit = () => {
    const data = form.validate(studentInput);
    if (!data) return focusFirstError();
    if (!withContact) for (const f of STUDENT_CONTACT_FIELDS) delete data[f];
    save.mutate(data, {
      onSuccess: (saved) => {
        toast.success(student ? t('form.saved') : t('form.created'));
        navigate(`/students/${saved.id}`, { replace: true });
      },
      onError: (err) => {
        form.setServerError(err);
        focusFirstError();
      },
    });
  };

  const photoError = form.error('photoFileId');

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />

      <FormSection title={t('form.photo')} description={t('form.photoHint')}>
        <PhotoInput value={v.photoFileId} onChange={(id) => form.set('photoFileId', id)} name={displayName} discardReplaced />
        {photoError && (
          <p className="text-sm text-danger" role="alert">
            {t(photoError)}
          </p>
        )}
      </FormSection>

      <FormSection title={t('form.personal')}>
        <FormGrid>
          <TextField label={t('common:fields.firstName')} required autoComplete="off" {...form.bind('firstName')} error={form.error('firstName')} />
          <TextField label={t('common:fields.lastName')} required autoComplete="off" {...form.bind('lastName')} error={form.error('lastName')} />
          <TextField
            label={t('common:fields.dateOfBirth')}
            type="date"
            optional
            max={todayISO()}
            {...form.bind('dateOfBirth')}
            error={form.error('dateOfBirth')}
            hint={age !== null && age >= 0 ? t('form.ageHint', { age: t('common:units.years', { count: age }) }) : undefined}
          />
          <Field label={t('common:fields.gender')} htmlFor="f-gender" optional error={form.error('gender')}>
            <EnumSelect group="gender" values={GENDERS} allowEmpty {...form.bind('gender')} />
          </Field>
          <Field label={t('common:fields.status')} htmlFor="f-status" error={form.error('status')}>
            <EnumSelect group="studentStatus" values={STUDENT_STATUSES} {...form.bind('status')} />
          </Field>
          <TextField label={t('form.joinedOn')} type="date" optional {...form.bind('joinedOn')} error={form.error('joinedOn')} />
        </FormGrid>
      </FormSection>

      {withContact ? (
        <>
          <FormSection title={t('form.contact')} description={t('form.contactHint')}>
            <FormGrid>
              <TextField
                label={t('common:fields.email')}
                type="email"
                inputMode="email"
                autoComplete="off"
                dir="ltr"
                optional
                {...form.bind('email')}
                error={form.error('email')}
              />
              <TextField label={t('common:fields.phone')} type="tel" inputMode="tel" autoComplete="off" dir="ltr" optional {...form.bind('phone')} error={form.error('phone')} />
            </FormGrid>
          </FormSection>

          <FormSection
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t('form.guardian')}
                {isMinor && <Badge tone="warning">{t('form.minor')}</Badge>}
              </span>
            }
            description={isMinor ? undefined : t('form.guardianHint')}
            className={clsx(isMinor && 'border-warning/60 ring-1 ring-warning/30')}
          >
            {isMinor && (
              <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning" role="note">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('form.guardianMinor')}
              </p>
            )}
            <FormGrid>
              <TextField
                label={t('form.guardianName')}
                autoComplete="off"
                className="sm:col-span-2"
                optional={!isMinor}
                {...form.bind('guardianName')}
                error={form.error('guardianName')}
              />
              <TextField
                label={t('form.guardianPhone')}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                optional={!isMinor}
                {...form.bind('guardianPhone')}
                error={form.error('guardianPhone')}
              />
              <TextField
                label={t('form.guardianEmail')}
                type="email"
                inputMode="email"
                autoComplete="off"
                dir="ltr"
                optional
                {...form.bind('guardianEmail')}
                error={form.error('guardianEmail')}
              />
            </FormGrid>
          </FormSection>

          <FormSection title={t('form.emergency')} description={t('form.emergencyHint')}>
            <FormGrid>
              <TextField label={t('form.emergencyName')} autoComplete="off" optional {...form.bind('emergencyName')} error={form.error('emergencyName')} />
              <TextField
                label={t('form.emergencyPhone')}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                optional
                {...form.bind('emergencyPhone')}
                error={form.error('emergencyPhone')}
              />
            </FormGrid>
          </FormSection>
        </>
      ) : (
        <p className="flex items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-sm text-muted" role="note">
          <Lock className="size-4 shrink-0" aria-hidden />
          {t('common:states.contactHidden')}
        </p>
      )}

      <FormSection title={t('form.consent')}>
        <div>
          <Checkbox
            id="f-mediaConsent"
            label={<span className="font-medium">{t('form.mediaConsent')}</span>}
            checked={v.mediaConsent}
            onChange={(e) => form.set('mediaConsent', e.target.checked)}
            aria-describedby={consentHintId}
            className="min-h-10"
          />
          <p id={consentHintId} className="ps-[1.625rem] text-sm text-muted">
            {t('form.mediaConsentHint')}
          </p>
        </div>
      </FormSection>

      <FormSection title={t('form.notes')}>
        <Field htmlFor="f-notes" error={form.error('notes')}>
          <Textarea rows={5} dir="auto" aria-label={t('form.notes')} placeholder={t('form.notesPlaceholder')} {...form.bind('notes')} />
        </Field>
      </FormSection>

      <FormActions>
        <ButtonLink to={student ? `/students/${student.id}` : '/students'} variant="ghost">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : student ? t('common:actions.saveChanges') : t('common:actions.save')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
