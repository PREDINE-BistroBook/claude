import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Card({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** false: no inner padding (for lists that run edge to edge). */
  padded?: boolean;
}) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]', className)}>
      {(title || actions) && (
        <header className={clsx('flex items-start justify-between gap-3', padded ? 'px-4 pt-4 sm:px-5 sm:pt-5' : 'px-4 py-3 sm:px-5 border-b border-line')}>
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-4 sm:p-5', padded && (title || actions) && 'pt-3 sm:pt-4')}>{children}</div>
    </section>
  );
}
