import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { todayISO } from '@shared/dates';
import { GENDERS, TALENT_STATUSES, type TalentStatus } from '@shared/enums';
import type { StudentDetail } from '@shared/schemas/students';
import { talentInput, type Talent } from '@shared/schemas/talent';
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
  Input,
  TagInput,
  Textarea,
  TextField,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { ageOn } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { addTalentPhoto, talentKeys, useSaveTalent, useTalentTags } from '../api';

interface TalentFormValues extends Record<string, unknown> {
  firstName: string;
  lastName: string;
  stageName: string;
  dateOfBirth: string;
  gender: string;
  status: TalentStatus;
  representedSince: string;
  playingAgeMin: string;
  playingAgeMax: string;
  heightCm: string;
  eyeColor: string;
  hairColor: string;
  city: string;
  skills: string[];
  languages: string[];
  showreelUrl: string;
  instagram: string;
  email: string;
  phone: string;
  notes: string;
}

const num = (n: number | null | undefined) => (n == null ? '' : String(n));

function initialValues(p?: Talent, student?: StudentDetail): TalentFormValues {
  return {
    firstName: p?.firstName ?? student?.firstName ?? '',
    lastName: p?.lastName ?? student?.lastName ?? '',
    stageName: p?.stageName ?? '',
    dateOfBirth: p?.dateOfBirth ?? student?.dateOfBirth ?? '',
    gender: p?.gender ?? student?.gender ?? '',
    status: p?.status ?? 'active',
    representedSince: p ? (p.representedSince ?? '') : todayISO(),
    playingAgeMin: num(p?.playingAgeMin),
    playingAgeMax: num(p?.playingAgeMax),
    heightCm: num(p?.heightCm),
    eyeColor: p?.eyeColor ?? '',
    hairColor: p?.hairColor ?? '',
    city: p?.city ?? '',
    skills: p?.skills ?? [],
    languages: p?.languages ?? [],
    showreelUrl: p?.showreelUrl ?? '',
    instagram: p?.instagram ?? '',
    email: p?.email ?? student?.email ?? '',
    phone: p?.phone ?? student?.phone ?? '',
    notes: p?.notes ?? '',
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

/**
 * Create (no `talent`) or edit a profile. `student` prefills a new profile from
 * a student record and links it; their photo becomes the first headshot.
 * Photos themselves are managed on the profile page, not here.
 */
export function TalentForm({ talent, student }: { talent?: Talent; student?: StudentDetail }) {
  const { t } = useTranslation(['talent', 'common']);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const form = useForm<TalentFormValues>(initialValues(talent, student));
  const save = useSaveTalent(talent?.id);
  const tags = useTalentTags();
  const v = form.values;
  const age = ageOn(v.dateOfBirth || null);

  const submit = () => {
    const data = form.validate(talentInput, {
      ...v,
      instagram: v.instagram.replace(/^@+/, ''),
      // A new profile from a student is linked to it; editing never changes the link.
      ...(talent ? {} : { studentId: student?.id ?? null }),
    });
    if (!data) return focusFirstError();
    save.mutate(data, {
      onSuccess: async (saved) => {
        if (!talent && student?.photoFileId) {
          try {
            await addTalentPhoto(saved.id, student.photoFileId);
            await qc.invalidateQueries({ queryKey: talentKeys.all });
          } catch {
            toast.error(t('form.photoCopyFailed'));
          }
        }
        toast.success(talent ? t('form.saved') : t('form.created'));
        navigate(`/talent/${saved.id}`, { replace: true });
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'student_already_talent') form.setFormError('talent:errors.studentAlreadyTalent');
        else form.setServerError(err);
        if (err instanceof ApiError && !err.issues?.length) window.scrollTo({ top: 0, behavior: 'smooth' });
        focusFirstError();
      },
    });
  };

  const ageError = form.error('playingAgeMin') ?? form.error('playingAgeMax');

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError ?? form.error('studentId') ?? form.error('headshotFileId')} />

      <FormSection title={t('form.basics')}>
        <FormGrid>
          <TextField label={t('common:fields.firstName')} required autoComplete="off" dir="auto" {...form.bind('firstName')} error={form.error('firstName')} />
          <TextField label={t('common:fields.lastName')} required autoComplete="off" dir="auto" {...form.bind('lastName')} error={form.error('lastName')} />
          <TextField
            label={t('form.stageName')}
            optional
            autoComplete="off"
            dir="auto"
            className="sm:col-span-2"
            hint={t('form.stageNameHint')}
            {...form.bind('stageName')}
            error={form.error('stageName')}
          />
          <TextField
            label={t('common:fields.dateOfBirth')}
            type="date"
            optional
            max={todayISO()}
            {...form.bind('dateOfBirth')}
            error={form.error('dateOfBirth')}
            hint={age !== null && age >= 0 ? t('common:units.years', { count: age }) : undefined}
          />
          <Field label={t('common:fields.gender')} htmlFor="f-gender" optional error={form.error('gender')}>
            <EnumSelect group="gender" values={GENDERS} allowEmpty {...form.bind('gender')} />
          </Field>
          <Field label={t('common:fields.status')} htmlFor="f-status" error={form.error('status')}>
            <EnumSelect group="talentStatus" values={TALENT_STATUSES} {...form.bind('status')} />
          </Field>
          <TextField label={t('form.representedSince')} type="date" optional {...form.bind('representedSince')} error={form.error('representedSince')} />
        </FormGrid>
      </FormSection>

      <FormSection title={t('form.castingProfile')} description={t('form.castingProfileHint')}>
        <FormGrid>
          <Field label={t('form.playingAge')} htmlFor="f-playingAgeMin" optional error={ageError} hint={t('form.playingAgeHint')}>
            <div className="flex items-center gap-2">
              <Input
                {...form.bind('playingAgeMin')}
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                placeholder="18"
                aria-label={t('form.playingAgeMin')}
                className="min-w-0 flex-1 tabular-nums"
              />
              <span className="shrink-0 text-muted" aria-hidden>
                –
              </span>
              <Input
                {...form.bind('playingAgeMax')}
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                placeholder="25"
                aria-label={t('form.playingAgeMax')}
                className="min-w-0 flex-1 tabular-nums"
              />
            </div>
          </Field>
          <Field label={t('form.height')} htmlFor="f-heightCm" optional error={form.error('heightCm')}>
            <div className="relative">
              <Input {...form.bind('heightCm')} type="number" inputMode="numeric" min={30} max={250} placeholder="170" className="pe-12 tabular-nums" />
              <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted">{t('form.cm')}</span>
            </div>
          </Field>
          <TextField
            label={t('form.eyeColor')}
            optional
            autoComplete="off"
            dir="auto"
            placeholder={t('form.eyeColorPlaceholder')}
            {...form.bind('eyeColor')}
            error={form.error('eyeColor')}
          />
          <TextField
            label={t('form.hairColor')}
            optional
            autoComplete="off"
            dir="auto"
            placeholder={t('form.hairColorPlaceholder')}
            {...form.bind('hairColor')}
            error={form.error('hairColor')}
          />
          <TextField
            label={t('form.city')}
            optional
            autoComplete="off"
            dir="auto"
            placeholder={t('form.cityPlaceholder')}
            {...form.bind('city')}
            error={form.error('city')}
          />
        </FormGrid>
      </FormSection>

      <FormSection title={t('form.skillsLanguages')} description={t('form.skillsLanguagesHint')}>
        <Field label={t('form.skills')} htmlFor="f-skills" optional error={form.error('skills')} className="min-w-0">
          <TagInput
            id="f-skills"
            value={v.skills}
            onChange={(next) => form.set('skills', next)}
            suggestions={tags.data?.skills}
            placeholder={t('form.skillsPlaceholder')}
            max={100}
          />
        </Field>
        <Field label={t('form.languages')} htmlFor="f-languages" optional error={form.error('languages')} className="min-w-0">
          <TagInput
            id="f-languages"
            value={v.languages}
            onChange={(next) => form.set('languages', next)}
            suggestions={tags.data?.languages}
            placeholder={t('form.languagesPlaceholder')}
            max={30}
          />
        </Field>
      </FormSection>

      <FormSection title={t('form.links')}>
        <FormGrid>
          <TextField
            label={t('form.showreel')}
            type="url"
            inputMode="url"
            autoComplete="off"
            dir="ltr"
            optional
            placeholder={t('form.showreelPlaceholder')}
            {...form.bind('showreelUrl')}
            error={form.error('showreelUrl')}
          />
          <Field label={t('form.instagram')} htmlFor="f-instagram" optional error={form.error('instagram')} hint={t('form.instagramHint')}>
            <div className="relative" dir="ltr">
              <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
                @
              </span>
              <Input
                {...form.bind('instagram')}
                onChange={(e) => form.set('instagram', e.target.value.replace(/^@+/, ''))}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t('form.instagramPlaceholder')}
                className="ps-8"
              />
            </div>
          </Field>
        </FormGrid>
      </FormSection>

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

      <FormSection title={t('form.notes')}>
        <Field htmlFor="f-notes" error={form.error('notes')}>
          <Textarea rows={5} dir="auto" aria-label={t('form.notes')} placeholder={t('form.notesPlaceholder')} {...form.bind('notes')} />
        </Field>
      </FormSection>

      <FormActions>
        <ButtonLink to={talent ? `/talent/${talent.id}` : '/talent'} variant="ghost">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {save.isPending ? t('common:actions.saving') : talent ? t('common:actions.saveChanges') : t('common:actions.save')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
