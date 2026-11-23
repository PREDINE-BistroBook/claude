import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { loginInput } from '@shared/schemas/auth';
import { Button } from '../components/ui/Button';
import { Field, TextField } from '../components/ui/Field';
import { FormError, SplashScreen } from '../components/ui/States';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useForm } from '../lib/forms';
import { usePageTitle, useSchoolName } from '../lib/hooks';
import { AuthLayout } from './AuthLayout';
import { PasswordInput } from './PasswordInput';

/** Only same-site paths are allowed as the post-login destination. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, loading, needsSetup, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useForm({ email: '', password: '' });
  const school = useSchoolName();
  usePageTitle(t('auth.signIn'));

  const login = useMutation({
    mutationFn: (data: { email: string; password: string }) => api.post('/auth/login', data),
    onSuccess: async () => {
      await refresh();
      navigate(safeNext(params.get('next')), { replace: true });
    },
    onError: form.setServerError,
  });

  if (loading) return <SplashScreen />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;

  return (
    <AuthLayout title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')} school={school}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const data = form.validate(loginInput);
          if (data) login.mutate(data);
        }}
      >
        <FormError messageKey={form.formError} />
        <TextField label={t('fields.email')} type="email" autoComplete="username" inputMode="email" dir="ltr" autoFocus {...form.bind('email')} error={form.error('email')} />
        <Field label={t('fields.password')} htmlFor="f-password" error={form.error('password')}>
          <PasswordInput autoComplete="current-password" {...form.bind('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={login.isPending} className="mt-1 w-full">
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
        <p className="text-center text-xs text-muted">{t('auth.forgotPassword')}</p>
      </form>
    </AuthLayout>
  );
}
