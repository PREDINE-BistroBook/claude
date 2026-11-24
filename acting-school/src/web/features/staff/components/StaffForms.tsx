import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useEffect, useRef, useState, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LOCALES, type Locale } from '@shared/enums';
import { staffCreateInput, staffUpdateInput, type StaffMember, type StaffUpdateInput } from '@shared/schemas/staff';
import { normalizeUsername } from '@shared/usernames';
import {
  Avatar,
  Button,
  ButtonLink,
  Field,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  PhotoInput,
  Select,
  Switch,
  TextField,
  useToast,
} from '@web/components/ui';
import { api } from '@web/lib/api';
import { discardUpload } from '@web/lib/files';
import { ME_KEY } from '@web/lib/auth';
import { useForm } from '@web/lib/forms';
import { useDebounced } from '@web/lib/hooks';
import { usePositions } from '../../positions/api';
import { teamErrorKey, teamKeys } from '../../team/api';
import { staffErrorKey, staffKeys, useCreateStaff, useSchoolSettings, useUpdateStaff, useUsernameCheck } from '../api';
import { accountNamesPatch, automaticEmailFor, shownEmail, typedEmail, usernameCheckedFree, usernameCheckError } from '../utils';
import { PositionChips, PositionPicker, TempPasswordInput } from './bits';

/**
 * The forms behind a team member's account, used by the two pages the Team
 * page links to with staff.manage: /staff/new (AddStaffForm) and /staff/:id
 * (StaffPhoto, EditDetailsForm, ResetPasswordForm). Saving goes back to the
 * Team page.
 */
const TEAM = '/team';

const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function LanguageSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { t } = useTranslation();
  return (
    <Select {...props}>
      {LOCALES.map((l) => (
        <option key={l} value={l} lang={l}>
          {t(`common:enums.locale.${l}`)}
        </option>
      ))}
    </Select>
  );
}

/** Maps a failed save onto the form: our 409/403 codes become a banner, field issues go to their fields. */
function handleError(form: { setFormError: (k: string | null) => void; setServerError: (e: unknown) => void }) {
  return (err: unknown) => {
    const key = staffErrorKey(err);
    if (key) form.setFormError(key);
    else form.setServerError(err);
  };
}

/**
 * The Username field of both forms: Latin, left-to-right, never capitalised or
 * "corrected" by the phone, and checked against the team as the manager types
 * (GET /api/staff/username-check) — a taken or invalid one says so under the
 * field before anything is saved; a free one gets a quiet "free".
 */
