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
      let decoded: string;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        decoded = url.pathname;
      }
      // One canonical path, used both to find the file and to build any redirect: backslashes as
      // slashes, runs of slashes merged. It always starts with exactly one "/", so a redirect built
      // from it can never point at another host (no "//evil.com/" protocol-relative Location).
      const clean = `/${decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '')}`;
      const redirect = (to: string) => new Response(null, { status: 307, headers: { Location: encodeURI(to) + url.search } });
      const has = (p: string) => Object.hasOwn(files, p);

      // ".../index.html" and ".../index" → the folder, when that folder's index.html exists (html_handling auto-trailing-slash).
      for (const suffix of ['index.html', 'index']) {
        const folder = clean.slice(0, -suffix.length);
        if (clean.endsWith(`/${suffix}`) && has(`${folder}index.html`)) return redirect(folder);
      }
      const candidate = clean.endsWith('/') ? `${clean}index.html` : clean;
      if (has(candidate)) {
        // A real file asked for by a non-canonical spelling (//sw.js, /sw%2Ejs): send the browser to the canonical one.
        if (encodeURI(clean) !== url.pathname) return redirect(clean);
        return serve(request, candidate);
      }
      return serve(request, INDEX);
    },
  };
}
