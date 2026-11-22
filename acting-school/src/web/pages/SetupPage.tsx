import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { setupInput, type SetupInput } from '@shared/schemas/auth';
import { Button } from '../components/ui/Button';
import { Field, TextField } from '../components/ui/Field';
import { FormError, SplashScreen } from '../components/ui/States';
import { currentLanguage } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useForm } from '../lib/forms';
import { usePageTitle } from '../lib/hooks';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

export default function SetupPage() {
  const { t } = useTranslation();
  const { user, loading, needsSetup, refresh } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ schoolName: '', name: '', email: '', password: '' });
  usePageTitle(t('auth.setupTitle'));

  const setup = useMutation({
    mutationFn: (data: SetupInput) => api.post('/auth/setup', data),
    onSuccess: async () => {
      await refresh();
      navigate('/', { replace: true });
    },
    onError: form.setServerError,
  });

  if (loading) return <SplashScreen />;
  if (!needsSetup) return <Navigate to={user ? '/' : '/login'} replace />;

  return (
    <AuthLayout title={t('auth.setupTitle')} subtitle={t('auth.setupSubtitle')}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const data = form.validate(setupInput, { ...form.values, locale: currentLanguage() });
          if (data) setup.mutate(data);
        }}
      >
        <FormError messageKey={form.formError} />
        <TextField label={t('auth.schoolName')} placeholder={t('auth.schoolNamePlaceholder')} autoFocus {...form.bind('schoolName')} error={form.error('schoolName')} />
        <TextField label={t('auth.yourName')} autoComplete="name" {...form.bind('name')} error={form.error('name')} />
        <TextField label={t('fields.email')} type="email" autoComplete="username" inputMode="email" dir="ltr" {...form.bind('email')} error={form.error('email')} />
        <Field label={t('fields.password')} htmlFor="f-password" error={form.error('password')} hint={t('auth.passwordHint')}>
          <PasswordInput autoComplete="new-password" {...form.bind('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={setup.isPending} className="mt-1 w-full">
          {setup.isPending ? t('auth.creating') : t('auth.createSchool')}
        </Button>
      </form>
    </AuthLayout>
  );
}
