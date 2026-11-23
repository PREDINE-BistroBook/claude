import { count } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app';
import { castingApplications, leads, rateLimits } from '../../src/server/db/schema';
import { parsePublicSiteHosts, testConfig } from '../../src/server/config';
import { sqliteFileStore } from '../../src/server/lib/fileStore';
import { getSiteContent, saveSiteContent } from '../../src/server/lib/siteContent';
import { SITE_CSP } from '../../src/server/site/headers';
import { SITE_STRINGS } from '../../src/server/site/i18n';
import { isPublicSiteHost, normalizeHost, publicHostSitePaths, sitePaths, sitePathsFor } from '../../src/server/site/paths';
import { routePublicHost } from '../../src/server/site/publicHost';
import { maxBodyBytes, routeRequest, type WorkerDeps } from '../../src/worker/routing';
import { MAX_UPLOAD_BYTES } from '../../src/shared/schemas/files';
import { SITE_APPLY_MAX_BYTES, SITE_CASTING_MAX_BYTES } from '../../src/shared/schemas/site';
import { testDb } from '../helpers';

/**
 * The Worker's routing (src/worker/routing.ts) with a fake ASSETS binding and
 * Durable Object stub — and, at the end, the real app behind the stub — plus
 * the per-host link building in src/server/site/paths.ts.
 */

const HOSTS = parsePublicSiteHosts('turquoisestudio.app, www.turquoisestudio.app');

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** Fakes that record what reached them. */
function fakes() {
  const school: Seen[] = [];
  const assets: Seen[] = [];
  const record = (into: Seen[], label: string, contentType = 'text/plain') => ({
    async fetch(request: Request) {
      into.push({ url: request.url, method: request.method, headers: request.headers, body: request.body ? await request.text() : '' });
      return new Response(label, { status: 200, headers: { 'content-type': contentType } });
    },
  });
  let assetType = 'text/html; charset=utf-8';
  const deps: WorkerDeps = {
    assets: { fetch: (r) => record(assets, 'asset', assetType).fetch(r) },
    school: () => record(school, 'school'),
    publicSiteHosts: HOSTS,
  };
  return { deps, school, assets, setAssetType: (t: string) => (assetType = t) };
}

const req = (url: string, init?: RequestInit) => new Request(url, init);

