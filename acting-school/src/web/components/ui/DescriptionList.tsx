import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Label/value pairs for detail pages. Empty values show a muted "Not set" unless `hideEmpty`. */
export function DescriptionList({
  items,
  columns = 2,
  hideEmpty = false,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; wide?: boolean }[];
  columns?: 1 | 2 | 3;
  hideEmpty?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const shown = hideEmpty ? items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '') : items;
  return (
    <dl
      className={clsx(
        'grid gap-x-6 gap-y-4',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {shown.map((item, i) => (
        <div key={i} className={clsx('min-w-0', item.wide && 'sm:col-span-full')}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-1 text-sm text-ink break-words">
            {item.value === null || item.value === undefined || item.value === '' ? (
              <span className="text-muted">{t('common:states.notSet')}</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
