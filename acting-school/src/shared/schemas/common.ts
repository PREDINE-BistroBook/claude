import { z } from 'zod';
import { DATETIME_RE, TIME_RE, isValidDate } from '../dates';

/**
 * Building blocks for request validation. Forms send '' for an empty field;
 * the optional helpers turn that into null so the database stores NULL.
 *
 * Do NOT use .default() in these schemas: .partial() is used for PATCH bodies
 * and a default would silently overwrite stored values. Apply defaults in the
 * insert code instead.
 *
 * Custom refinements use a message of the form 'errors.<key>' — the web app
 * shows the matching translation from the common namespace (src/web/i18n/common.ts).
 */
const blankToNull = (v: unknown) => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
};

const blankToNullNumber = (v: unknown) => {
  if (v === '' || v === null) return null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  return v;
};

export const reqText = (max = 200) => z.string().trim().min(1).max(max);
export const optText = (max = 1000) => z.preprocess(blankToNull, z.string().max(max).nullable().optional());

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const optEmail = z.preprocess(
  (v) => (typeof blankToNull(v) === 'string' ? (blankToNull(v) as string).toLowerCase() : blankToNull(v)),
  z.email().max(254).nullable().optional(),
);

export const optUrl = z.preprocess(blankToNull, z.url({ protocol: /^https?$/ }).max(500).nullable().optional());

export const dateStr = z.string().refine(isValidDate, { message: 'errors.invalidDate' });
export const optDate = z.preprocess(blankToNull, dateStr.nullable().optional());
export const timeStr = z.string().regex(TIME_RE, { message: 'errors.invalidTime' });
export const dateTimeStr = z.string().regex(DATETIME_RE, { message: 'errors.invalidDateTime' }).refine((s) => isValidDate(s.slice(0, 10)), {
  message: 'errors.invalidDateTime',
});
export const optDateTime = z.preprocess(blankToNull, dateTimeStr.nullable().optional());

export const id = z.coerce.number().int().positive();
export const optId = z.preprocess(blankToNullNumber, z.number().int().positive().nullable().optional());
export const optInt = (min = 0, max = 100000) => z.preprocess(blankToNullNumber, z.number().int().min(min).max(max).nullable().optional());

export const optEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values).nullable().optional());

/** File ids are UUIDs issued by POST /api/files. */
export const optFileId = z.preprocess(blankToNull, z.uuid().nullable().optional());

export const tagList = (maxItems = 50) => z.array(z.string().trim().min(1).max(60)).max(maxItems);

export const password = z.string().min(8, { message: 'errors.passwordTooShort' }).max(200);

/** Shape of a validation error from the API: { error: { code: 'validation', issues } }. */
export interface ApiIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export interface ApiErrorBody {
  error: { code: string; message?: string; issues?: ApiIssue[] };
}

/** List endpoints answer { items: [...] }. */
export interface ListResponse<T> {
  items: T[];
}
