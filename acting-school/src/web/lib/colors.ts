import type { CourseColor } from '@shared/enums';

/**
 * Course colour palette. Class strings are written out in full so Tailwind
 * picks them up. `dot` for small markers, `soft` for tinted chips/cards,
 * `bar` for the coloured edge of schedule cards.
 */
export const COURSE_COLOR_CLASSES: Record<CourseColor, { dot: string; soft: string; bar: string }> = {
  crimson: { dot: 'bg-rose-600', soft: 'bg-rose-50 text-rose-900 dark:bg-rose-950/50 dark:text-rose-100', bar: 'border-s-rose-600' },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100', bar: 'border-s-amber-500' },
  emerald: { dot: 'bg-emerald-600', soft: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100', bar: 'border-s-emerald-600' },
  sky: { dot: 'bg-sky-600', soft: 'bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100', bar: 'border-s-sky-600' },
  violet: { dot: 'bg-violet-600', soft: 'bg-violet-50 text-violet-900 dark:bg-violet-950/50 dark:text-violet-100', bar: 'border-s-violet-600' },
  teal: { dot: 'bg-teal-600', soft: 'bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-100', bar: 'border-s-teal-600' },
  orange: { dot: 'bg-orange-500', soft: 'bg-orange-50 text-orange-900 dark:bg-orange-950/50 dark:text-orange-100', bar: 'border-s-orange-500' },
  slate: { dot: 'bg-slate-500', soft: 'bg-slate-100 text-slate-900 dark:bg-slate-800/60 dark:text-slate-100', bar: 'border-s-slate-500' },
};

export function courseColor(color: CourseColor | null | undefined) {
  return COURSE_COLOR_CLASSES[color ?? 'slate'];
}

const AVATAR_TONES = [
  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
];

/** Stable tint for initials avatars. */
export function avatarTone(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}
