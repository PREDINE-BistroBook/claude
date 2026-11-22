import type { ApiIssue } from '../../shared/schemas/common';

/**
 * Throw from any route to answer { error: { code, message?, issues? } } with
 * the given status. The app-level error handler turns it into JSON.
 */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429,
    public code: string,
    message?: string,
    public issues?: ApiIssue[],
  ) {
    super(message ?? code);
  }
}

export const badRequest = (message?: string) => new ApiError(400, 'bad_request', message);
export const notFound = (what = 'Not found') => new ApiError(404, 'not_found', what);
export const forbidden = (message = 'You do not have access to this') => new ApiError(403, 'forbidden', message);
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
