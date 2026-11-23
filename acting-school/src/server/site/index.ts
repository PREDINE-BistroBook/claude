/**
 * The public website, server-rendered: a Hono router mounted at /site by
 * createApp (src/server/app.ts) — no session, no X-Requested-With, the same
 * code on Node and in the Durable Object. On a public host (turquoisestudio.app)
 * the Worker / Node server map /x to /site/x first (publicHost.ts) and the
 * pages write bare links (paths.ts).
 *
 *   GET  /site                              → 302 /site/en or /site/ar (Accept-Language)
 *   GET  /site/:lang                        home
 *   GET  /site/:lang/workshops              the workshops on the site
 *   GET  /site/:lang/workshops/:id          one workshop + the apply form (404 page when not on the site)
 *   POST /site/:lang/workshops/:id/apply    → a website lead (submit.ts), 303 → thanks
 *   GET|POST /site/:lang/apply              the general enquiry form ("Not sure which workshop? Ask us")
 *   GET|POST /site/:lang/casting-call       the casting call and its form (closed: the page; POST 410)
 *   GET  /site/:lang/links                  link in bio
 *   GET  /site/:lang/thanks?k=apply|casting thank-you page
 *   GET  /site/media/:id                    a public image (lib/siteContent.ts findPublicFile)
 *   anything else under /site               a friendly 404 page in the right language
 *
 * Headers on every response: the CSP below, nosniff, Referrer-Policy; pages
 * "public, max-age=60", form responses, redirects and errors "no-store",
 * images "public, max-age=3600". Rendering only through hono/html's escaping
 * `html` template — never raw() with stored or submitted text.
 */
import { Hono, type Context } from 'hono';
import type { Locale } from '../../shared/enums';
import type { AppEnv } from '../env';
import { schoolToday } from '../lib/clock';
import { issueFormToken } from '../lib/siteForms';
import { findPublicFile, findPublicWorkshop, loadPublicCoaches, loadPublicWorkshops } from '../lib/siteContent';
import { bareSiteCtx, isLocale, langForPath, pathsFor, preferredLang, siteCtx, type SiteCtx } from './context';
import { emptyForm } from './forms';
import { SITE_MEDIA_CACHE, SITE_PAGE_CACHE, SITE_SECURITY_HEADERS } from './headers';
import { applyPage, castingPage, errorPage, homePage, linksPage, thanksPage, workshopPage, workshopsPage } from './pages';
import { SITE_BASE } from './paths';
import { htmlString, type Html } from './render';
import { sendError, submitApply, submitCasting } from './submit';


const site = new Hono<AppEnv>();

site.use('*', async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SITE_SECURITY_HEADERS)) c.header(name, value);
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});

/**
 * The visible form of an app path (/site/…): bare on a public host. Runs of slashes are merged, so the
 * result is always a same-site path ("//evil.example" would be another host).
 */
