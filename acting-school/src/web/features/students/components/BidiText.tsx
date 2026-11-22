import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * One line of user data (a name, an email, a course title) that may be in a
 * different script from the UI. It is laid out in its own direction, so a long
 * Latin name in the Arabic UI is cut at its end ("Screen Acting Foun…") rather
 * than its start, while `match-parent` keeps it aligned with the surrounding text.
 */
export function BidiText({ children, dir = 'auto', className }: { children: ReactNode; dir?: 'auto' | 'ltr'; className?: string }) {
  return (
    <span dir={dir} className={clsx('block truncate [text-align:match-parent]', className)}>
      {children}
    </span>
  );
}
