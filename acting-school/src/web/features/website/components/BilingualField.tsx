import clsx from 'clsx';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Textarea } from '@web/components/ui';

type Half = 'en' | 'ar';

/**
 * One text in English and Arabic: a heading, then the two inputs side by side
 * on wider screens and stacked on phones. Each input is labelled in its own
 * language ("English" / "العربية") and typed in its own direction (English
 * left-to-right, Arabic right-to-left), whatever the screen's language.
 * `errors` are translation keys (as useForm gives them) per half.
 */
export function BilingualField({
  label,
  hint,
  value,
  onChange,
  errors,
  multiline,
  rows = 4,
  maxLength,
  placeholder,
  required,
  idPrefix,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: { en: string; ar: string };
  onChange: (half: Half, text: string) => void;
  errors?: Partial<Record<Half, string | null | undefined>>;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: Partial<Record<Half, string>>;
  required?: boolean;
  /** Ids become `${idPrefix}-en` / `${idPrefix}-ar` (an error summary or test can point at them). */
  idPrefix?: string;
}) {
  const { t } = useTranslation(['website', 'common']);
  const auto = useId();
  const base = idPrefix ?? auto;
  const hintId = hint ? `${base}-hint` : undefined;
  const halves: Half[] = ['en', 'ar'];
  return (
    <fieldset className="grid gap-2" aria-describedby={hintId}>
      <legend className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ms-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </legend>
      {hint && (
        <p id={hintId} className="-mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      <div className={clsx('grid gap-3', 'sm:grid-cols-2')}>
        {halves.map((half) => {
          const id = `${base}-${half}`;
          const error = errors?.[half];
          const common = {
            id,
            value: value[half],
            onChange: (e: { target: { value: string } }) => onChange(half, e.target.value),
            dir: half === 'ar' ? 'rtl' : 'ltr',
            lang: half,
            maxLength,
            placeholder: placeholder?.[half],
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? `${id}-error` : undefined,
            // text-start follows each input's own dir: Arabic lines up on the right even in the English screen.
            className: 'text-start',
          } as const;
          return (
            <div key={half} className="flex flex-col gap-1.5">
              <label htmlFor={id} lang={half} className="text-xs font-semibold tracking-wide text-muted">
                {t(`website:bilingual.${half}`)}
              </label>
              {multiline ? <Textarea rows={rows} {...common} /> : <Input {...common} />}
              {error && (
                <p id={`${id}-error`} className="text-sm text-danger" role="alert">
                  {t(error)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