describe('PUBLIC_SITE_HOSTS and the links per host (paths.ts)', () => {
  it('parses the list: lower case, no port or scheme, no blanks or repeats', () => {
    expect(parsePublicSiteHosts('turquoisestudio.app,www.turquoisestudio.app')).toEqual(['turquoisestudio.app', 'www.turquoisestudio.app']);
    expect(parsePublicSiteHosts(' TurquoiseStudio.APP:443 , https://www.turquoisestudio.app/ ,, turquoisestudio.app ')).toEqual(['turquoisestudio.app', 'www.turquoisestudio.app']);
    expect(parsePublicSiteHosts(undefined)).toEqual([]);
    expect(parsePublicSiteHosts('')).toEqual([]);
    expect(testConfig().publicSiteHosts).toEqual([]);
  });

  it('a public host gets bare links; every other host (staff, workers.dev, localhost) /site/…', () => {
    expect(normalizeHost('TurquoiseStudio.app:8443')).toBe('turquoisestudio.app');
    expect(isPublicSiteHost('turquoisestudio.app.', HOSTS)).toBe(true);
    expect(isPublicSiteHost('team.turquoisestudio.app', HOSTS)).toBe(false);
    expect(isPublicSiteHost('', HOSTS)).toBe(false);

    const pub = sitePathsFor('https://turquoisestudio.app/site/en', HOSTS);
    expect(pub).toBe(publicHostSitePaths);
    expect(pub.root()).toBe('/');
    expect(pub.home('ar')).toBe('/ar');
    expect(pub.workshop('en', 12)).toBe('/en/workshops/12');
    expect(pub.workshopApply('en', 12)).toBe('/en/workshops/12/apply');
    expect(pub.castingCall('ar')).toBe('/ar/casting-call');
    expect(pub.links('en')).toBe('/en/links');
    expect(pub.thanks('ar', 'apply')).toBe('/ar/thanks?k=apply');
    expect(pub.media('abc')).toBe('/media/abc');

    for (const url of ['https://team.turquoisestudio.app/site/en', 'https://claude.example.workers.dev/site', 'http://localhost:3000/site/ar']) {
      const p = sitePathsFor(url, HOSTS);
      expect(p, url).toBe(sitePaths);
      expect(p.root()).toBe('/site');
      expect(p.home('ar')).toBe('/site/ar');
      expect(p.media('abc')).toBe('/site/media/abc');
    }
    // No public hosts configured: /site everywhere.
    expect(sitePathsFor('https://turquoisestudio.app/', [])).toBe(sitePaths);
  });

  it('routePublicHost: www → the apex (path and query kept), /x → /site/x, other hosts untouched', () => {
    expect(routePublicHost(new URL('https://www.turquoisestudio.app/ar/workshops?utm=ig'), HOSTS)).toEqual({ kind: 'redirect', location: 'https://turquoisestudio.app/ar/workshops?utm=ig' });
    expect(routePublicHost(new URL('https://turquoisestudio.app/'), HOSTS)).toEqual({ kind: 'site', url: 'https://turquoisestudio.app/site' });
    expect(routePublicHost(new URL('https://turquoisestudio.app/en/workshops/12?x=1'), HOSTS)).toEqual({ kind: 'site', url: 'https://turquoisestudio.app/site/en/workshops/12?x=1' });
    expect(routePublicHost(new URL('https://turquoisestudio.app/../api/students'), HOSTS)).toEqual({ kind: 'site', url: 'https://turquoisestudio.app/site/api/students' });
    expect(routePublicHost(new URL('https://team.turquoisestudio.app/site/en'), HOSTS)).toEqual({ kind: 'staff' });
    // www alone (apex not listed) is served, not redirected.
    expect(routePublicHost(new URL('https://www.example.org/en'), ['www.example.org'])).toEqual({ kind: 'site', url: 'https://www.example.org/site/en' });
  });

  it('body caps per route', () => {
    expect(maxBodyBytes('/api/auth/login')).toBe(1024 * 1024);
    expect(maxBodyBytes('/api/files')).toBe(MAX_UPLOAD_BYTES + 64 * 1024);
    expect(maxBodyBytes('/site/en/apply')).toBe(SITE_APPLY_MAX_BYTES);
    expect(maxBodyBytes('/site/ar/workshops/3/apply')).toBe(SITE_APPLY_MAX_BYTES);
    expect(maxBodyBytes('/site/ar/casting-call')).toBe(SITE_CASTING_MAX_BYTES);
  });
});

describe('the Worker on the staff host (and workers.dev, localhost)', () => {
  it('/api/* and /site, /site/* go to the Durable Object; everything else to the static assets, as before', async () => {
    const f = fakes();
    for (const path of ['/api/health', '/api', '/site', '/site/en', '/site/ar/casting-call', '/site/media/x']) {
      await routeRequest(req(`https://team.turquoisestudio.app${path}`), f.deps);
    }
    expect(f.school.map((s) => new URL(s.url).pathname)).toEqual(['/api/health', '/api', '/site', '/site/en', '/site/ar/casting-call', '/site/media/x']);
    expect(f.assets).toHaveLength(0);
    for (const path of ['/', '/students/12', '/login', '/sw.js', '/sitemap.xml', '/siteX', '/manifest.webmanifest']) {
      const res = await routeRequest(req(`https://team.turquoisestudio.app${path}`), f.deps);
      expect(await res.text(), path).toBe('asset');
    }
    expect(f.assets.map((a) => new URL(a.url).pathname)).toEqual(['/', '/students/12', '/login', '/sw.js', '/sitemap.xml', '/siteX', '/manifest.webmanifest']);
    expect(f.school).toHaveLength(6);
  });

  it('a missing hashed /assets/* file is a 404, not the HTML shell', async () => {
    const f = fakes();
    const res = await routeRequest(req('https://claude.example.workers.dev/assets/old-123.js'), f.deps);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    f.setAssetType('application/javascript');
    expect((await routeRequest(req('https://claude.example.workers.dev/assets/app-1.js'), f.deps)).status).toBe(200);
  });

  it('too large for the route: 413 before the Durable Object (JSON for the API, the friendly page for the site)', async () => {
    const f = fakes();
    const post = (path: string, length: number) => req(`https://team.turquoisestudio.app${path}`, { method: 'POST', headers: { 'content-length': String(length) } });
    const api = await routeRequest(post('/api/auth/login', 1024 * 1024 + 1), f.deps);
    expect(api.status).toBe(413);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe('payload_too_large');

    const apply = await routeRequest(post('/site/ar/apply', SITE_APPLY_MAX_BYTES + 1), f.deps);
    expect(apply.status).toBe(413);
    expect(apply.headers.get('content-type')).toContain('text/html');
    expect(apply.headers.get('content-security-policy')).toBe(SITE_CSP);
    expect(apply.headers.get('cache-control')).toBe('no-store');
    const page = await apply.text();
    expect(page).toContain('<html lang="ar" dir="rtl">');
    expect(page).toContain(SITE_STRINGS.ar.pages.tooLargeTitle);

    const casting = await routeRequest(post('/site/en/casting-call', SITE_CASTING_MAX_BYTES + 1), f.deps);
    expect(casting.status).toBe(413);
    // "Back to the form" must be a real navigation, not a jump within the error page (the form posts to its own address).
    expect(await casting.text()).toContain('href="/site/en/casting-call?again=1#apply"');
    expect(f.school).toHaveLength(0);

    // Within the cap: through (a 10 MB casting form, an 8 MB upload).
    await routeRequest(post('/site/en/casting-call', 10 * 1024 * 1024), f.deps);
    await routeRequest(post('/api/files', MAX_UPLOAD_BYTES), f.deps);
    expect(f.school).toHaveLength(2);
  });
});

