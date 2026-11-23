import { describe, expect, it } from 'vitest';
import { createAssetFetcher, type EmbeddedFiles } from '../../src/worker/embeddedAssets';

/** The stand-in for Workers static assets used by the "embedded" deploy (wrangler.embedded.jsonc). */

const b64 = (s: string) => Buffer.from(s).toString('base64');
const FILES: EmbeddedFiles = {
  '/index.html': { b64: b64('<!doctype html><title>app</title>'), etag: '"idx"', headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff' } },
  '/assets/app-abc.js': { b64: b64('console.log(1)'), etag: '"js"', headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' } },
  '/sw.js': { b64: b64('self.x=1'), etag: '"sw"', headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=0, must-revalidate' } },
};
const assets = createAssetFetcher(FILES);
const get = (path: string, init?: RequestInit) => assets.fetch(new Request(`https://school.example${path}`, init));

describe('embedded assets', () => {
  it('serves a file with its headers and an ETag', async () => {
    const res = await get('/assets/app-abc.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
    expect(res.headers.get('content-type')).toBe('application/javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('etag')).toBe('"js"');
    expect(res.headers.get('content-length')).toBe('14');
  });

  it('answers 304 when the browser already has the file', async () => {
    const res = await get('/sw.js', { headers: { 'If-None-Match': 'W/"sw"' } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"sw"');
  });

  it('serves index.html for client-side routes and the root', async () => {
    for (const path of ['/', '/students/12', '/talent/3?tab=photos']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<title>app</title>');
    }
  });

  it('gives a missing hashed file the HTML shell (the Worker turns that into a 404, as with real assets)', async () => {
    const res = await get('/assets/gone-123.js');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('redirects /index.html to / like html_handling auto-trailing-slash', async () => {
    const res = await get('/index.html?x=1');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/?x=1');
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const head = await get('/sw.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await get('/', { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('does not treat object prototype names as files', async () => {
    const res = await get('/constructor');
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('refuses to start without index.html', () => {
    expect(() => createAssetFetcher({})).toThrow(/index\.html/);
  });
});
