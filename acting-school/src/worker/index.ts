/**
 * The Cloudflare Worker ("claude", wrangler.jsonc). Static assets (the built
 * web app in dist/web) are served by Cloudflare without this code, with the
 * SPA fallback to index.html for client-side routes. Only two kinds of request
 * run the Worker (run_worker_first):
 * - /api/* — handed to the school's Durable Object, where the API and its
 *   SQLite database live (school.ts), unless the body is too large (413);
 * - /assets/* — a hashed build file that doesn't exist (an old tab after a
 *   deploy) is a 404, not the HTML shell (which _headers would also mark
 *   cacheable for a year), the same as the Node server.
 */
import { MAX_JSON_BODY_BYTES } from '../server/middleware/bodyLimit';
import { MAX_UPLOAD_BYTES } from '../shared/schemas/files';
import type { Env } from './env';
import { SchoolDO } from './school';

export { SchoolDO };

/** One Durable Object for the whole school. */
const INSTANCE = 'main';

/**
 * A body that announces more than the API would read is refused here, before
 * it reaches the Durable Object (128 MB of memory for the whole school). Bodies
 * without a Content-Length are cut off by the API itself (middleware/bodyLimit.ts).
 */
function tooLarge(request: Request, pathname: string): boolean {
  const declared = request.headers.get('content-length');
  if (declared === null) return false;
  const max = pathname === '/api/files' ? MAX_UPLOAD_BYTES + 64 * 1024 : MAX_JSON_BODY_BYTES;
  return !(Number(declared) <= max);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (tooLarge(request, pathname)) {
        return Response.json(
          { error: { code: 'payload_too_large', message: 'The request is too large' } },
          { status: 413, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
        );
      }
      const stub = env.SCHOOL.get(env.SCHOOL.idFromName(INSTANCE));
      return stub.fetch(request);
    }
    const res = await env.ASSETS.fetch(request);
    if (pathname.startsWith('/assets/') && (res.headers.get('content-type') ?? '').startsWith('text/html')) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
