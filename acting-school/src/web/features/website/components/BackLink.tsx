import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** "← Back to …" above a page's title, 48 px tall (PageHeader's own back link is a small text link). */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="-ms-2 mb-1 inline-flex min-h-12 items-center gap-2 rounded-xl px-2 text-base font-medium text-muted hover:bg-surface-2 hover:text-ink">
      <ArrowLeft className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
      {children}
    </Link>
  );
}
