import clsx from 'clsx';
import { Check, GraduationCap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COURSE_COLORS, type CourseColor } from '@shared/enums';
import { courseColor } from '@web/lib/colors';

/** Small colour marker for a class. */
export function ColorDot({ color, className }: { color: CourseColor | null | undefined; className?: string }) {
  return <span aria-hidden className={clsx('inline-block size-2.5 shrink-0 rounded-full', courseColor(color).dot, className)} />;
}

/** Tinted square with a class icon (page headers). */
export function CourseTile({ color, size = 'md' }: { color: CourseColor | null | undefined; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-xl',
        courseColor(color).soft,
        size === 'md' ? 'size-12' : 'size-10',
      )}
    >
      <GraduationCap className={size === 'md' ? 'size-6' : 'size-5'} />
    </span>
  );
}

/** Swatch radio group over the course palette. Native radios: arrow keys move between colours. */
export function ColorPicker({
  value,
  onChange,
  name = 'color',
  labelledBy,
}: {
  value: CourseColor | '';
  onChange: (c: CourseColor) => void;
  name?: string;
  labelledBy?: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap items-center gap-2.5">
      {COURSE_COLORS.map((c) => {
        const selected = value === c;
        return (
          <label key={c} className="relative cursor-pointer" title={t(`common:enums.courseColor.${c}`)}>
            <input type="radio" name={name} value={c} checked={selected} onChange={() => onChange(c)} className="peer sr-only" />
            <span
              className={clsx(
                'flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
                courseColor(c).dot,
                selected && 'ring-2 ring-ink',
              )}
            >
              {selected && <Check className="size-5 text-white" aria-hidden />}
            </span>
            <span className="sr-only">{t(`common:enums.courseColor.${c}`)}</span>
          </label>
        );
      })}
    </div>
  );
}
