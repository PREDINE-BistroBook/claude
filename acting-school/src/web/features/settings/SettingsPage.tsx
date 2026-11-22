import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@shared/enums';
import { settingsInput, type AppSettings } from '@shared/schemas/settings';
import {
  Button,
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
import { useForm } from '@web/lib/forms';

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
    defaultLocale: settings.defaultLocale as Locale,
    weekStartsOn: String(settings.weekStartsOn),
  });

  const save = useMutation({
    mutationFn: (data: Partial<AppSettings>) => api.patch<AppSettings>('/settings', data),
    onSuccess: async (saved) => {
      qc.setQueryData(SETTINGS_KEY, saved);
      toast.success(t('saved'));
      // The school name in the shell comes from /auth/me; the schedule reads the week start from ['settings'].
      await Promise.all([qc.invalidateQueries({ queryKey: SETTINGS_KEY }), qc.invalidateQueries({ queryKey: ME_KEY })]);
    },
    onError: form.setServerError,
  });

  const candidate = { ...form.values, weekStartsOn: Number(form.values.weekStartsOn) };
  const dirty =
    candidate.schoolName.trim() !== settings.schoolName ||
    candidate.defaultLocale !== settings.defaultLocale ||
    candidate.weekStartsOn !== settings.weekStartsOn;

  return (
    <FormPage
      onSubmit={() => {
        const data = form.validate(settingsInput, candidate);
        if (data) save.mutate(data);
      }}
    >
      <FormError messageKey={form.formError} />
      <FormSection title={t('school.title')} description={t('school.description')}>
        <TextField
          label={t('school.name')}
          placeholder={t('school.namePlaceholder')}
          autoComplete="organization"
          required
          {...form.bind('schoolName')}
          error={form.error('schoolName')}
        />
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

      <FormActions>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
          {save.isPending ? t('common:actions.saving') : t('common:actions.saveChanges')}
        </Button>
      </FormActions>
    </FormPage>
  );
}
