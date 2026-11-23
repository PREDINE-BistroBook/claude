import { Info, Lock, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { PERMISSIONS, reachOf, type Permission } from '@shared/permissions';
import { positionInput, type Position, type PositionInput } from '@shared/schemas/positions';
import {
  Badge,
  Button,
  ButtonLink,
  ConfirmDialog,
  ErrorState,
  FormActions,
  FormError,
  FormGrid,
  FormPage,
  FormSection,
  PageHeader,
  PageLoader,
  Switch,
  TextField,
  useToast,
} from '@web/components/ui';
import { ApiError } from '@web/lib/api';
import { useAuth } from '@web/lib/auth';
import { errorMessageKey, useForm } from '@web/lib/forms';
import { usePositionName } from '@web/lib/positions';
import { positionsErrorKey, useCreatePosition, useDeletePosition, usePositions, useUpdatePosition } from './api';
import { heldByOthersBeyondReach } from './utils';
import { PermissionChecklist } from './components/PermissionList';

/** /positions/new and /positions/:id — the same form; an existing position you can't edit opens read-only. */
export default function PositionFormPage() {
  const { t } = useTranslation(['positions', 'common']);
  const params = useParams();
  const isNew = params.id === undefined;
  const id = Number(params.id);
  const positions = usePositions();

  if (positions.isPending) return <PageLoader />;
  const position = isNew ? null : (positions.data?.items.find((p) => p.id === id) ?? null);
  if (positions.isError || (!isNew && !position)) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('title')} back="/positions" />
        <ErrorState error={positions.error ?? new ApiError(404, 'not_found', 'Not found')} onRetry={positions.isError ? () => void positions.refetch() : undefined} />
      </div>
    );
  }
  return <PositionForm key={position?.id ?? 'new'} position={position} />;
}

function PositionForm({ position }: { position: Position | null }) {
  const { t } = useTranslation(['positions', 'common']);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const name = usePositionName();
  const create = useCreatePosition();
  const update = useUpdatePosition(position?.id ?? 0);
  const remove = useDeletePosition(position?.id ?? 0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOwnerUser = !!user?.isOwner;
  const readOnly = !!position && !position.editable;
  // Not editable although you hold everything it allows: someone holding it can do more than you.
  const lockedByHolders = !!position && heldByOthersBeyondReach(position, user?.permissions ?? []);
  const form = useForm({
    name: position?.name ?? '',
    nameAr: position?.nameAr ?? '',
    isOwner: position?.isOwner ?? false,
    // Owner positions list everything; keep what was ticked before so turning "owner" off restores it.
    permissions: (position && !position.isOwner ? position.permissions : []) as Permission[],
  });
  const v = form.values;
  const mutation = position ? update : create;
  // You can only give what is within your reach (owners: everything; settings.manage also covers cafeteria.serve).
  const reach = reachOf(user?.permissions ?? []);
  const locked = (p: Permission) => !isOwnerUser && !reach.includes(p);

  const submit = () => {
    if (readOnly) return;
    const data = form.validate(positionInput, {
      name: v.name,
      nameAr: v.nameAr,
      permissions: v.isOwner ? [...PERMISSIONS] : v.permissions,
      ...(isOwnerUser ? { isOwner: v.isOwner } : {}),
    });
    if (!data) return;
    mutation.mutate(data as PositionInput, {
      onSuccess: () => {
        toast.success(t(position ? 'toasts.saved' : 'toasts.created'));
        navigate('/positions');
      },
      onError: (err) => {
        const key = positionsErrorKey(err);
        if (key) form.setFormError(key);
        else form.setServerError(err);
      },
    });
  };

  const onDelete = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('toasts.deleted'));
        navigate('/positions', { replace: true });
      },
      onError: (err) => {
        setConfirmOpen(false);
        toast.error(t(positionsErrorKey(err) ?? errorMessageKey(err)));
      },
    });

  const title = position ? t(readOnly ? 'form.viewTitle' : 'form.editTitle', { name: name(position) }) : t('form.newTitle');
  const canDelete = !!position && !readOnly && position.key === null && position.holderCount === 0;
  const deleteHint = !position || readOnly ? null : position.key !== null ? t('remove.builtIn') : position.holderCount > 0 ? t('remove.inUse', { count: position.holderCount }) : null;

  return (
    <div>
      <PageHeader
        back="/positions"
        title={title}
        documentTitle={position ? name(position) : t('form.newTitle')}
        subtitle={
          position && (position.isOwner || position.key) ? (
            <span className="flex flex-wrap gap-1.5">
              {position.isOwner && <Badge tone="accent">{t('owner')}</Badge>}
              {position.key && <Badge>{t('builtIn')}</Badge>}
            </span>
          ) : undefined
        }
      />
      <FormPage onSubmit={submit}>
        {readOnly && <Notice icon={Lock}>{t(lockedByHolders ? 'form.readOnlyHolders' : 'form.readOnly')}</Notice>}
        {!readOnly && position?.key && <Notice icon={Info}>{t('form.builtInHint')}</Notice>}
        <FormError messageKey={form.formError} />

        <FormSection title={t('form.namesTitle')} description={t('form.namesHint')}>
          <fieldset disabled={readOnly} className="min-w-0">
            <FormGrid>
              <TextField label={t('form.name')} required dir="auto" autoComplete="off" {...form.bind('name')} error={form.error('name')} />
              <TextField
                label={t('form.nameAr')}
                optional
                dir="rtl"
                lang="ar"
                autoComplete="off"
                hint={t('form.nameArHint')}
                {...form.bind('nameAr')}
                error={form.error('nameAr')}
              />
            </FormGrid>
          </fieldset>
        </FormSection>

        {isOwnerUser && (
          <FormSection title={t('form.ownerTitle')}>
            <Switch
              label={t('form.ownerToggle')}
              description={t('form.ownerHint')}
              checked={v.isOwner}
              onChange={(on) => form.set('isOwner', on)}
              disabled={readOnly}
            />
          </FormSection>
        )}

        <FormSection title={t('form.accessTitle')} description={v.isOwner ? t('form.ownerAccessHint') : t('form.accessHint')}>
          <PermissionChecklist
            value={v.isOwner ? PERMISSIONS : v.permissions}
            onChange={(next) => form.set('permissions', next)}
            locked={locked}
            disabled={readOnly || v.isOwner}
          />
          {form.error('permissions') && (
            <p className="text-sm text-danger" role="alert">
              {t(form.error('permissions')!)}
            </p>
          )}
        </FormSection>

        {position && !readOnly && (
          <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <p className="text-sm text-muted">{deleteHint ?? t('remove.message')}</p>
            <Button variant="danger-ghost" icon={Trash2} disabled={!canDelete} onClick={() => setConfirmOpen(true)} className="shrink-0">
              {t('remove.button')}
            </Button>
          </section>
        )}

        <FormActions>
          <ButtonLink to="/positions">{t(readOnly ? 'common:actions.back' : 'common:actions.cancel')}</ButtonLink>
          {!readOnly && (
            <Button type="submit" variant="primary" loading={mutation.isPending}>
              {position ? t('common:actions.saveChanges') : t('form.create')}
            </Button>
          )}
        </FormActions>
      </FormPage>

      <ConfirmDialog
        open={confirmOpen}
        title={position ? t('remove.title', { name: name(position) }) : ''}
        message={t('remove.message')}
        loading={remove.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function Notice({ icon: Icon, children }: { icon: typeof Info; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted" role="note">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
