import { KeyRound, Lock } from 'lucide-react';
import { useEffect, useRef, type SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LOCALES, type Locale } from '@shared/enums';
import { staffCreateInput, staffUpdateInput, type StaffMember, type StaffUpdateInput } from '@shared/schemas/staff';
import { Button, Field, FormError, Modal, Select, Switch, TextField, useToast } from '@web/components/ui';
import { useAuth } from '@web/lib/auth';
import { useFormat } from '@web/lib/format';
import { useForm } from '@web/lib/forms';
import { usePositions } from '../../positions/api';
import { staffErrorKey, useCreateStaff, useSchoolSettings, useUpdateStaff } from '../api';
import { PositionChips, PositionPicker, TempPasswordInput } from './bits';

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

// ── Add ───────────────────────────────────────────────────────────────────

const ADD_FORM = 'staff-add-form';

export function AddStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['staff', 'common']);
  const create = useCreateStaff();
  const close = () => {
    create.reset();
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('form.addTitle')}
      description={t('form.addDescription')}
      footer={
        <>
          <Button onClick={close} disabled={create.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form={ADD_FORM} variant="primary" loading={create.isPending}>
            {t('form.create')}
          </Button>
        </>
      }
    >
      <AddStaffForm mutation={create} onDone={close} />
    </Modal>
  );
}

