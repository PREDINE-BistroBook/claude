import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Card-style list container; rows are divided by hairlines. Works at phone width without tables. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={clsx('divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface', className)}>{children}</ul>;
}

/**
 * One row: leading (avatar/icon), title + subtitle, trailing (badge/meta).
 * Pass `to` to make the whole row a link (adds a chevron), or `onClick`.
 */
export function ListRow({
  to,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  className,
}: {
  to?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-sm text-muted">{subtitle}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      {(to || onClick) && <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />}
    </>
  );
  const cls = clsx('flex items-center gap-3 px-4 py-3 sm:px-5', (to || onClick) && 'transition-colors hover:bg-surface-2', className);
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>
          {inner}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={clsx(cls, 'w-full text-start')}>
          {inner}
        </button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}
