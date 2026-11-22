import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function StatCard({ label, value, icon: Icon, to, className }: { label: ReactNode; value: ReactNode; icon?: LucideIcon; to?: string; className?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        {Icon && <Icon className="size-4 text-muted" aria-hidden />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</div>
    </>
  );
  const cls = clsx('block rounded-2xl border border-line bg-surface p-4', to && 'transition-colors hover:border-line-strong hover:bg-surface-2', className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
