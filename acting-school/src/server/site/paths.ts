/**
 * Every path of the public website, in one place: today the site lives under
 * /site on the app's own host; a custom domain serving it at its root later
 * only changes SITE_BASE (and the Worker / Node routing). Used by the public
 * pages (src/server/site/) and the staff API (GET /api/site/summary's URLs).
 */
import type { Locale } from '../../shared/enums';

export const SITE_BASE = '/site';

/** Which thank-you page: after the enquiry form or the casting-call form. */
export type SiteThanksKind = 'apply' | 'casting';

export const sitePaths = {
  /** Redirects to /site/en or /site/ar (Accept-Language). */
  root: () => SITE_BASE,
  home: (lang: Locale) => `${SITE_BASE}/${lang}`,
  workshops: (lang: Locale) => `${SITE_BASE}/${lang}/workshops`,
  workshop: (lang: Locale, courseId: number) => `${SITE_BASE}/${lang}/workshops/${courseId}`,
  workshopApply: (lang: Locale, courseId: number) => `${SITE_BASE}/${lang}/workshops/${courseId}/apply`,
  /** The general enquiry form ("Not sure which workshop? Ask us"). */
  apply: (lang: Locale) => `${SITE_BASE}/${lang}/apply`,
  castingCall: (lang: Locale) => `${SITE_BASE}/${lang}/casting-call`,
  links: (lang: Locale) => `${SITE_BASE}/${lang}/links`,
  thanks: (lang: Locale, kind: SiteThanksKind) => `${SITE_BASE}/${lang}/thanks?k=${kind}`,
  /** A public image (lib/siteContent.ts findPublicFile decides which). */
  media: (fileId: string) => `${SITE_BASE}/media/${fileId}`,
} as const;
