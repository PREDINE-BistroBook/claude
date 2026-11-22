import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@shared/enums';
import { changePasswordInput, profileInput } from '@shared/schemas/auth';
import { Avatar, Button, Card, Field, FormError, FormGrid, PageHeader, Select, StatusBadge, TextField, useToast } from '../components/ui';
import { setLanguage } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useForm } from '../lib/forms';
import { PasswordInput } from './PasswordInput';

export default function ProfilePage() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const details = useForm({ name: user?.name ?? '', phone: user?.phone ?? '', locale: (user?.locale ?? 'en') as Locale });
  const pw = useForm({ currentPassword: '', newPassword: '' });

  const saveDetails = useMutation({
    mutationFn: (data: unknown) => api.patch('/auth/profile', data),
    onSuccess: async () => {
      setLanguage(details.values.locale);
      await refresh();
      toast.success(t('states.saved'));
    },
    onError: details.setServerError,
  });

  const changePw = useMutation({
    mutationFn: (data: unknown) => api.post('/auth/password', data),
    onSuccess: () => {
      pw.setValues({ currentPassword: '', newPassword: '' });
      toast.success(t('profile.passwordChanged'));
    },
    onError: pw.setServerError,
  });

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('profile.title')}
        leading={<Avatar name={user.name} size="lg" />}
        subtitle={<StatusBadge group="role" value={user.role} />}
      />
      <div className="grid gap-5">
        <Card title={t('profile.details')}>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = details.validate(profileInput);
              if (data) saveDetails.mutate(data);
            }}
          >
            <FormError messageKey={details.formError} />
            <FormGrid>
              <TextField label={t('fields.name')} autoComplete="name" {...details.bind('name')} error={details.error('name')} />
              <TextField label={t('fields.phone')} type="tel" autoComplete="tel" dir="ltr" optional {...details.bind('phone')} error={details.error('phone')} />
              <TextField label={t('fields.email')} value={user.email} disabled dir="ltr" readOnly />
              <Field label={t('fields.language')} htmlFor="f-locale">
                <Select {...details.bind('locale')}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {t(`enums.locale.${l}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saveDetails.isPending}>
                {t('actions.saveChanges')}
              </Button>
            </div>
          </form>
        </Card>

        <Card title={t('profile.changePassword')}>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = pw.validate(changePasswordInput);
              if (data) changePw.mutate(data);
            }}
          >
            <FormError messageKey={pw.formError} />
            <FormGrid>
              <Field label={t('profile.currentPassword')} htmlFor="f-currentPassword" error={pw.error('currentPassword')}>
                <PasswordInput autoComplete="current-password" {...pw.bind('currentPassword')} />
              </Field>
              <Field label={t('profile.newPassword')} htmlFor="f-newPassword" error={pw.error('newPassword')} hint={t('auth.passwordHint')}>
                <PasswordInput autoComplete="new-password" {...pw.bind('newPassword')} />
              </Field>
            </FormGrid>
            <div className="flex justify-end">
              <Button type="submit" loading={changePw.isPending}>
                {t('profile.changePassword')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
