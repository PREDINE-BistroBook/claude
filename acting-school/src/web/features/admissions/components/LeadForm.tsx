import clsx from 'clsx';
import { TriangleAlert, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { todayISO } from '@shared/dates';
import { GENDERS, LEAD_SOURCES, isClosedLeadStatus, type LeadSource } from '@shared/enums';
import { MIN_PHONE_DIGITS, phoneDigits } from '@shared/phone';
import { leadInput, type LeadDetail } from '@shared/schemas/admissions';
import {
  Badge,
  Button,
  ButtonLink,
  EnumSelect,
  Field,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  StatusBadge,
  TextAreaField,
  TextField,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { ageOn } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { useDebounced } from '@web/lib/hooks';
import { admissionsErrorKey, useCourseOptions, useLeadDuplicates, useSaveLead } from '../api';
import { CourseSelect, FollowUpPicker, StaffSelect } from './bits';

interface LeadFormValues extends Record<string, unknown> {
  firstName: string;
  lastName: string;
  phone: string;
  source: LeadSource;
  email: string;
  dateOfBirth: string;
  gender: string;
  city: string;
  sourceDetail: string;
  guardianName: string;
  guardianPhone: string;
  interest: string;
  experience: string;
  preferredCourseId: string;
  assignedToId: string;
  nextFollowUpOn: string;
  notes: string;
}

function initialValues(lead: LeadDetail | undefined, me: number | undefined): LeadFormValues {
  return {
    firstName: lead?.firstName ?? '',
    lastName: lead?.lastName ?? '',
    phone: lead?.phone ?? '',
    source: lead?.source ?? 'whatsapp',
    email: lead?.email ?? '',
    dateOfBirth: lead?.dateOfBirth ?? '',
    gender: lead?.gender ?? '',
    city: lead?.city ?? '',
    sourceDetail: lead?.sourceDetail ?? '',
    guardianName: lead?.guardianName ?? '',
    guardianPhone: lead?.guardianPhone ?? '',
    interest: lead?.interest ?? '',
    experience: lead?.experience ?? '',
    preferredCourseId: lead?.preferredCourseId ? String(lead.preferredCourseId) : '',
    // A new enquiry is the creator's to follow up unless someone else is picked.
    assignedToId: lead ? (lead.assignedToId ? String(lead.assignedToId) : '') : me ? String(me) : '',
    nextFollowUpOn: lead?.nextFollowUpOn ?? '',
    notes: lead?.notes ?? '',
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

/** Create (no `lead`) or edit an enquiry. Used by /admissions/new and /admissions/:id/edit. */
export function LeadForm({ lead }: { lead?: LeadDetail }) {
  const { t } = useTranslation(['admissions', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const form = useForm<LeadFormValues>(initialValues(lead, user?.id));
  const save = useSaveLead(lead?.id);
  const courses = useCourseOptions();
  const v = form.values;

  const age = ageOn(v.dateOfBirth || null);
  const isMinor = age !== null && age >= 0 && age < 18;
  const showGuardian = isMinor || !!v.guardianName || !!v.guardianPhone;
  // Closed leads (enrolled / declined / lost) have no follow-up; the server refuses one.
  const closed = !!lead && isClosedLeadStatus(lead.status);

  const submit = () => {
    const data = form.validate(leadInput);
    if (!data) return focusFirstError();
    if (closed) delete data.nextFollowUpOn;
    save.mutate(data, {
      onSuccess: (saved) => {
        toast.success(lead ? t('form.saved') : t('form.created'));
        navigate(`/admissions/${saved.id}`, { replace: true });
      },
      onError: (err) => {
        if (err instanceof ApiError && err.issues?.length) form.setServerError(err);
        else form.setFormError(admissionsErrorKey(err));
        focusFirstError();
      },
    });
  };

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />

      <FormSection title={t('form.quick')} description={t('form.quickHint')}>
        <FormGrid>
          <TextField label={t('common:fields.firstName')} required autoComplete="off" {...form.bind('firstName')} error={form.error('firstName')} />
          <TextField label={t('common:fields.lastName')} required autoComplete="off" {...form.bind('lastName')} error={form.error('lastName')} />
          <TextField
            label={t('common:fields.phone')}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            dir="ltr"
            required
            placeholder="010 1234 5678"
            {...form.bind('phone')}
            error={form.error('phone')}
          />
          <Field label={t('fields.source')} htmlFor="f-source" error={form.error('source')}>
            <EnumSelect group="leadSource" values={LEAD_SOURCES} {...form.bind('source')} />
          </Field>
        </FormGrid>
        <DuplicateWarning phone={v.phone} email={v.email} excludeLeadId={lead?.id} />
      </FormSection>

      <FormSection title={t('form.details')}>
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
          <TextField label={t('fields.city')} autoComplete="off" optional {...form.bind('city')} error={form.error('city')} />
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
          <TextField
            label={t('fields.sourceDetail')}
            autoComplete="off"
            optional
            className="sm:col-span-2"
            placeholder={t('form.sourceDetailPlaceholder')}
            {...form.bind('sourceDetail')}
            error={form.error('sourceDetail')}
          />
        </FormGrid>
      </FormSection>

      {showGuardian && (
        <FormSection
          title={
            <span className="flex flex-wrap items-center gap-2">
              {t('form.guardian')}
              {isMinor && <Badge tone="warning">{t('form.minor')}</Badge>}
            </span>
          }
          className={clsx(isMinor && 'border-warning/60 ring-1 ring-warning/30')}
        >
          {isMinor && (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning" role="note">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('form.guardianMinor')}
            </p>
          )}
          <FormGrid>
            <TextField label={t('fields.guardianName')} autoComplete="off" optional={!isMinor} {...form.bind('guardianName')} error={form.error('guardianName')} />
            <TextField
              label={t('fields.guardianPhone')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              dir="ltr"
              optional={!isMinor}
              {...form.bind('guardianPhone')}
              error={form.error('guardianPhone')}
            />
          </FormGrid>
        </FormSection>
      )}

      <FormSection title={t('form.interestTitle')}>
        <TextAreaField
          label={t('fields.interest')}
          optional
          rows={3}
          dir="auto"
          placeholder={t('form.interestPlaceholder')}
          {...form.bind('interest')}
          error={form.error('interest')}
        />
        <TextAreaField
          label={t('fields.experience')}
          optional
          rows={3}
          dir="auto"
          placeholder={t('form.experiencePlaceholder')}
          {...form.bind('experience')}
          error={form.error('experience')}
        />
      </FormSection>

      <FormSection title={t('form.followUpTitle')}>
        <FormGrid>
          <CourseSelect
            label={t('fields.preferredCourse')}
            emptyLabel={t('form.noPreference')}
            optional
            options={courses.data?.items ?? []}
            loading={courses.isPending}
            current={lead?.preferredCourse ? { id: lead.preferredCourse.id, name: lead.preferredCourse.name } : null}
            hint={courses.isError ? t('form.classesError') : undefined}
            {...form.bind('preferredCourseId')}
            error={form.error('preferredCourseId')}
          />
          <StaffSelect
            label={t('fields.assignedTo')}
            emptyLabel={t('form.unassigned')}
            optional
            current={lead?.assignedToId ? { id: lead.assignedToId, name: lead.assignedToName } : null}
            {...form.bind('assignedToId')}
            error={form.error('assignedToId')}
          />
        </FormGrid>
        {!closed && (
          <FollowUpPicker
            id="f-nextFollowUpOn"
            optional
            value={v.nextFollowUpOn}
            onChange={(d) => form.set('nextFollowUpOn', d)}
            error={form.error('nextFollowUpOn')}
          />
        )}
        <TextAreaField label={t('fields.notes')} optional rows={4} dir="auto" {...form.bind('notes')} error={form.error('notes')} />
      </FormSection>

      <FormActions>
        <ButtonLink to={lead ? `/admissions/${lead.id}` : '/admissions'} variant="ghost">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : lead ? t('common:actions.saveChanges') : t('common:actions.save')}
        </Button>
      </FormActions>
    </FormPage>
  );
}

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Warns (never blocks) when the phone or email typed already belongs to an open
 * enquiry or a student — names only, linking to them.
 */
function DuplicateWarning({ phone, email, excludeLeadId }: { phone: string; email: string; excludeLeadId?: number }) {
  const { t } = useTranslation(['admissions', 'common']);
  const { can } = useAuth();
  const p = useDebounced(phone.trim(), 400);
  const e = useDebounced(email.trim(), 400);
  const params = {
    phone: phoneDigits(p).length >= MIN_PHONE_DIGITS ? p : undefined,
    email: EMAIL_LIKE.test(e) ? e : undefined,
    excludeLeadId,
  };
  const enabled = !!(params.phone || params.email);
  const dupes = useLeadDuplicates(params, enabled);
  const items = enabled ? (dupes.data?.items ?? []) : [];
  if (!items.length) return null;
  return (
    <div role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-3 text-sm">
      <p className="flex items-start gap-2 font-medium text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('duplicates.title', { count: items.length })}
      </p>
      <ul className="mt-2 grid gap-1.5 ps-6">
        {items.map((m) => {
          const label = (
            <span className="inline-flex min-w-0 items-center gap-2">
              <bdi className="truncate font-medium">{m.name}</bdi>
              {m.kind === 'lead' ? (
                <StatusBadge group="leadStatus" value={m.status} />
              ) : (
                <Badge tone="info">
                  <UserRound className="size-3" aria-hidden />
                  {t('duplicates.student')}
                </Badge>
              )}
            </span>
          );
          const to = m.kind === 'lead' ? `/admissions/${m.id}` : can('students.read') ? `/students/${m.id}` : null;
          return (
            <li key={`${m.kind}-${m.id}`} className="min-w-0">
              {to ? (
                <Link to={to} className="text-ink underline decoration-warning/50 underline-offset-2 hover:decoration-warning">
                  {label}
                </Link>
              ) : (
                <span className="text-ink">{label}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 ps-6 text-xs text-ink/75">{t('duplicates.hint')}</p>
    </div>
  );
}
