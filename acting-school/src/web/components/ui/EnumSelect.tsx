import type { SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Field';

/**
 * <select> over an enum list with translated labels from common:enums.<group>.
 *   <EnumSelect group="gender" values={GENDERS} allowEmpty {...form.bind('gender')} />
 */
export function EnumSelect({
  group,
  values,
  allowEmpty,
  emptyLabel,
  ...rest
}: {
  group: string;
  values: readonly string[];
  allowEmpty?: boolean;
  emptyLabel?: string;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const { t } = useTranslation();
  return (
    <Select {...rest}>
      {allowEmpty && <option value="">{emptyLabel ?? '—'}</option>}
      {values.map((v) => (
        <option key={v} value={v}>
          {t(`common:enums.${group}.${v}`)}
        </option>
      ))}
    </Select>
  );
}

/** Translated label for one enum value: useEnumLabel()('studentStatus', 'active'). */
export function useEnumLabel() {
  const { t } = useTranslation();
  return (group: string, value: string | null | undefined) => (value ? t(`common:enums.${group}.${value}`) : '');
}
