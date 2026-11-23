/**
 * Every path of the public website, in one place. The site has two homes:
 * - under /site on every ordinary host (the staff host, workers.dev, localhost:
 *   previews), e.g. /site/en/workshops;
 * - at the root of a public host (config.publicSiteHosts, PUBLIC_SITE_HOSTS:
 *   turquoisestudio.app), e.g. /en/workshops. The Worker (and the Node server)
 *   maps such a request's /x to the app's /site/x (publicHost.ts), so the app
 *   always routes under /site; only the links it writes differ.
 * Pages build their links with sitePathsFor(request URL, public hosts); the
 * staff API's summary uses `sitePaths` (the /site form) on the request origin.
 */
import type { Locale } from '../../shared/enums';

export const SITE_BASE = '/site';

/** '' on a public host (links at the root), '/site' everywhere else. */
export type SiteBase = '' | typeof SITE_BASE;

/** Which thank-you page: after the enquiry form or the casting-call form. */
export type SiteThanksKind = 'apply' | 'casting';

/** The site's paths with `base` in front ('' → bare paths for a public host). */
export function makeSitePaths(base: SiteBase) {
  return {
    base,
    /** Redirects to the English or Arabic home (Accept-Language). */
    root: () => base || '/',
    home: (lang: Locale) => `${base}/${lang}`,
    workshops: (lang: Locale) => `${base}/${lang}/workshops`,
    workshop: (lang: Locale, courseId: number) => `${base}/${lang}/workshops/${courseId}`,
    workshopApply: (lang: Locale, courseId: number) => `${base}/${lang}/workshops/${courseId}/apply`,
    /** The general enquiry form ("Not sure which workshop? Ask us"). */
    apply: (lang: Locale) => `${base}/${lang}/apply`,
    castingCall: (lang: Locale) => `${base}/${lang}/casting-call`,
    links: (lang: Locale) => `${base}/${lang}/links`,
    thanks: (lang: Locale, kind: SiteThanksKind) => `${base}/${lang}/thanks?k=${kind}`,
    /** A public image (lib/siteContent.ts findPublicFile decides which). */
    media: (fileId: string) => `${base}/media/${fileId}`,
  } as const;
}

export type SitePaths = ReturnType<typeof makeSitePaths>;

/** The /site form of every path (any non-public host). */
export const sitePaths = makeSitePaths(SITE_BASE);
/** The bare form, for a public host. */
export const publicHostSitePaths = makeSitePaths('');

/** A Host header or URL hostname → lower case, no port, no trailing dot. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/** Does `host` serve the public website at its root (PUBLIC_SITE_HOSTS)? */
export function isPublicSiteHost(host: string | null | undefined, publicHosts: readonly string[]): boolean {
  const h = normalizeHost(host);
  return h !== '' && publicHosts.includes(h);
}

/** The paths to write into a page served for `url`: bare on a public host, /site/… elsewhere. */
export function sitePathsFor(url: string | URL, publicHosts: readonly string[]): SitePaths {
  const host = (typeof url === 'string' ? new URL(url) : url).hostname;
  return isPublicSiteHost(host, publicHosts) ? publicHostSitePaths : sitePaths;
}

/**
 * The link back to a form from an error page, given the form page's path.
 * "?again=1" matters: when a form posts to its own address (the general form
 * and the casting call), a link that differs only by "#apply" is a jump within
 * the error page itself — the browser makes no request and the button seems dead.
 */
export const backToForm = (formPagePath: string) => `${formPagePath}?again=1#apply`;
