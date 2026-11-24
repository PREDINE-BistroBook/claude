/**
 * What every public page needs, worked out once per request: the language and
 * its strings, the links for this host (paths.ts), the site content, the
 * studio's name and the school's today.
 */
import type { Context } from 'hono';
import { LOCALES, type Locale } from '../../shared/enums';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../shared/schemas/site';
import type { AppEnv } from '../env';
import { schoolToday } from '../lib/clock';
import { getSettings } from '../lib/settings';
import { getSiteContent } from '../lib/siteContent';
import { SITE_STRINGS, type SiteStrings } from './i18n';
import { SITE_BASE, isPublicSiteHost, publicHostSitePaths, sitePaths, type SitePaths } from './paths';

export interface SiteCtx {
  lang: Locale;
  t: SiteStrings;
  paths: SitePaths;
  /** "https://host" of this request. */
  origin: string;
  /**
   * Set on a /site preview (the staff host, workers.dev) when the studio has its own domain:
   * "https://turquoisestudio.app". The page's canonical, hreflang and og:url then name that domain
   * (without /site), so the preview isn't a second copy of the site for search engines and link previews.
   */
  canonicalOrigin?: string;
  /**
   * A /site preview of a website that is not public yet (content.published false): every page says so
   * in a slim banner at the top and stays out of search results. Never set on a public host — there an
   * unpublished site is the "coming soon" page (index.ts).
   */
  preview?: boolean;
  studioName: string;
  content: SiteContent;
  /** For wa.me links (settings.defaultCountryCode). */
  countryCode: string;
  /** The school's today (YYYY-MM-DD). */
  today: string;
}

export const isLocale = (v: string | undefined): v is Locale => !!v && (LOCALES as readonly string[]).includes(v);

/** The language a visitor's browser prefers between ours (Accept-Language, q-values); English otherwise. */
export function preferredLang(header: string | null | undefined): Locale {
  let best: Locale = 'en';
  let bestQ = 0;
  for (const part of (header ?? '').split(',')) {
    const [tag = '', ...params] = part.trim().split(';');
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (!isLocale(primary)) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (Number.isFinite(q) && q > bestQ) {
      best = primary;
      bestQ = q;
    }
  }
  return best;
}

/** The language of a /site/<lang>/… path, else the browser's preference (for 404 pages). */
export function langForPath(path: string, acceptLanguage: string | null | undefined): Locale {
  const seg = path.startsWith(`${SITE_BASE}/`) ? path.slice(SITE_BASE.length + 1).split('/')[0] : undefined;
  return isLocale(seg) ? seg : preferredLang(acceptLanguage);
}

/** Paths for this request's host. */
export function pathsFor(c: Context<AppEnv>): SitePaths {
  return isPublicSiteHost(new URL(c.req.url).hostname, c.get('config').publicSiteHosts) ? publicHostSitePaths : sitePaths;
}

export function siteCtx(c: Context<AppEnv>, lang: Locale): SiteCtx {
  const db = c.get('db');
  const settings = getSettings(db);
  const t = SITE_STRINGS[lang];
  const name = (lang === 'ar' ? settings.schoolNameAr || settings.schoolName : settings.schoolName)?.trim() || t.meta.studioName;
  const paths = pathsFor(c);
  const publicHost = c.get('config').publicSiteHosts[0];
  const content = getSiteContent(db);
  return {
    lang,
    t,
    paths,
    origin: new URL(c.req.url).origin,
    canonicalOrigin: publicHost && paths.base === SITE_BASE ? `https://${publicHost}` : undefined,
    preview: paths.base === SITE_BASE && !content.published,
    studioName: name,
    content,
    countryCode: settings.defaultCountryCode,
    today: schoolToday(c),
  };
}

/** For pages rendered without the database (the Worker's 413 page). */
export function bareSiteCtx(url: URL, lang: Locale, paths: SitePaths): SiteCtx {
  return {
    lang,
    t: SITE_STRINGS[lang],
    paths,
    origin: url.origin,
    studioName: SITE_STRINGS[lang].meta.studioName,
    content: DEFAULT_SITE_CONTENT,
    countryCode: '20',
    today: '',
  };
}
