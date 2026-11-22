import { useCallback, useState, type ChangeEvent } from 'react';
import type { z } from 'zod';
import type { ApiIssue } from '@shared/schemas/common';
import { ApiError } from './api';

export type FieldErrors = Record<string, string>;

/**
 * Turn validation issues (from zod in the browser or the API's 400) into
 * { fieldName: 'common:errors.<key>' } — ready for t().
 */
export function issuesToErrors(issues: { path: PropertyKey[]; code: string; message: string; [k: string]: unknown }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || '_form';
    if (out[field]) continue;
    out[field] = messageKey(issue);
  }
  return out;
}

function messageKey(issue: { code: string; message: string; [k: string]: unknown }): string {
  if (issue.message?.startsWith('errors.')) return `common:${issue.message}`;
  // A module's own wording: message 'staff:errors.emailTaken' is used as-is.
  if (/^[a-z]+:errors\./i.test(issue.message ?? '')) return issue.message;
  switch (issue.code) {
    case 'too_small':
      return issue.minimum === 1 && issue.origin === 'string' ? 'common:errors.required' : 'common:errors.tooSmall';
    case 'too_big':
      return issue.origin === 'string' ? 'common:errors.tooLong' : 'common:errors.tooBig';
    case 'invalid_format':
      if (issue.format === 'email') return 'common:errors.invalidEmail';
      if (issue.format === 'url') return 'common:errors.invalidUrl';
      return 'common:errors.invalid';
    case 'invalid_type':
      if (issue.expected === 'number') return 'common:errors.invalidNumber';
      return 'common:errors.required';
    default:
      return 'common:errors.invalid';
  }
}

/** Map an error from a mutation to a top-of-form message key. */
export function errorMessageKey(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'network':
        return 'common:errors.network';
      case 'forbidden':
        return 'common:errors.forbidden';
      case 'not_found':
        return 'common:errors.notFound';
      case 'conflict':
        return 'common:errors.conflict';
      case 'too_many_attempts':
        return 'common:errors.tooManyAttempts';
      case 'invalid_credentials':
        return 'common:errors.invalidCredentials';
      case 'too_large':
        return 'common:errors.fileTooLarge';
      case 'unsupported_type':
        return 'common:errors.fileType';
      case 'validation':
        return 'common:errors.invalid';
    }
  }
  return 'common:errors.generic';
}

/**
 * Small form-state helper.
 *
 *   const form = useForm({ firstName: '', lastName: '' });
 *   <Input {...form.bind('firstName')} />   // value, onChange, name, aria-invalid
 *   <Field error={form.error('firstName')}>  // translated by Field
 *   const data = form.validate(studentInput); if (!data) return;
 *   mutation.mutate(data, { onError: form.setServerError });
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const { [key as string]: _drop, ...rest } = e;
      return rest;
    });
  }, []);

  const bind = <K extends keyof T & string>(key: K) => ({
    name: key,
    id: `f-${key}`,
    value: (values[key] ?? '') as string | number,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(key, e.target.value as T[K]),
    'aria-invalid': errors[key] ? true : undefined,
  });

  function validate<S extends z.ZodType>(schema: S, value: unknown = values): z.output<S> | null {
    const r = schema.safeParse(value);
    if (!r.success) {
      setErrors(issuesToErrors(r.error.issues as never));
      setFormError(null);
      return null;
    }
    setErrors({});
    setFormError(null);
    return r.data;
  }

  /** Pass as a mutation onError: maps API field issues, else a form-level message. */
  const setServerError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.issues?.length) {
      setErrors(issuesToErrors(err.issues as (ApiIssue & { [k: string]: unknown })[]));
      setFormError(null);
    } else {
      setFormError(errorMessageKey(err));
    }
  }, []);

  return {
    values,
    setValues,
    set,
    bind,
    errors,
    error: (key: string) => errors[key],
    setErrors,
    formError,
    setFormError,
    validate,
    setServerError,
  };
}
