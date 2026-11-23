/**
 * Serves the built web app from files bundled into the Worker itself, standing
 * in for the ASSETS binding (Workers static assets). Used only by the
 * "embedded" deploy (wrangler.embedded.jsonc, `npm run cf:deploy-embedded`),
 * for deploying from a machine whose network proxy rewrites the Authorization
 * header and so breaks Cloudflare's asset upload (it authenticates with a
 * one-time token of its own). Workers Builds and a normal `wrangler deploy`
 * use real static assets (wrangler.jsonc) and never load this file.
 *
 * It copies what the real asset server does for this app:
 * - a file that exists is served with the headers _headers gives it
 *   (worked out at build time by scripts/embed-assets.ts), an ETag, and a
 *   304 when the browser already has it;
 * - "/index.html" (and ".../index.html") redirects to its folder, as
 *   html_handling "auto-trailing-slash" does;
 * - anything else gets index.html (not_found_handling "single-page-application");
 *   the Worker turns a missing /assets/* file into a 404 itself (index.ts).
 *
 * No Cloudflare imports, so the Node tests can exercise it.
 */

export interface EmbeddedFile {
  /** File contents, base64. */
  b64: string;
  /** Quoted strong ETag, e.g. "\"3f2a…\"". */
  etag: string;
  /** Every response header for this file: Content-Type plus those from _headers. */
  headers: Record<string, string>;
}

export type EmbeddedFiles = Record<string, EmbeddedFile>;

export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

const INDEX = '/index.html';

function decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

export function createAssetFetcher(files: EmbeddedFiles): AssetFetcher {
  if (!files[INDEX]) throw new Error('embedded assets: index.html is missing (run npm run build first)');
  const decoded = new Map<string, Uint8Array<ArrayBuffer>>();
  const bytes = (path: string): Uint8Array<ArrayBuffer> => {
    let b = decoded.get(path);
    if (!b) {
      b = decode(files[path]!.b64);
      decoded.set(path, b);
    }
    return b;
  };

  function serve(request: Request, path: string): Response {
    const file = files[path]!;
    const headers = new Headers(file.headers);
    headers.set('ETag', file.etag);
    if (etagMatches(request.headers.get('if-none-match'), file.etag)) {
      headers.delete('Content-Type');
      return new Response(null, { status: 304, headers });
    }
    const body = bytes(path);
    headers.set('Content-Length', String(body.byteLength));
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  }

  return {
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      const url = new URL(request.url);
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        path = url.pathname;
      }
      if (path === INDEX || path.endsWith(INDEX)) {
        const target = new URL(url);
        target.pathname = url.pathname.slice(0, -'index.html'.length);
        return new Response(null, { status: 307, headers: { Location: target.pathname + target.search } });
      }
      const candidate = path.endsWith('/') ? `${path}index.html` : path;
      if (Object.hasOwn(files, candidate)) return serve(request, candidate);
      return serve(request, INDEX);
    },
  };
}
