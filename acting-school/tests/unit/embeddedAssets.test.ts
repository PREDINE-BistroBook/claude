import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { wranglerDevArgs } from '../../scripts/cf-local';
import { parseHeadersText, unsupportedAssetConfig } from '../../scripts/embed-assets';
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

  it('never redirects to another host (protocol-relative or backslash tricks)', async () => {
    for (const path of ['//evil.com/index.html', '/\\evil.com/index.html', '/.//evil.com/index.html', '//evil.com/index.html?x=1', '///evil.com/index']) {
      const res = await get(path);
      const location = res.headers.get('location');
      if (location !== null) {
        expect(location, path).toMatch(/^\/(?!\/)/);
        expect(new URL(location, 'https://school.example').host, path).toBe('school.example');
      }
    }
    // A folder without its own index.html gets the app shell, not a redirect.
    const res = await get('//evil.com/index.html');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('redirects non-canonical spellings of real files and of index.html to the canonical path', async () => {
    const cases: [string, string][] = [
      ['/index%2Ehtml', '/'],
      ['/index', '/'],
      ['//sw.js', '/sw.js'],
      ['/sw%2Ejs', '/sw.js'],
    ];
    for (const [path, to] of cases) {
      const res = await get(path);
      expect(res.status, path).toBe(307);
      expect(res.headers.get('location'), path).toBe(to);
    }
    // /foo/index.html (no such folder) is just a client-side route.
    const spa = await get('/foo/index.html');
    expect(spa.status).toBe(200);
    expect(spa.headers.get('content-type')).toContain('text/html');
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

describe('scripts/embed-assets.ts refuses what it cannot serve like the real asset server', () => {
  it('reads the _headers this app uses: exact paths and a trailing *', () => {
    const rules = parseHeadersText(fs.readFileSync(new URL('../../src/web/public/_headers', import.meta.url), 'utf8'));
    expect(rules.map((r) => r.pattern)).toEqual(['/*', '/assets/*']);
    expect(rules[0]!.headers.map(([name]) => name)).toEqual(['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy']);
    expect(rules[1]!.headers).toEqual([['Cache-Control', 'public, max-age=31536000, immutable']]);
    expect(parseHeadersText('# only a comment\n\n')).toEqual([]);
  });

  it('refuses placeholders, a * that is not last, absolute URLs, header removal and lines it cannot read', () => {
    for (const bad of [
      '/blog/:slug\n  X-A: 1',
      '/*/deep\n  X-A: 1',
      '/a*b\n  X-A: 1',
      'https://example.com/*\n  X-A: 1',
      '//example.com/x\n  X-A: 1',
      'assets/*\n  X-A: 1',
      '/*\n  ! Content-Security-Policy',
      '/*\n  ! X-A: 1',
      '/*\n  no colon here',
      '  X-Orphan: 1',
    ]) {
      expect(() => parseHeadersText(bad), bad).toThrow(/_headers/);
    }
  });

  it('refuses a _redirects file in the built folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-test-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
      expect(unsupportedAssetConfig(dir)).toBeNull();
      fs.writeFileSync(path.join(dir, '_redirects'), '/old /new 301\n');
      expect(unsupportedAssetConfig(dir)).toMatch(/_redirects/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('local wrangler runs and the studio’s domains', () => {
  const config = (file: string) =>
    JSON.parse(
      fs
        .readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n'),
    ) as { routes?: { pattern: string; custom_domain?: boolean }[]; vars?: Record<string, string> };

  it('both deploy configs attach staff., the apex and www as custom domains, the apex first among the public hosts', () => {
    for (const file of ['wrangler.jsonc', 'wrangler.embedded.jsonc']) {
      const c = config(file);
      expect(c.routes, file).toEqual([
        { pattern: 'staff.turquoisestudio.app', custom_domain: true },
        { pattern: 'turquoisestudio.app', custom_domain: true },
        { pattern: 'www.turquoisestudio.app', custom_domain: true },
      ]);
      // The first entry is where the staff app's "Open / Copy link" point (lib/siteContent.ts siteUrls).
      expect(c.vars?.PUBLIC_SITE_HOSTS, file).toBe('turquoisestudio.app,www.turquoisestudio.app');
    }
  });

  it('cf:dev and cf:smoke never let wrangler rewrite the host from those routes', () => {
    const args = wranglerDevArgs({ port: 8850, config: 'wrangler.embedded.jsonc', persistTo: '/tmp/x', extra: ['--ip', '127.0.0.1'] });
    expect(args).toContain('--infer-origin-from-routes=false');
    expect(args.slice(0, 5)).toEqual(['wrangler', 'dev', '--local', '--port', '8850']);
    expect(args).toEqual(expect.arrayContaining(['-c', 'wrangler.embedded.jsonc', '--persist-to', '/tmp/x', '--ip', '127.0.0.1']));
    expect(wranglerDevArgs({ port: 8787 })).toEqual(['wrangler', 'dev', '--local', '--port', '8787', '--infer-origin-from-routes=false']);
    // Local only, always.
    expect(args.join(' ')).not.toMatch(/--remote|deploy/);
  });
});
