import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from './errors';

function toApiError(error: z.ZodError): ApiError {
  return new ApiError(
    400,
    'validation',
    'Some fields are missing or invalid',
    error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)), code: i.code, message: i.message })),
  );
}

/** Validate any value; throws a 400 'validation' ApiError with per-field issues. */
export function validate<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw toApiError(r.error);
  return r.data;
}

/** Parse + validate a JSON request body. */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_request', 'Expected a JSON body');
  }
  return validate(schema, raw);
}

/** Validate the query string (single values only). */
export function query<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const q = c.req.query();
  // Drop empty params so optional filters can be sent blank.
  const cleaned = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''));
  return validate(schema, cleaned);
}

/** Positive integer route param, else 404. */
export function paramId(c: Context, name = 'id'): number {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, 'not_found');
  return n;
}
