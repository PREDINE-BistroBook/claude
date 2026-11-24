import { useMutation } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTH_ERROR_CODES, choosePasswordForm, type ChoosePasswordInput, type SessionUser } from '@shared/schemas/auth';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { FormError } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useForm } from '../lib/forms';
import { usePageTitle, useSchoolName } from '../lib/hooks';
import { AuthLayout } from './AuthLayout';

/**
 * "Choose your own password" — the one screen someone sees after signing in
 * with a temporary password (one a manager or the operator set for them:
 * SessionUser.mustChangePassword). RequireAuth shows it in place of the app at
 * every address, so there is nowhere else to go; the API refuses everything
 * outside /api/auth for this session too. Made for people who are not at home
 * with computers: two fields, the rules in plain words, one labelled box to
 * show what is being typed, one button — and a way out (Sign out).
 */
export default function ChoosePasswordPage() {
  const { t } = useTranslation();
  const { user, refresh, signOut } = useAuth();
  const toast = useToast();
  const school = useSchoolName();
  const form = useForm({ newPassword: '', repeatPassword: '' });
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  usePageTitle(t('auth.choosePassword.title'));

  const save = useMutation({
    mutationFn: (data: ChoosePasswordInput) => api.post<{ user: SessionUser }>('/auth/choose-password', data),
    onSuccess: async () => {
      toast.success(t('auth.choosePassword.saved'));
      // /auth/me now says the password is their own: RequireAuth lets the app through.
      await refresh();
    },
    onError: (err) => {
      // Already chosen (in another tab): nothing to do here any more.
      if (err instanceof ApiError && err.code === AUTH_ERROR_CODES.passwordChangeNotRequired) void refresh();
      else if (err instanceof ApiError && err.code === 'conflict') form.setFormError('common:auth.choosePassword.changedElsewhere');
      else form.setServerError(err);
    },
  });

  if (!user) return null;

  return (
    <AuthLayout title={t('auth.choosePassword.title')} subtitle={t('auth.choosePassword.subtitle')} school={school}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const data = form.validate(choosePasswordForm);
          if (data) save.mutate({ newPassword: data.newPassword });
        }}
      >
        <FormError messageKey={form.formError} />
        <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-ink">
          <p className="font-medium">{t('auth.choosePassword.rulesTitle')}</p>
          <ul className="mt-1.5 list-disc space-y-1 ps-5">
            <li>{t('auth.choosePassword.ruleLength')}</li>
            <li>{t('auth.choosePassword.ruleDifferent')}</li>
          </ul>
        </div>
        <Field label={t('auth.choosePassword.newPassword')} htmlFor="f-newPassword" error={form.error('newPassword')}>
          <Input type={show ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" autoFocus {...form.bind('newPassword')} />
        </Field>
        <Field label={t('auth.choosePassword.repeatPassword')} htmlFor="f-repeatPassword" error={form.error('repeatPassword')}>
          <Input type={show ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" {...form.bind('repeatPassword')} />
        </Field>
        {/* One labelled box for both fields: plainer than an eye icon in each. */}
        <label htmlFor="f-showPasswords" className="-my-1 flex min-h-12 cursor-pointer items-center gap-3 text-base text-ink">
          <input id="f-showPasswords" type="checkbox" className="size-5 shrink-0 rounded accent-[var(--accent)]" checked={show} onChange={(e) => setShow(e.target.checked)} />
          {t('auth.choosePassword.show')}
        </label>
        <p className="text-sm text-muted">{t('auth.choosePassword.remember')}</p>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending} className="mt-1 w-full">
          {save.isPending ? t('auth.choosePassword.saving') : t('auth.choosePassword.save')}
        </Button>
      </form>
      <div className="mt-5 border-t border-line pt-4 text-center">
        <p className="text-sm text-muted">
          {t('auth.choosePassword.signedInAs', { name: `⁨${user.name}⁩` })}
          {user.username && (
            <>
              {' · '}
              <bdi dir="ltr" className="font-medium text-ink">
                {user.username}
              </bdi>
            </>
          )}
        </p>
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void signOut();
          }}
          className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-base font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
        >
          <LogOut className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
          {t('auth.choosePassword.notYou')}
        </button>
      </div>
    </AuthLayout>
  );
}
