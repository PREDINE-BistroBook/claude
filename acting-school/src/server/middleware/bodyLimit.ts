import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/errors';

/**
 * Largest request body the JSON API reads. The biggest legitimate one is an
 * attendance sheet (500 marks with 500-character notes: ~0.6 MB); everything
 * else is a few kilobytes. Uploads (POST /api/files) have their own limit.
 *
 * On Cloudflare the whole API is one Durable Object with 128 MB of memory, so
 * a body must be turned away before it's read whole: a huge one, even sent
 * anonymously to /api/auth/login, would otherwise reset the object and fail
 * every request in flight. The Worker refuses a too-large Content-Length
 * before the request reaches the object (src/worker/index.ts); this catches
 * the rest (no Content-Length: a chunked body) on both runtimes.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export const payloadTooLarge = () => new ApiError(413, 'payload_too_large', 'The request is too large');

/** 413 for a body over `maxBytes`: by its Content-Length, or (without one) after reading at most `maxBytes`. */
export function limitBody(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = c.req.raw;
    if (!raw.body) return next();
    const declared = raw.headers.get('content-length');
    if (declared !== null) {
      // The runtime holds the body to its declared length.
      if (!(Number(declared) <= maxBytes)) throw payloadTooLarge();
      return next();
    }
    const reader = raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw payloadTooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of chunks) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    // The handler reads the buffered copy (the original stream is used up).
    c.req.raw = new Request(raw, { body: bytes });
    await next();
  };
}
