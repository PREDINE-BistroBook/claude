import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@shared/enums';
import { COUNTRY_CODE_RE, internationalPhone } from '@shared/phone';
import { settingsInput, type AppSettings, type SettingsInput } from '@shared/schemas/settings';
import {
  Button,
  ButtonLink,
  ConfirmDialog,
  ErrorState,
  Field,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  PageHeader,
  PageLoader,
  Select,
  TextField,
  useToast,
} from '@web/components/ui';
import { api } from '@web/lib/api';
import { ME_KEY } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { errorMessageKey, useForm } from '@web/lib/forms';
import { CAFE_MENU_PATH } from '../cafe/utils';
import { teamKeys } from '../team/api';
import { BigSwitch } from '../website/components/BigSwitch';
import { CriteriaEditor, type CriterionDraft } from './CriteriaEditor';
import { fromDrafts, toDrafts } from './utils';

const SETTINGS_KEY = ['settings'] as const;
/** Offered week starts, in calendar order for the region: Saturday, Sunday, Monday. */
const WEEK_STARTS = [6, 0, 1] as const;

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.get<AppSettings>('/settings') });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {settings.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </div>
  );
}

function SettingsForm({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation(['settings', 'common']);
  const f = useFormat();
  const toast = useToast();
  const qc = useQueryClient();
  const form = useForm({
    schoolName: settings.schoolName,
    schoolNameAr: settings.schoolNameAr ?? '',
    defaultLocale: settings.defaultLocale as Locale,
    weekStartsOn: String(settings.weekStartsOn),
    defaultCountryCode: settings.defaultCountryCode,
  });
  // Criteria are a list, edited beside the plain fields; errors come back as 'interviewCriteria.<i>.<field>'.
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() => toDrafts(settings.interviewCriteria));
  // The cafeteria's switch is saved the moment it is turned (switching off asks first: it closes open orders).
  const [confirmCafeOff, setConfirmCafeOff] = useState(false);
  const refreshCafe = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
      qc.invalidateQueries({ queryKey: teamKeys.unread }),
      qc.invalidateQueries({ queryKey: teamKeys.notifications }),
      qc.invalidateQueries({ queryKey: ['cafe'] }),
    ]);
  const cafeSwitch = useMutation({
    mutationFn: (cafeteriaEnabled: boolean) => api.patch<AppSettings>('/settings', { cafeteriaEnabled }),
    onSuccess: async (saved) => {
      qc.setQueryData(SETTINGS_KEY, saved);
      setConfirmCafeOff(false);
      toast.success(t(saved.cafeteriaEnabled ? 'cafeteria.turnedOn' : 'cafeteria.turnedOff'));
      // Whether the cafeteria shows in the menus comes with the unread poll (and its pages with ['cafe']).
      await refreshCafe();
    },
    onError: (err) => {
      setConfirmCafeOff(false);
      toast.error(t(errorMessageKey(err)));
    },
  });
  const cafeteriaEnabled = settings.cafeteriaEnabled;

  const save = useMutation({
    mutationFn: (data: SettingsInput) => api.patch<AppSettings>('/settings', data),
    onSuccess: async (saved) => {
      qc.setQueryData(SETTINGS_KEY, saved);
      // New criteria got their keys on the server's copy: start again from it.
      setCriteria(toDrafts(saved.interviewCriteria));
      form.set('defaultCountryCode', saved.defaultCountryCode);
      form.set('schoolNameAr', saved.schoolNameAr ?? '');
      toast.success(t('saved'));
      // The school name (and its Arabic name) in the shell comes from /auth/me; the schedule reads the week start from ['settings'];
      // whether the cafeteria shows in the menus comes with the unread poll (and its pages with ['cafe']).
      await Promise.all([
        qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
        qc.invalidateQueries({ queryKey: ME_KEY }),
        qc.invalidateQueries({ queryKey: teamKeys.unread }),
        qc.invalidateQueries({ queryKey: ['cafe'] }),
      ]);
    },
    onError: form.setServerError,
  });

  const interviewCriteria = fromDrafts(criteria);
  // The cafeteria's switch saves itself (above): never sent again with the form, so an old value can't undo it.
  const candidate = { ...form.values, weekStartsOn: Number(form.values.weekStartsOn), interviewCriteria };
  const dirty =
    candidate.schoolName.trim() !== settings.schoolName ||
    (candidate.schoolNameAr.trim() || null) !== settings.schoolNameAr ||
    candidate.defaultLocale !== settings.defaultLocale ||
    candidate.weekStartsOn !== settings.weekStartsOn ||
    candidate.defaultCountryCode.replace(/[\s+]/g, '') !== settings.defaultCountryCode ||
    JSON.stringify(interviewCriteria) !== JSON.stringify(settings.interviewCriteria);
  const code = candidate.defaultCountryCode.replace(/[\s+]/g, '');
  const example = COUNTRY_CODE_RE.test(code) ? internationalPhone('01012345678', code) : null;

  return (
    <FormPage
      onSubmit={() => {
        const data = form.validate(settingsInput, candidate);
        if (data) save.mutate(data);
      }}
    >
      <FormError messageKey={form.formError} />
      <FormSection title={t('school.title')} description={t('school.description')}>
        <FormGrid>
          <TextField
            label={t('school.name')}
            placeholder={t('school.namePlaceholder')}
            autoComplete="organization"
            required
            {...form.bind('schoolName')}
            error={form.error('schoolName')}
          />
          <TextField
            label={t('school.nameAr')}
            placeholder={t('school.nameArPlaceholder')}
            autoComplete="off"
            dir="rtl"
            lang="ar"
            {...form.bind('schoolNameAr')}
            error={form.error('schoolNameAr')}
            hint={t('school.nameArHint')}
          />
        </FormGrid>
      </FormSection>

      <FormSection title={t('preferences.title')} description={t('preferences.description')}>
        <FormGrid>
          <Field label={t('preferences.defaultLanguage')} htmlFor="f-defaultLocale" error={form.error('defaultLocale')} hint={t('preferences.defaultLanguageHint')}>
            <Select {...form.bind('defaultLocale')}>
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {t(`common:enums.locale.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('preferences.weekStartsOn')} htmlFor="f-weekStartsOn" error={form.error('weekStartsOn')} hint={t('preferences.weekStartsOnHint')}>
            <Select {...form.bind('weekStartsOn')}>
              {WEEK_STARTS.map((d) => (
                <option key={d} value={d}>
                  {f.weekday(d, 'long')}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={t('criteria.title')} description={t('criteria.description')}>
        <CriteriaEditor
          value={criteria}
          onChange={(next) => {
            setCriteria(next);
            // Rows may have moved: drop the old per-row errors rather than pin them to the wrong row.
            form.setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('interviewCriteria'))));
          }}
          error={form.error}
        />
      </FormSection>

      <FormSection title={t('whatsapp.title')} description={t('whatsapp.description')}>
        <TextField
          label={t('whatsapp.countryCode')}
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          required
          className="sm:max-w-56"
          {...form.bind('defaultCountryCode')}
          error={form.error('defaultCountryCode')}
          hint={example ? t('whatsapp.example', { local: '01012345678', link: `wa.me/${example}` }) : t('whatsapp.countryCodeHint')}
        />
      </FormSection>

      <FormSection title={t('cafeteria.title')} description={t('cafeteria.description')}>
        <BigSwitch
          checked={cafeteriaEnabled}
          disabled={cafeSwitch.isPending}
          onChange={(on) => (on ? cafeSwitch.mutate(true) : setConfirmCafeOff(true))}
          label={t('cafeteria.switch')}
          description={cafeteriaEnabled ? t('cafeteria.on') : t('cafeteria.off')}
        />
        <p className="-mt-2 text-sm text-muted">{t('cafeteria.savedAtOnce')}</p>
        <ConfirmDialog
          open={confirmCafeOff}
          title={t('cafeteria.offTitle')}
          message={t('cafeteria.offMessage')}
          confirmLabel={t('cafeteria.offYes')}
          loading={cafeSwitch.isPending}
          onCancel={() => setConfirmCafeOff(false)}
          onConfirm={() => cafeSwitch.mutate(false)}
        />
        {/* The menu editor only opens while the cafeteria is switched on. */}
        {cafeteriaEnabled && (
          <ButtonLink to={CAFE_MENU_PATH} icon={UtensilsCrossed} size="lg" className="justify-self-start">
            {t('cafeteria.editMenu')}
          </ButtonLink>
        )}
      </FormSection>

      <FormActions>
        <Button type="submit" size="lg" variant="primary" loading={save.isPending} disabled={!dirty}>
          {save.isPending ? t('common:actions.saving') : t('common:actions.saveChanges')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
