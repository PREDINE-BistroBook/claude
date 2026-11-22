import type { SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Select } from '@web/components/ui';
import { useStaffDirectory } from '../api';

/**
 * Staff picker from GET /api/staff/directory (active staff, teachers first).
 * Keeps showing `current` even if that person is no longer active, and still
 * works (with just "none" + current) when the directory can't be loaded.
 */
export function TeacherSelect({
  label,
  emptyLabel,
  current,
  error,
  hint,
  optional,
  ...select
}: {
  label: string;
  emptyLabel: string;
  current?: { id: number; name: string | null } | null;
  error?: string | null;
  hint?: string;
  optional?: boolean;
} & SelectHTMLAttributes<HTMLSelectElement> & { id: string }) {
  const { t } = useTranslation('classes');
  const directory = useStaffDirectory();
  const active = (directory.data?.items ?? []).filter((s) => s.active);
  const teachers = active.filter((s) => s.role === 'teacher');
  const others = active.filter((s) => s.role !== 'teacher');
  const currentMissing = current && current.id && !active.some((s) => s.id === current.id);

  return (
    <Field
      label={label}
      htmlFor={select.id}
      error={error}
      optional={optional}
      hint={directory.isError ? t('form.staffError') : hint}
    >
      <Select {...select} disabled={select.disabled || directory.isPending}>
        <option value="">{directory.isPending ? t('common:states.loading') : emptyLabel}</option>
        {currentMissing && <option value={current.id}>{t('form.inactiveStaff', { name: current.name ?? `#${current.id}` })}</option>}
        {teachers.length > 0 && (
          <optgroup label={t('form.teachers')}>
            {teachers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label={t('form.otherStaff')}>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {t(`common:enums.role.${s.role}`)}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
    </Field>
  );
}
