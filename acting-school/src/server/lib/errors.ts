import type { ApiIssue } from '../../shared/schemas/common';

/**
 * Throw from any route to answer { error: { code, message?, issues?, details? } }
 * with the given status. The app-level error handler turns it into JSON.
 * `details` is extra data for the client (e.g. the matching records of a
 * possible duplicate); its shape is documented with the module's error codes.
 */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429,
    public code: string,
    message?: string,
    public issues?: ApiIssue[],
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

/** 400 with one field issue — same shape as a zod validation error. */
export function fieldError(path: (string | number)[], message: string): ApiError {
  return new ApiError(400, 'validation', 'Some fields are missing or invalid', [{ path, code: 'custom', message }]);
}

export const badRequest = (message?: string) => new ApiError(400, 'bad_request', message);
export const notFound = (what = 'Not found') => new ApiError(404, 'not_found', what);
export const forbidden = (message = 'You do not have access to this') => new ApiError(403, 'forbidden', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);

/**
 * Which SQLite constraint an error is, on either driver: better-sqlite3 sets
 * `code` (SQLITE_CONSTRAINT_UNIQUE…); a Durable Object throws a plain Error
 * whose message carries SQLite's own text ("UNIQUE constraint failed: …").
 * Wrapped errors are followed through `cause`. null for anything else.
 */
export function sqliteConstraint(err: unknown): 'unique' | 'foreign_key' | null {
  for (let e = err, depth = 0; e && typeof e === 'object' && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    const text = typeof message === 'string' ? message : '';
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || /UNIQUE constraint failed/.test(text)) return 'unique';
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY constraint failed/.test(text)) return 'foreign_key';
  }
  return null;
}
