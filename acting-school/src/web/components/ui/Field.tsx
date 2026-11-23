import clsx from 'clsx';
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

const control =
  'w-full rounded-xl border border-line-strong bg-surface px-3 text-ink placeholder:text-muted transition-colors ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-surface-2 disabled:text-muted ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20';

/**
 * Label + control + hint/error. `error` is a translation key (as produced by
 * useForm: 'common:errors.required') or plain text.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  optional,
  required,
  className,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
          {label}
          {required && <span className="text-danger ms-0.5" aria-hidden>*</span>}
          {optional && <span className="ms-1.5 text-xs font-normal text-muted">({t('common:states.optional')})</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {t(error)}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(control, 'h-11 text-base sm:h-10 sm:text-sm', className)} {...rest} />;
}

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={clsx(control, 'py-2.5 text-base sm:text-sm leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(control, 'h-11 text-base sm:h-10 sm:text-sm pe-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...rest }: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={rest.id ?? id} className={clsx('inline-flex items-center gap-2.5 text-sm text-ink cursor-pointer', className)}>
      <input id={rest.id ?? id} type="checkbox" className="size-4 rounded accent-[var(--accent)]" {...rest} />
      {label}
    </label>
  );
}

/** Labelled input in one go: <TextField label="Email" {...form.bind('email')} error={form.error('email')} />. */
export function TextField({
  label,
  error,
  hint,
  optional,
  required,
  className,
  ...input
}: { label: ReactNode; error?: string | null; hint?: ReactNode; optional?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const id = input.id ?? autoId;
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} optional={optional} required={required} className={className}>
      <Input id={id} required={required} {...input} />
    </Field>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  optional,
  className,
  ...input
}: { label: ReactNode; error?: string | null; hint?: ReactNode; optional?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  const id = input.id ?? autoId;
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} optional={optional} className={className}>
      <Textarea id={id} {...input} />
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  optional,
  className,
  children,
  ...select
}: { label: ReactNode; error?: string | null; hint?: ReactNode; optional?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const id = select.id ?? autoId;
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} optional={optional} className={className}>
      <Select id={id} {...select}>
        {children}
      </Select>
    </Field>
  );
}
