import clsx from 'clsx';
import { useId } from 'react';

/*
 * Turquoise Studio's mark: the slanted turquoise "T" on a black disc, drawn on a
 * 100×100 grid. Interim drawing traced from the studio's Instagram avatar until
 * they send the original logo file. public/icon.svg (and the PNG icons rendered
 * from it by scripts/render-icons.mjs) use the same paths.
 */
/** The "T": the slanted top bar and the stem that slants down to a point. */
const MARK = 'M11.39 48.48L46.84 27.59L76.58 27.59L41.77 48.48ZM41.14 42.78L54.68 34.56L70.89 58.61L70.89 87.09Z';
/** The two thin cuts that split the bar and the stem into ribbons. */
const CUTS = 'M25.68 49.26L62.42 26.81M51.91 42.39L72.15 72.51';

/** The studio logo as a round badge; size it with `className` (e.g. "size-9"). Decorative: the name is always shown next to it. */
export function BrandMark({ className }: { className?: string }) {
  // Gradient and mask ids must be unique per instance (the shell renders the mark twice).
  const id = `bm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 100 100" className={clsx('shrink-0 rounded-full', className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0.1" y1="0.15" x2="0.8" y2="1">
          <stop offset="0.2" style={{ stopColor: 'var(--brand-mint)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-turquoise)' }} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.56" cy="0.46" r="0.42">
          <stop offset="0" style={{ stopColor: 'var(--brand-turquoise)', stopOpacity: 0.22 }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-turquoise)', stopOpacity: 0 }} />
        </radialGradient>
        <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="white" />
          <path d={CUTS} stroke="black" strokeWidth="1.4" />
        </mask>
      </defs>
      <circle cx="50" cy="50" r="50" className="fill-brand-tile" />
      <circle cx="50" cy="50" r="50" fill={`url(#${id}-glow)`} />
      <path d={MARK} fill={`url(#${id}-fill)`} mask={`url(#${id}-cut)`} />
    </svg>
  );
}