function UsernameField({
  value,
  exceptId,
  error,
  disabled,
  ...input
}: { value: string; exceptId?: number; error?: string | null; disabled?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value'>) {
  const { t } = useTranslation(['staff', 'common']);
  const typed = normalizeUsername(value);
  const asked = useDebounced(typed, 300);
  const check = useUsernameCheck({ username: asked, exceptId }, !disabled);
  const live = usernameCheckError(check.data, value);
  return (
    <TextField
      label={t('common:fields.username')}
      type="text"
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      dir="ltr"
      maxLength={60}
      required
      value={value}
      {...input}
      aria-invalid={error || live ? true : undefined}
      error={error ?? live}
      hint={usernameCheckedFree(check.data, value) ? t('form.usernameFree') : t('form.usernameHint')}
    />
  );
}

// ── Add (/staff/new) ──────────────────────────────────────────────────────

export function AddStaffForm() {
  const { t } = useTranslation(['staff', 'common']);
  const toast = useToast();
  const navigate = useNavigate();
  const mutation = useCreateStaff();
  const settings = useSchoolSettings();
  const positions = usePositions();
  const form = useForm({
    name: '',
    username: '',
    email: '',
    positionIds: [] as number[],
    password: '',
    phone: '',
    locale: (settings.data?.defaultLocale ?? 'en') as Locale,
  });

  // New staff start in the school's default language, unless someone already picked one.
  const localeTouched = useRef(false);
  const defaultLocale = settings.data?.defaultLocale;
  const { set } = form;
  useEffect(() => {
    if (defaultLocale && !localeTouched.current) set('locale', defaultLocale);
  }, [defaultLocale, set]);

  // The username is offered from the name as it is typed — the first name, or first.last when
  // that is taken — until the manager types one themself. A name only in Arabic offers nothing.
  const [usernameTouched, setUsernameTouched] = useState(false);
  const askedName = useDebounced(form.values.name.trim(), 350);
  const offer = useUsernameCheck({ name: askedName }, !usernameTouched);
  const offered = offer.data?.suggestion;
  useEffect(() => {
    if (!usernameTouched && offered) set('username', offered);
  }, [usernameTouched, offered, set]);

  // No email typed: the account gets <username>@<the school's email domain> (shown as the field's placeholder).
  const automatic = automaticEmailFor(form.values.username, settings.data?.emailDomain);

  const submit = () => {
    const data = form.validate(staffCreateInput, { ...form.values, email: typedEmail(form.values.email) });
    if (!data) return;
    mutation.mutate(data, {
      onSuccess: (created) => {
        toast.success(t('toasts.created', { name: created.name }));
        navigate(TEAM);
      },
      onError: handleError(form),
    });
  };

  return (
    <FormPage onSubmit={submit}>
      <FormError messageKey={form.formError} />
      <FormSection>
        <FormGrid>
          <TextField label={t('common:fields.name')} autoComplete="off" required {...form.bind('name')} error={form.error('name')} />
          <UsernameField
            {...form.bind('username')}
            value={form.values.username}
            onChange={(e) => {
              setUsernameTouched(true);
              form.set('username', e.target.value);
            }}
            error={form.error('username')}
          />
        </FormGrid>
        <Field label={t('positions.label')} error={form.error('positionIds')} hint={t('positions.hint')} required>
          <PositionPicker
            positions={positions.data?.items ?? []}
            loading={positions.isPending}
            failed={positions.isError}
            value={form.values.positionIds}
            onChange={(ids) => form.set('positionIds', ids)}
          />
        </Field>
        <FormGrid>
          <Field label={t('form.language')} htmlFor="f-locale" error={form.error('locale')} hint={t('form.languageHint')}>
            <LanguageSelect
              {...form.bind('locale')}
              onChange={(e) => {
                localeTouched.current = true;
                form.set('locale', e.target.value as Locale);
              }}
            />
          </Field>
          <TextField label={t('common:fields.phone')} type="tel" autoComplete="off" dir="ltr" optional {...form.bind('phone')} error={form.error('phone')} />
        </FormGrid>
        <TextField
          label={t('common:fields.email')}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          dir="ltr"
          optional
          placeholder={automatic}
          {...form.bind('email')}
          error={form.error('email')}
          hint={automatic ? t('form.emailAutoHint', { email: automatic }) : t('form.emailAutoHintNoName')}
        />
        <Field label={t('form.tempPassword')} htmlFor="f-password" error={form.error('password')} hint={t('form.tempPasswordHint')} required>
          <TempPasswordInput {...form.bind('password')} onGenerate={(v) => form.set('password', v)} />
        </Field>
      </FormSection>
      <FormActions>
        <ButtonLink to={TEAM} variant="ghost" size="lg">
          {t('common:actions.cancel')}
        </ButtonLink>
        <Button type="submit" variant="primary" size="lg" loading={mutation.isPending}>
          {t('form.create')}
        </Button>
      </FormActions>
    </FormPage>
  );
}

// ── Edit (/staff/:id) ─────────────────────────────────────────────────────

/** The person's profile photo: saved as soon as it's chosen (PUT /api/staff/:id/photo, staff.manage). */
export function StaffPhoto({ member, readOnly, isSelf }: { member: StaffMember; readOnly: boolean; isSelf: boolean }) {
  const { t } = useTranslation(['team', 'staff', 'common']);
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (fileId: string | null) => api.put<StaffMember>(`/staff/${member.id}/photo`, { fileId }),
    onSuccess: async (_saved, fileId) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: staffKeys.all }),
        qc.invalidateQueries({ queryKey: teamKeys.team }),
        isSelf ? qc.invalidateQueries({ queryKey: ME_KEY }) : Promise.resolve(),
      ]);
      toast.success(t(fileId ? 'photo.saved' : 'photo.removed'));
    },
    onError: (err, fileId) => {
      // The new photo wasn't saved: don't leave the upload behind.
      discardUpload(fileId);
      toast.error(t(staffErrorKey(err) ?? teamErrorKey(err)));
    },
  });
  if (readOnly) return <Avatar name={member.name} fileId={member.photoFileId} size="xl" />;
  return (
    <div className="grid gap-2">
      <h2 className="text-base font-semibold text-ink">{t('photo.title')}</h2>
      <PhotoInput value={member.photoFileId} name={member.name} onChange={(id) => save.mutate(id)} busy={save.isPending} />
      <p className="text-sm text-muted">{t('photo.staffDescription')}</p>
    </div>
  );
}

