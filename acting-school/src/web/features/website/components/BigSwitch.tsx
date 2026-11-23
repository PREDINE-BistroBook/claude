import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Switch } from '@web/components/ui';

/** The kit's Switch in a large framed row (at least 56 px), for the one switch that matters on a screen. */
export function BigSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('flex min-h-14 items-center rounded-xl border px-3 py-2 sm:px-4', checked ? 'border-accent/40 bg-accent-soft' : 'border-line-strong bg-surface', className)}>
      <div className="min-w-0 flex-1 [&_label]:text-base [&_label]:font-semibold">
        <Switch checked={checked} onChange={onChange} label={label} description={description} disabled={disabled} />
      </div>
    </div>
  );
}
