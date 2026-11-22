import type { ApiErrorBody, ApiIssue } from '@shared/schemas/common';
import type { UploadedFile } from '@shared/schemas/files';

/** Thrown for every non-2xx answer. `code` mirrors the API ('validation', 'not_found', 'forbidden'…); 'network' when offline. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: ApiIssue[],
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** The auth provider registers this so an expired session sends people back to sign-in. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'fetch', Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, err?.code ?? 'server_error', err?.message ?? res.statusText, err?.issues);
  }
  return data as T;
}

/** Build "?a=1&b=x" from an object, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** JSON API client. Paths are relative to /api: api.get('/students'). */
export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  delete: <T = void>(url: string) => request<T>('DELETE', url),
  upload: (file: Blob, filename = 'image.jpg') => {
    const form = new FormData();
    form.append('file', file, filename);
    return request<UploadedFile>('POST', '/files', form);
  },
};

/** URL for an uploaded image (served only to signed-in staff). */
export const fileUrl = (id: string) => `/api/files/${id}`;
