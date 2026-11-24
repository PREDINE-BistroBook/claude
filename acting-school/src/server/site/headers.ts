/** Response headers of every public-site response (the site router, and the Worker's own 413 page). */
export const SITE_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const SITE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': SITE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** Pages: a minute in any cache. Form responses, redirects and error pages: no-store. Images: an hour. */
export const SITE_PAGE_CACHE = 'public, max-age=60';
export const SITE_MEDIA_CACHE = 'public, max-age=3600';