describe('the Worker on the public hosts (turquoisestudio.app)', () => {
  it('www → 301 to the apex with the same path and query', async () => {
    const f = fakes();
    const res = await routeRequest(req('https://www.turquoisestudio.app/ar/casting-call?from=ig'), f.deps);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://turquoisestudio.app/ar/casting-call?from=ig');
    expect(f.school).toHaveLength(0);
    expect(f.assets).toHaveLength(0);
  });

  it('every path goes to the site at /site/x — nothing of the staff app (API, login, static files, service worker) answers', async () => {
    const f = fakes();
    const paths = ['/', '/ar', '/en/workshops/12', '/ar/casting-call', '/en/links', '/media/abc', '/api/auth/me', '/api/health', '/login', '/students/3', '/sw.js', '/assets/app.js', '/manifest.webmanifest', '/index.html'];
    for (const p of paths) await routeRequest(req(`https://turquoisestudio.app${p}`), f.deps);
    expect(f.assets).toHaveLength(0);
    expect(f.school.map((s) => s.url)).toEqual(paths.map((p) => `https://turquoisestudio.app${p === '/' ? '/site' : `/site${p}`}`));
  });

  it('a POST keeps its method, headers (client address) and body; the per-route caps apply to the visible path', async () => {
    const f = fakes();
    const body = 'firstName=Mona&privacyConsent=on';
    await routeRequest(
      req('https://turquoisestudio.app/en/apply', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.5', origin: 'https://turquoisestudio.app' } }),
      f.deps,
    );
    expect(f.school[0]).toMatchObject({ url: 'https://turquoisestudio.app/site/en/apply', method: 'POST', body });
    expect(f.school[0]!.headers.get('cf-connecting-ip')).toBe('203.0.113.5');
    expect(f.school[0]!.headers.get('origin')).toBe('https://turquoisestudio.app');

    const big = await routeRequest(req('https://turquoisestudio.app/ar/casting-call', { method: 'POST', headers: { 'content-length': String(SITE_CASTING_MAX_BYTES + 1) } }), f.deps);
    expect(big.status).toBe(413);
    const page = await big.text();
    // Links on a public host are bare.
    expect(page).toContain('href="/ar/casting-call?again=1#apply"');
    expect(page).toContain('href="/ar"');
    expect(page).not.toContain('/site/');
    expect(f.school).toHaveLength(1);
  });
});

describe('the real app behind the Worker', () => {
  /** The app with the studio's domain configured and a little content; `published` is the "Website is public" switch. */
  function realApp(opts: { published?: boolean } = {}) {
    const db = testDb();
    const app = createApp({ db, config: testConfig({ publicSiteHosts: HOSTS }), files: sqliteFileStore(db) });
    saveSiteContent(db, {
      ...getSiteContent(db),
      published: opts.published ?? true,
      tagline: { en: 'Draft tagline', ar: '' },
      whatsappWorkshops: '01094635959',
      castingCall: { open: true, intro: { en: 'Open', ar: 'مفتوح' }, lookingFor: { en: '', ar: '' } },
    });
    const deps: WorkerDeps = {
      assets: { fetch: async () => new Response('staff app', { headers: { 'content-type': 'text/html' } }) },
      school: () => ({ fetch: async (r: Request) => app.fetch(r) }),
      publicSiteHosts: HOSTS,
    };
    return { deps, db };
  }

  it('on the public host: / redirects to a bare language path; pages link with bare paths; the API is the site’s 404 page', async () => {
    const { deps } = realApp();
    const root = await routeRequest(req('https://turquoisestudio.app/', { headers: { 'accept-language': 'ar' } }), deps);
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/ar');

    const home = await routeRequest(req('https://turquoisestudio.app/en'), deps);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('href="/en/workshops"');
    expect(html).toContain('href="/en/casting-call"');
    expect(html).toContain('href="/ar" hreflang="ar"');
    expect(html).toContain('<link rel="canonical" href="https://turquoisestudio.app/en">');
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://turquoisestudio.app/">');
    expect(html).not.toMatch(/href="\/site/);

    for (const path of ['/api/health', '/api/auth/me', '/login', '/sw.js']) {
      const res = await routeRequest(req(`https://turquoisestudio.app${path}`), deps);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('text/html');
      expect(await res.text()).toContain(SITE_STRINGS.en.pages.notFoundTitle);
    }

    // The trailing-slash redirect and the form's thank-you redirect stay bare too — and never leave the site.
    expect((await routeRequest(req('https://turquoisestudio.app/en/links/'), deps)).headers.get('location')).toBe('/en/links');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const sneaky of [
      '//evil.example/',
      '///evil.example//',
      '/%2F%2Fevil.example/',
      // Hono's c.req.path is percent-decoded: an encoded backslash, tab or line break must not reach the Location header.
      '/%5Cevil.example/',
      '/%5C%5Cevil.example/',
      '/%5cevil.example/?a=1',
      '/%09/evil.example/',
      '/%20/evil.example/',
      '/%0D%0ASet-Cookie:x=1/',
      '/%0A/evil.example/',
    ]) {
      const res = await routeRequest(req(`https://turquoisestudio.app${sneaky}`), deps);
      expect(res.status, sneaky).not.toBe(500);
      expect(res.headers.get('set-cookie'), sneaky).toBeNull();
      const location = res.headers.get('location');
      if (location === null) continue;
      expect(location, sneaky).toMatch(/^\/[^/\\\s]/);
      // What a browser makes of it: the same host, always.
      expect(new URL(location, 'https://turquoisestudio.app/').host, sneaky).toBe('turquoisestudio.app');
    }
    expect(quiet).not.toHaveBeenCalled();
    quiet.mockRestore();
    expect((await routeRequest(req('https://turquoisestudio.app/%5Cevil.example/?a=1'), deps)).headers.get('location')).toBe('/%5Cevil.example?a=1');
    expect((await routeRequest(req('https://team.turquoisestudio.app/site//evil.example/'), deps)).headers.get('location')).toBe('/site/evil.example');
    const bot = await routeRequest(
      req('https://turquoisestudio.app/en/apply', { method: 'POST', body: 'website=spam', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      deps,
    );
    expect(bot.status).toBe(303);
    expect(bot.headers.get('location')).toBe('/en/thanks?k=apply#thanks');
  });

  it('on the staff host: the staff app as before, and /site previews with /site links', async () => {
    const { deps } = realApp();
    expect(await (await routeRequest(req('https://team.turquoisestudio.app/students/1'), deps)).text()).toBe('staff app');
    expect((await routeRequest(req('https://team.turquoisestudio.app/api/health'), deps)).status).toBe(200);
    const preview = await (await routeRequest(req('https://team.turquoisestudio.app/site/en'), deps)).text();
    expect(preview).toContain('href="/site/en/workshops"');
    // The preview names the studio's own domain as the page's address (not a second copy of the site).
    expect(preview).toContain('<link rel="canonical" href="https://turquoisestudio.app/en">');
    expect(preview).toContain('<link rel="alternate" hreflang="ar" href="https://turquoisestudio.app/ar">');
    expect(preview).toContain('<link rel="alternate" hreflang="x-default" href="https://turquoisestudio.app/">');
    expect(preview).toContain('<meta property="og:url" content="https://turquoisestudio.app/en">');
    const links = await (await routeRequest(req('https://team.turquoisestudio.app/site/ar/links'), deps)).text();
    expect(links).toContain('<link rel="canonical" href="https://turquoisestudio.app/ar/links">');
    // The website is public here: no "Preview" banner.
    expect(preview).not.toContain(SITE_STRINGS.en.soon.previewBanner);
  });

  it('a public host while the website is not public: one "coming soon" page, everything else back to it, no images, no forms, www → apex as ever', async () => {
    const { deps, db } = realApp({ published: false });
    const stored = () => ({
      leads: db.select({ n: count() }).from(leads).get()!.n,
      applications: db.select({ n: count() }).from(castingApplications).get()!.n,
      limits: db.select({ n: count() }).from(rateLimits).get()!.n,
    });
    const before = stored();

    const root = await routeRequest(req('https://turquoisestudio.app/', { headers: { 'accept-language': 'ar' } }), deps);
    expect(root.status).toBe(200);
    expect(root.headers.get('cache-control')).toBe('no-store');
    expect(root.headers.get('x-robots-tag')).toBe('noindex');
    expect(root.headers.get('content-security-policy')).toBe(SITE_CSP);
    const html = await root.text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain(SITE_STRINGS.ar.soon.title);
    expect(html).toContain(SITE_STRINGS.en.soon.title);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('href="https://wa.me/201094635959?text=');
    // Nothing of the drafts, no way into the site, nothing of the staff app.
    expect(html).not.toContain('Draft tagline');
    expect(html).not.toMatch(/href="\/(en|ar|site|media|api)/);
    expect(html).not.toContain('staff app');

    for (const path of ['/en', '/ar/workshops', '/en/casting-call', '/ar/links', '/en/thanks?k=apply', '/en/', '/api/health', '/api/auth/me', '/login', '/sw.js', '/assets/index-abc.js', '/site/en', '//evil.example/', '/%5Cevil.example/', '/%0D%0ASet-Cookie:x=1/']) {
      const res = await routeRequest(req(`https://turquoisestudio.app${path}`), deps);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toBe('/');
      expect(res.headers.get('cache-control'), path).toBe('no-store');
      expect(res.headers.get('set-cookie'), path).toBeNull();
      expect(await res.text(), path).not.toContain('staff app');
    }
    expect((await routeRequest(req('https://turquoisestudio.app/media/00000000-0000-4000-8000-000000000000'), deps)).status).toBe(404);

    // Forms: the same page with 503, and nothing stored or counted (a bot's trap field included).
    for (const [path, init] of [
      ['/en/apply', { method: 'POST', body: 'website=spam', headers: { 'content-type': 'application/x-www-form-urlencoded' } }],
      ['/ar/casting-call', { method: 'POST', body: 'firstName=A', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://turquoisestudio.app' } }],
      ['/api/auth/login', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }],
    ] as const) {
      const res = await routeRequest(req(`https://turquoisestudio.app${path}`, init), deps);
      expect(res.status, path).toBe(503);
      expect(res.headers.get('cache-control'), path).toBe('no-store');
      expect(await res.text(), path).toContain(SITE_STRINGS.en.soon.title);
    }
    expect(stored()).toEqual(before);

    // www → the apex, exactly as when public.
    const www = await routeRequest(req('https://www.turquoisestudio.app/ar/links?from=ig'), deps);
    expect([www.status, www.headers.get('location')]).toEqual([301, 'https://turquoisestudio.app/ar/links?from=ig']);

    // The staff host is untouched: the app, the API, and the whole site as a preview with its banner.
    expect(await (await routeRequest(req('https://team.turquoisestudio.app/students/1'), deps)).text()).toBe('staff app');
    expect((await routeRequest(req('https://team.turquoisestudio.app/api/health'), deps)).status).toBe(200);
    const preview = await routeRequest(req('https://team.turquoisestudio.app/site/en'), deps);
    expect(preview.status).toBe(200);
    const page = await preview.text();
    expect(page).toContain('Draft tagline');
    expect(page).toContain(SITE_STRINGS.en.soon.previewBanner);
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('href="/site/en/workshops"');
    // …and a form sent from the preview is handled (the trap field: a pretend thank-you).
    const bot = await routeRequest(
      req('https://team.turquoisestudio.app/site/en/apply', { method: 'POST', body: 'website=spam', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      deps,
    );
    expect([bot.status, bot.headers.get('location')]).toEqual([303, '/site/en/thanks?k=apply#thanks']);

    // Switched on: the domain serves the site.
    saveSiteContent(db, { ...getSiteContent(db), published: true });
    const open = await routeRequest(req('https://turquoisestudio.app/', { headers: { 'accept-language': 'ar' } }), deps);
    expect([open.status, open.headers.get('location')]).toEqual([302, '/ar']);
    expect(await (await routeRequest(req('https://turquoisestudio.app/en'), deps)).text()).toContain('Draft tagline');
  });
});
