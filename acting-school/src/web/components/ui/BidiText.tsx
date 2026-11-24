import clsx from 'clsx';
import { Fragment, type ReactNode } from 'react';

/**
 * One line of user data (a name, an email, a course title) that may be in a
 * different script from the UI. The inner text runs in its own direction, so a
 * long Latin name in the Arabic UI is cut at its end ("Screen Acting Foun…")
 * rather than its start. The flex wrapper keeps the UI's direction, so the text
 * still sits at the start edge (the right in Arabic) like everything around it.
 * (CSS `text-align: match-parent` doesn't do this in Chromium.)
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

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** Direction of a string's first strongly-directional character, or null if it has none. */
function firstStrongDir(s: string): 'ltr' | 'rtl' | null {
  for (const ch of s) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return null;
}

/**
 * Several pieces of user data on one truncated line ("Studio A · Layla Haddad ·
 * Cold reads"). When every piece is in the same script, the line runs in that
 * direction (and is cut at its own end), still sitting at the UI's start edge.
 * When scripts are mixed, each piece is isolated and the pieces keep the UI's
 * order, so an Arabic casting title next to a Latin role name doesn't swap
 * places with it.
 */
export function DataLine({ parts, className }: { parts: (string | null | undefined | false)[]; className?: string }) {
  const items = parts.filter((p): p is string => !!p);
  if (!items.length) return null;
  const dirs = new Set(items.map(firstStrongDir).filter(Boolean));
  const dir = dirs.size === 1 ? [...dirs][0]! : undefined;
  return (
    <span className={clsx('flex min-w-0', className)}>
      <span dir={dir} className="min-w-0 truncate">
        {items.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            <bdi>{p}</bdi>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