/** Name, email, positions, language, phone and the Active switch. Read-only (no Save) for an account out of the caller's reach. */
export function EditDetailsForm({ member, isSelf, readOnly }: { member: StaffMember; isSelf: boolean; readOnly: boolean }) {
  const { t } = useTranslation(['staff', 'common']);
  const toast = useToast();
  const navigate = useNavigate();
  const mutation = useUpdateStaff(member.id, isSelf);
  const onDone = () => navigate(TEAM);
  const positions = usePositions(!readOnly);
  const heldIds = member.positions.map((p) => p.id);
  const settings = useSchoolSettings();
  const emailDomain = settings.data?.emailDomain;
  const form = useForm({
    name: member.name,
    username: member.username,
    email: member.email,
    positionIds: heldIds,
    phone: member.phone ?? '',
    locale: member.locale,
    active: member.active,
  });
  // An address that is the automatic one for the username follows a new username, until the manager types another.
  const [emailTouched, setEmailTouched] = useState(false);
  const email = shownEmail(member, form.values, emailTouched, emailDomain);

  const submit = () => {
    if (readOnly) return;
    const data = form.validate(staffUpdateInput, { ...form.values, email });
    if (!data) return;
    // Send only what changed: fewer surprises with the owner/self rules.
    const patch: StaffUpdateInput = accountNamesPatch(member, data, emailTouched);
    if (data.name !== member.name) patch.name = data.name;
    if (data.positionIds && !sameIds(data.positionIds, heldIds)) patch.positionIds = data.positionIds;
    if ((data.phone ?? null) !== member.phone) patch.phone = data.phone ?? null;
    if (data.locale !== member.locale) patch.locale = data.locale;
    if (data.active !== member.active) patch.active = data.active;
    if (!Object.keys(patch).length) {
      onDone();
      return;
    }
    mutation.mutate(patch, {
      onSuccess: (saved) => {
        toast.success(patch.active === false ? t('toasts.deactivated', { name: saved.name }) : t('toasts.saved'));
        onDone();
      },
      onError: handleError(form),
    });
  };

  return (
    <FormPage onSubmit={submit} className="mx-0 max-w-none">
      <FormError messageKey={form.formError} />
      <FormSection>
        <fieldset disabled={readOnly} className="grid min-w-0 gap-4">
          <FormGrid>
            <TextField label={t('common:fields.name')} autoComplete="off" required {...form.bind('name')} error={form.error('name')} />
            <UsernameField {...form.bind('username')} value={form.values.username} exceptId={member.id} disabled={readOnly} error={form.error('username')} />
          </FormGrid>
          <TextField
            label={t('common:fields.email')}
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            dir="ltr"
            required
            {...form.bind('email')}
            value={email}
            onChange={(e) => {
              setEmailTouched(true);
              form.set('email', e.target.value);
            }}
            error={form.error('email')}
            hint={!readOnly && !emailTouched && email !== member.email ? t('form.emailFollowsHint') : undefined}
          />
          <Field label={t('positions.label')} error={form.error('positionIds')} hint={isSelf ? t('positions.selfHint') : t('positions.hint')}>
            {readOnly ? (
              <PositionChips positions={member.positions} />
            ) : (
              <PositionPicker
                positions={positions.data?.items ?? []}
                loading={positions.isPending}
                failed={positions.isError}
                value={form.values.positionIds}
                onChange={(ids) => form.set('positionIds', ids)}
                disabled={isSelf}
              />
            )}
          </Field>
          <FormGrid>
            <Field label={t('form.language')} htmlFor="f-locale" error={form.error('locale')} hint={t('form.languageHint')}>
              <LanguageSelect {...form.bind('locale')} />
            </Field>
            <TextField label={t('common:fields.phone')} type="tel" autoComplete="off" dir="ltr" optional {...form.bind('phone')} error={form.error('phone')} />
          </FormGrid>
          <div className="rounded-xl border border-line px-3.5 py-1.5">
            <Switch
              label={t('form.active')}
              description={isSelf ? t('form.selfActiveHint') : t('form.activeHint')}
              checked={form.values.active}
              onChange={(v) => form.set('active', v)}
              disabled={isSelf || readOnly}
            />
          </div>
        </fieldset>
      </FormSection>
      {!readOnly && (
        <FormActions>
          <ButtonLink to={TEAM} variant="ghost" size="lg">
            {t('common:actions.cancel')}
          </ButtonLink>
          <Button type="submit" variant="primary" size="lg" loading={mutation.isPending}>
            {t('common:actions.saveChanges')}
          </Button>
        </FormActions>
      )}
    </FormPage>
  );
}

