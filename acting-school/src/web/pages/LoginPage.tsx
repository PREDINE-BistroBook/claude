import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';
import { loginInput, type LoginInput } from '@shared/schemas/auth';
import { Button } from '../components/ui/Button';
import { Field, TextField } from '../components/ui/Field';
import { FormError, SplashScreen } from '../components/ui/States';
import { landingAfterSignIn } from '../layout/nav';
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
  const { user, can, loading, needsSetup, refresh } = useAuth();
  const [params] = useSearchParams();
  // One field for the username; an email address typed there signs in too (the server tells them apart).
  const form = useForm({ username: '', password: '' });
  const school = useSchoolName();
  usePageTitle(t('auth.signIn'));

  const login = useMutation({
    mutationFn: (data: LoginInput) => api.post('/auth/login', data),
    // Once /auth/me is re-read this page renders with the person and sends them on (below) —
    // with *their* permissions, which a redirect from here (still the signed-out render) wouldn't have.
    onSuccess: refresh,
    onError: form.setServerError,
  });

  if (loading) return <SplashScreen />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  // Back to where the screen was — unless that page isn't this person's to open (someone else was
  // signed in here before): then their own start, not a "No access" screen.
  if (user) return <Navigate to={landingAfterSignIn(safeNext(params.get('next')), can)} replace />;

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
        <TextField
          label={t('fields.username')}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          dir="ltr"
          autoFocus
          {...form.bind('username')}
          error={form.error('username')}
          hint={t('auth.usernameHint')}
        />
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
