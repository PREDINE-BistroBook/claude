import { useTranslation } from 'react-i18next';
import { GENDERS } from '@shared/enums';
import { castingRoleInput, type CastingRole } from '@shared/schemas/castings';
import { Button, EnumSelect, Field, FormError, Modal, TextAreaField, TextField, useToast } from '@web/components/ui';
import { useForm } from '@web/lib/forms';
import { useSaveRole } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  castingId: number;
  /** Edit this role; omit to add a new one. */
  role?: CastingRole;
}

/** Add or edit a role. Mounted only while open, so each opening starts from fresh values. */
export function RoleFormModal(props: Props) {
  return props.open ? <RoleFormDialog {...props} /> : null;
}

function RoleFormDialog({ onClose, castingId, role }: Props) {
  const { t } = useTranslation(['castings', 'common']);
  const toast = useToast();
  const save = useSaveRole(castingId, role?.id);
  const form = useForm({
    name: role?.name ?? '',
    description: role?.description ?? '',
    gender: role?.gender ?? '',
    ageMin: role?.ageMin != null ? String(role.ageMin) : '',
    ageMax: role?.ageMax != null ? String(role.ageMax) : '',
    requirements: role?.requirements ?? '',
  });

  const submit = () => {
    // Every field is sent, so the create schema (with the age order check) fits edits too.
    const data = form.validate(castingRoleInput);
    if (!data) return;
    save.mutate(data, {
      onSuccess: () => {
        toast.success(role ? t('roles.saved') : t('roles.created'));
        onClose();
      },
      onError: form.setServerError,
    });
  };

  const formId = role ? `role-form-${role.id}` : 'role-form-new';

  return (
    <Modal
      open
      onClose={onClose}
      title={role ? t('roles.editTitle') : t('roles.addTitle')}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            {role ? t('common:actions.saveChanges') : t('roles.add')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError messageKey={form.formError} />
        <TextField
          label={t('roles.name')}
          required
          autoComplete="off"
          dir="auto"
          placeholder={t('roles.namePlaceholder')}
          {...form.bind('name')}
          id="role-name"
          error={form.error('name')}
        />
        <TextAreaField
          label={t('roles.description')}
          optional
          rows={3}
          dir="auto"
          placeholder={t('roles.descriptionPlaceholder')}
          {...form.bind('description')}
          id="role-description"
          error={form.error('description')}
        />
        <Field label={t('roles.gender')} htmlFor="role-gender" optional error={form.error('gender')}>
          <EnumSelect group="gender" values={GENDERS} allowEmpty emptyLabel={t('roles.anyGender')} {...form.bind('gender')} id="role-gender" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('roles.ageMin')}
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            optional
            {...form.bind('ageMin')}
            id="role-ageMin"
            error={form.error('ageMin')}
          />
          <TextField
            label={t('roles.ageMax')}
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            optional
            {...form.bind('ageMax')}
            id="role-ageMax"
            error={form.error('ageMax')}
          />
        </div>
        <TextAreaField
          label={t('roles.requirements')}
          optional
          rows={3}
          dir="auto"
          placeholder={t('roles.requirementsPlaceholder')}
          {...form.bind('requirements')}
          id="role-requirements"
          error={form.error('requirements')}
        />
      </form>
    </Modal>
  );
}