/** Your own password is changed on My profile (it asks for the current one). */
export function SelfPasswordNote() {
  const { t } = useTranslation('staff');
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
      <KeyRound className="size-4 shrink-0" aria-hidden />
      {t('form.selfPassword')}
      <Link to="/profile" className="font-medium text-accent underline-offset-2 hover:underline">
        {t('form.selfPasswordLink')}
      </Link>
    </p>
  );
}

/** An admin reset of someone else's password (PATCH with `password`): they are signed out everywhere. */
export function ResetPasswordForm({ member }: { member: StaffMember }) {
  const { t } = useTranslation(['staff', 'common']);
  const toast = useToast();
  const mutation = useUpdateStaff(member.id, false);
  const form = useForm({ password: '' });
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = form.validate(staffUpdateInput, { password: form.values.password });
        if (!data?.password) return;
        mutation.mutate(
          { password: data.password },
          {
            onSuccess: () => {
              toast.success(t('toasts.passwordReset', { name: member.name }));
              form.set('password', '');
            },
            onError: handleError(form),
          },
        );
      }}
    >
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <KeyRound className="size-4 text-muted" aria-hidden />
          {t('form.resetTitle')}
        </h2>
        <p className="mt-0.5 text-sm text-muted">{t('form.resetDescription')}</p>
        {member.mustChangePassword && <p className="mt-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink">{t('form.temporaryNote')}</p>}
      </div>
      <FormError messageKey={form.formError} />
      <Field label={t('form.newPassword')} htmlFor="f-reset-password" error={form.error('password')} hint={t('form.tempPasswordHint')}>
        <TempPasswordInput {...form.bind('password')} id="f-reset-password" onGenerate={(v) => form.set('password', v)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="lg" loading={mutation.isPending} icon={KeyRound}>
          {t('form.resetButton')}
        </Button>
      </div>
    </form>
  );
}