function visible(c: Context<AppEnv>, appPath: string): string {
  const paths = pathsFor(c);
  const clean = appPath.replace(/\/{2,}/g, '/');
  return paths.base === SITE_BASE ? clean : clean.slice(SITE_BASE.length).replace(/^\/*/, '/');
}

/** "/site/en/" → "/site/en" (one canonical spelling per page). */
site.use('*', async (c, next) => {
  const path = c.req.path;
  if (path.length > SITE_BASE.length + 1 && path.endsWith('/')) {
    const url = new URL(c.req.url);
    c.header('Cache-Control', 'no-store');
    return c.redirect(visible(c, path.replace(/\/+$/, '')) + url.search, 301);
  }
  await next();
});

function page(c: Context<AppEnv>, body: Html, status: 200 = 200) {
  c.header('Cache-Control', SITE_PAGE_CACHE);
  return c.html(htmlString(body), status);
}

/** The 404 page in the language of the path (or the browser's). */
function notFoundPage(c: Context<AppEnv>, lang?: Locale) {
  const l = lang ?? langForPath(c.req.path, c.req.header('accept-language'));
  return sendError(c, siteCtx(c, l), 'notFound', 404);
}

/** :lang → the page context, or null (answer the 404 page). */
function langCtx(c: Context<AppEnv>): SiteCtx | null {
  const lang = c.req.param('lang');
  return isLocale(lang) ? siteCtx(c, lang) : null;
}

/** A positive integer route id, else null. */
function routeId(value: string | undefined): number | null {
  return value && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}

site.get('/', (c) => {
  const lang = preferredLang(c.req.header('accept-language'));
  c.header('Cache-Control', 'no-store');
  c.header('Vary', 'Accept-Language');
  return c.redirect(pathsFor(c).home(lang), 302);
});

site.get('/media/:id', async (c) => {
  const row = findPublicFile(c.get('db'), c.req.param('id'), schoolToday(c));
  const data = row ? await c.get('files').get(row.storageKey) : null;
  if (!row || !data) return notFoundPage(c);
  return c.body(data, 200, {
    'Content-Type': row.mime,
    'Cache-Control': SITE_MEDIA_CACHE,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
});

site.get('/:lang', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  const db = c.get('db');
  return page(c, homePage(ctx, { workshops: loadPublicWorkshops(db, ctx.today), coaches: loadPublicCoaches(db) }));
});

site.get('/:lang/workshops', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  return page(c, workshopsPage(ctx, loadPublicWorkshops(c.get('db'), ctx.today)));
});

site.get('/:lang/workshops/:id', (c) => {
  const ctx = langCtx(c);
  const id = routeId(c.req.param('id'));
  if (!ctx || id === null) return notFoundPage(c, ctx?.lang);
  const db = c.get('db');
  const w = findPublicWorkshop(db, id, ctx.today);
  if (!w) return notFoundPage(c, ctx.lang);
  return page(c, workshopPage(ctx, w, { state: emptyForm(), token: issueFormToken(db, 'apply') }));
});

// After a form came back with errors its URL is …/apply: reloading it shows the workshop again.
site.get('/:lang/workshops/:id/apply', (c) => {
  const ctx = langCtx(c);
  const id = routeId(c.req.param('id'));
  if (!ctx || id === null) return notFoundPage(c, ctx?.lang);
  c.header('Cache-Control', 'no-store');
  return c.redirect(`${ctx.paths.workshop(ctx.lang, id)}#apply`, 302);
});

site.post('/:lang/workshops/:id/apply', (c) => {
  const ctx = langCtx(c);
  const id = routeId(c.req.param('id'));
  if (!ctx || id === null) return notFoundPage(c, ctx?.lang);
  return submitApply(c, ctx, id);
});

site.get('/:lang/apply', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  return page(c, applyPage(ctx, { state: emptyForm(), token: issueFormToken(c.get('db'), 'apply') }));
});

site.post('/:lang/apply', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  return submitApply(c, ctx, null);
});

site.get('/:lang/casting-call', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  const token = ctx.content.castingCall.open ? issueFormToken(c.get('db'), 'casting') : '';
  return page(c, castingPage(ctx, { state: emptyForm(), token }));
});

site.post('/:lang/casting-call', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  return submitCasting(c, ctx);
});

site.get('/:lang/links', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  return page(c, linksPage(ctx, loadPublicWorkshops(c.get('db'), ctx.today)));
});

site.get('/:lang/thanks', (c) => {
  const ctx = langCtx(c);
  if (!ctx) return notFoundPage(c);
  c.header('Cache-Control', 'no-store');
  return c.html(htmlString(thanksPage(ctx, c.req.query('k') === 'casting' ? 'casting' : 'apply')));
});

site.all('*', (c) => notFoundPage(c));

site.onError((err, c) => {
  console.error(err);
  const lang = langForPath(c.req.path, c.req.header('accept-language'));
  let body: Html;
  try {
    body = errorPage(siteCtx(c, lang), 'error');
  } catch {
    body = errorPage(bareSiteCtx(new URL(c.req.url), lang, pathsFor(c)), 'error');
  }
  c.header('Cache-Control', 'no-store');
  return c.html(htmlString(body), 500);
});

export default site;
