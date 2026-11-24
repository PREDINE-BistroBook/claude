import clsx from 'clsx';
import type { CourseColor } from '@shared/enums';
import { courseColor } from '@web/lib/colors';

/** Small colour marker for a class (decorative). */
export function ColorDot({ color, className }: { color: CourseColor | null | undefined; className?: string }) {
  return <span aria-hidden className={clsx('inline-block size-2.5 shrink-0 rounded-full', courseColor(color).dot, className)} />;
}
