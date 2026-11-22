import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * One line of user data (a name, an email, a course title) that may be in a
 * different script from the UI. The inner text runs in its own direction, so a
 * long Latin name in the Arabic UI is cut at its end ("Screen Acting Foun…")
 * rather than its start. The flex wrapper keeps the UI's direction, so the text
 * still sits at the start edge (the right in Arabic) like everything around it.
 */
export function BidiText({ children, dir = 'auto', className }: { children: ReactNode; dir?: 'auto' | 'ltr'; className?: string }) {
  return (
    <span className={clsx('flex min-w-0', className)}>
      <span dir={dir} className="min-w-0 truncate">
        {children}
      </span>
    </span>
  );
}