function AddStaffForm({ mutation, onDone }: { mutation: ReturnType<typeof useCreateStaff>; onDone: () => void }) {
  const { t } = useTranslation(['staff', 'common']);
  const toast = useToast();
  const settings = useSchoolSettings();
  const positions = usePositions();
  const form = useForm({
    name: '',
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

  return (
    <form
      id={ADD_FORM}
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = form.validate(staffCreateInput);
        if (!data) return;
        mutation.mutate(data, {
          onSuccess: (created) => {
            toast.success(t('toasts.created', { name: created.name }));
            onDone();
          },
          onError: handleError(form),
        });
      }}
    >
      <FormError messageKey={form.formError} />
      <TextField label={t('common:fields.name')} autoComplete="off" required {...form.bind('name')} error={form.error('name')} />
      <TextField
        label={t('common:fields.email')}
        type="email"
        inputMode="email"
        autoComplete="off"
        dir="ltr"
        required
        {...form.bind('email')}
        error={form.error('email')}
      />
      <Field label={t('positions.label')} error={form.error('positionIds')} hint={t('positions.hint')} required>
        <PositionPicker
          positions={positions.data?.items ?? []}
          loading={positions.isPending}
          failed={positions.isError}
          value={form.values.positionIds}
          onChange={(ids) => form.set('positionIds', ids)}
        />
      </Field>
      <Field label={t('form.language')} htmlFor="f-locale" error={form.error('locale')}>
        <LanguageSelect
          {...form.bind('locale')}
          onChange={(e) => {
            localeTouched.current = true;
            form.set('locale', e.target.value as Locale);
          }}
        />
      </Field>
      <Field label={t('form.tempPassword')} htmlFor="f-password" error={form.error('password')} hint={t('form.tempPasswordHint')} required>
        <TempPasswordInput {...form.bind('password')} onGenerate={(v) => form.set('password', v)} />
      </Field>
      <TextField label={t('common:fields.phone')} type="tel" autoComplete="off" dir="ltr" optional {...form.bind('phone')} error={form.error('phone')} />
    </form>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────

const EDIT_FORM = 'staff-edit-form';

export function EditStaffModal({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const { t } = useTranslation(['staff', 'common']);
  const f = useFormat();
  const { user } = useAuth();
  const isSelf = !!member && member.id === user?.id;
  const update = useUpdateStaff(member?.id ?? 0, isSelf);
  const reset = useUpdateStaff(member?.id ?? 0, isSelf);
  // Someone who can do more than you is out of your reach (the API enforces it; this just says so up front).
  const readOnly = !!member && !member.manageable;

  const close = () => {
    update.reset();
    reset.reset();
    onClose();
  };

  const meta = member
    ? [
        member.lastLoginAt ? t('lastSignIn', { date: f.timestamp(member.lastLoginAt) }) : t('neverSignedIn'),
        t('form.added', { date: f.timestamp(member.createdAt) }),
      ].join(' · ')
    : undefined;

  return (
    <Modal
      open={!!member}
      onClose={close}
      title={member ? t(readOnly ? 'form.viewTitle' : 'form.editTitle', { name: member.name }) : ''}
      description={meta}
      footer={
        readOnly ? (
          <Button onClick={close}>{t('common:actions.close')}</Button>
        ) : (
          <>
            <Button onClick={close} disabled={update.isPending}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" form={EDIT_FORM} variant="primary" loading={update.isPending}>
              {t('common:actions.saveChanges')}
            </Button>
          </>
        )
      }
    >
      {member && (
        <div className="grid gap-5">
          {readOnly && (
            <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{t('form.readOnlyNotice')}</span>
            </div>
          )}
          <EditDetailsForm member={member} isSelf={isSelf} readOnly={readOnly} mutation={update} onDone={close} />
          {!readOnly &&
            (isSelf ? (
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-4 text-sm text-muted">
                <KeyRound className="size-4 shrink-0" aria-hidden />
                {t('form.selfPassword')}
                <Link to="/profile" className="font-medium text-accent underline-offset-2 hover:underline">
                  {t('form.selfPasswordLink')}
                </Link>
              </p>
            ) : (
              <ResetPasswordForm member={member} mutation={reset} onDone={close} />
            ))}
        </div>
      )}
    </Modal>
  );
}

function EditDetailsForm({
  member,
  isSelf,
  readOnly,
  mutation,
  onDone,
}: {
  member: StaffMember;
  isSelf: boolean;
  readOnly: boolean;
  mutation: ReturnType<typeof useUpdateStaff>;
  onDone: () => void;
}) {
  const { t } = useTranslation(['staff', 'common']);
  const toast = useToast();
  const positions = usePositions(!readOnly);
  const heldIds = member.positions.map((p) => p.id);
  const form = useForm({
    name: member.name,
    email: member.email,
    positionIds: heldIds,
    phone: member.phone ?? '',
    locale: member.locale,
    active: member.active,
  });

  return (
    <form
      id={EDIT_FORM}
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (readOnly) return;
        const data = form.validate(staffUpdateInput);
        if (!data) return;
        // Send only what changed: fewer surprises with the owner/self rules.
        const patch: StaffUpdateInput = {};
        if (data.name !== member.name) patch.name = data.name;
        if (data.email !== member.email) patch.email = data.email;
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
      }}
    >
      <FormError messageKey={form.formError} />
      <fieldset disabled={readOnly} className="grid min-w-0 gap-4">
        <TextField label={t('common:fields.name')} autoComplete="off" required {...form.bind('name')} error={form.error('name')} />
        <TextField
          label={t('common:fields.email')}
          type="email"
          inputMode="email"
          autoComplete="off"
          dir="ltr"
          required
          {...form.bind('email')}
          error={form.error('email')}
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
        <Field label={t('form.language')} htmlFor="f-locale" error={form.error('locale')}>
          <LanguageSelect {...form.bind('locale')} />
        </Field>
        <TextField label={t('common:fields.phone')} type="tel" autoComplete="off" dir="ltr" optional {...form.bind('phone')} error={form.error('phone')} />
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
    </form>
  );
}

function ResetPasswordForm({ member, mutation, onDone }: { member: StaffMember; mutation: ReturnType<typeof useUpdateStaff>; onDone: () => void }) {
  const { t } = useTranslation(['staff', 'common']);
  const toast = useToast();
  const form = useForm({ password: '' });
  return (
    <form
      noValidate
      className="grid gap-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = form.validate(staffUpdateInput, { password: form.values.password });
        if (!data?.password) return;
        mutation.mutate(
          { password: data.password },
          {
            onSuccess: () => {
              toast.success(t('toasts.passwordReset', { name: member.name }));
              onDone();
            },
            onError: handleError(form),
          },
        );
      }}
    >
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound className="size-4 text-muted" aria-hidden />
          {t('form.resetTitle')}
        </h3>
        <p className="mt-0.5 text-sm text-muted">{t('form.resetDescription')}</p>
      </div>
      <FormError messageKey={form.formError} />
      <Field label={t('form.newPassword')} htmlFor="f-reset-password" error={form.error('password')} hint={t('form.tempPasswordHint')}>
        <TempPasswordInput {...form.bind('password')} id="f-reset-password" onGenerate={(v) => form.set('password', v)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={mutation.isPending} icon={KeyRound}>
          {t('form.resetButton')}
        </Button>
      </div>
    </form>
  );
}
