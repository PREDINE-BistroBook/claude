import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@shared/enums';
import { changePasswordInput, profileInput } from '@shared/schemas/auth';
import { normalizeUsername } from '@shared/usernames';
import { Crown } from 'lucide-react';
import type { MeResponse } from '@shared/schemas/auth';
import { Avatar, Button, Card, Field, FormError, FormGrid, PageHeader, PhotoInput, Select, TextField, useToast } from '../components/ui';
import { PermissionSummary } from '../features/positions/components/PermissionList';
import { PositionChips } from '../features/staff/components/bits';
import { teamErrorKey, teamKeys } from '../features/team/api';
import { PushCard } from '../features/team/components/PushCard';
import { useCafeStatus } from '../features/cafe/api';
import { setLanguage } from '../i18n';
import { api } from '../lib/api';
import { discardUpload } from '../lib/files';
import { useAuth } from '../lib/auth';
import { useForm } from '../lib/forms';
import { PasswordInput } from './PasswordInput';

export default function ProfilePage() {
  const { t } = useTranslation(['common', 'positions', 'staff', 'team']);
  const { user, refresh } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const cafeOn = !!useCafeStatus()?.enabled;
  const details = useForm({ name: user?.name ?? '', phone: user?.phone ?? '', locale: (user?.locale ?? 'en') as Locale });
  const pw = useForm({ currentPassword: '', newPassword: '' });
  const uname = useForm({ username: user?.username ?? '' });

  const saveDetails = useMutation({
    mutationFn: (data: unknown) => api.patch('/auth/profile', data),
    onSuccess: async () => {
      setLanguage(details.values.locale);
      await refresh();
      toast.success(t('states.saved'));
    },
    onError: details.setServerError,
  });

  // Your own username: the same rules and uniqueness check as when a manager sets it (PATCH /api/auth/profile).
  const saveUsername = useMutation({
    mutationFn: (data: { username?: string }) => api.patch<MeResponse>('/auth/profile', data),
    onSuccess: async (res) => {
      // As it was saved (lower-case), not as it was typed.
      const saved = res.user?.username ?? '';
      uname.set('username', saved);
      // Managers see usernames on the Team list and the member pages.
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['staff'] })]);
      toast.success(t('profile.username.saved', { username: saved }));
    },
    onError: uname.setServerError,
  });

  const changePw = useMutation({
    mutationFn: (data: unknown) => api.post('/auth/password', data),
    onSuccess: () => {
      pw.setValues({ currentPassword: '', newPassword: '' });
      toast.success(t('profile.passwordChanged'));
    },
    onError: pw.setServerError,
  });

  // Your own photo: saved as soon as it's chosen (PUT /api/auth/photo).
  const savePhoto = useMutation({
    mutationFn: (fileId: string | null) => api.put<MeResponse>('/auth/photo', { fileId }),
    onSuccess: async (_res, fileId) => {
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: teamKeys.team })]);
      toast.success(t(fileId ? 'team:photo.saved' : 'team:photo.removed'));
    },
    onError: (err, fileId) => {
      discardUpload(fileId);
      toast.error(t(teamErrorKey(err)));
    },
  });

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('profile.title')}
        leading={<Avatar name={user.name} fileId={user.photoFileId} size="lg" />}
      />
      <div className="grid gap-5">
        <Card title={t('team:photo.title')} description={t('team:photo.description')}>
          <PhotoInput value={user.photoFileId} name={user.name} onChange={(id) => savePhoto.mutate(id)} busy={savePhoto.isPending} />
        </Card>

        <Card title={t('profile.username.title')} description={t('profile.username.description')}>
          <form
            data-testid="username-card"
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = uname.validate(profileInput.pick({ username: true }));
              if (data?.username && data.username !== user.username) saveUsername.mutate(data);
            }}
          >
            <FormError messageKey={uname.formError} />
            <TextField
              label={t('fields.username')}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              maxLength={60}
              className="sm:max-w-sm"
              {...uname.bind('username')}
              error={uname.error('username')}
              hint={t('profile.username.hint')}
            />
            <div className="flex justify-end">
              <Button type="submit" size="lg" loading={saveUsername.isPending} disabled={normalizeUsername(uname.values.username) === user.username}>
                {t('profile.username.save')}
              </Button>
            </div>
          </form>
        </Card>

        <PushCard />

        <Card title={t('profile.whatYouCanDo')} description={user.isOwner ? undefined : t('profile.whatYouCanDoHint')}>
          <div className="mb-4">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{t('profile.yourPositions')}</h3>
            <PositionChips positions={user.positions} />
          </div>
          {user.isOwner ? (
            <p className="flex items-start gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-ink">
              <Crown className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              {t('profile.ownerEverything')}
            </p>
          ) : user.permissions.length ? (
            <PermissionSummary permissions={user.permissions} />
          ) : (
            <p className="text-sm text-muted">{t(cafeOn ? 'profile.nothingYetCafe' : 'profile.nothingYet')}</p>
          )}
        </Card>

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
              <Button type="submit" variant="primary" size="lg" loading={saveDetails.isPending}>
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
              <Button type="submit" size="lg" loading={changePw.isPending}>
                {t('profile.changePassword')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
