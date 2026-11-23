import clsx from 'clsx';
import { useId, type ReactNode } from 'react';

/** On/off switch with a label and help text. The whole control is at least 40px tall. */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className={clsx('text-sm font-medium text-ink', !disabled && 'cursor-pointer')}>
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="group flex h-10 shrink-0 items-center rounded-full px-0.5 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={clsx(
            'flex h-7 w-12 items-center rounded-full p-1 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-accent/40',
            checked ? 'bg-accent' : 'bg-line-strong',
          )}
        >
          {/* On the accent track the thumb takes the accent's text colour (white in light mode, near-black in dark) so it stays visible. */}
          <span className={clsx('size-5 rounded-full shadow-sm transition-[margin] duration-150', checked ? 'ms-5 bg-accent-ink' : 'ms-0 bg-white')} />
        </span>
      </button>
    </div>
  );
}
