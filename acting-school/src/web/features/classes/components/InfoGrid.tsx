import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Compact label/value grid for detail cards: two columns on phones, three from
 * sm up. `span: 'row'` takes a whole row on phones only; 'full' everywhere.
 */
export function InfoGrid({ items }: { items: { label: ReactNode; value: ReactNode; span?: 'half' | 'row' | 'full' }[] }) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 sm:gap-x-6">
      {items.map((item, i) => (
        <div key={i} className={clsx('min-w-0', item.span === 'row' && 'col-span-2 sm:col-span-1', item.span === 'full' && 'col-span-full')}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">
            {item.value === null || item.value === undefined || item.value === '' ? <span className="text-muted">{t('common:states.notSet')}</span> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
