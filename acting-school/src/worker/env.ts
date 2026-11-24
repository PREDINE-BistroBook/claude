/** Bindings and variables of the "claude" Worker (wrangler.jsonc; secrets set in the dashboard or with `wrangler secret put`). */
export interface Env {
  /** The school's Durable Object (SchoolDO): one instance, named "main", holds the whole app and its SQLite database. */
  SCHOOL: DurableObjectNamespace;
  /** The built web app (dist/web), served as static assets. */
  ASSETS: Fetcher;
  /** Optional R2 bucket for uploaded files; without it files are stored in the Durable Object's SQLite. */
  FILES?: R2Bucket;
  /** IANA zone of the school (default Africa/Cairo). */
  SCHOOL_TIME_ZONE?: string;
  /** "true" only on a demo deployment: allows POST /api/admin/reset. */
  ALLOW_DEMO_RESET?: string;
  /** Secret: bearer token for /api/admin/* (at least 24 characters), and the setup code for first-run setup. Unset = no admin routes, no setup. */
  ADMIN_TOKEN?: string;
  /** Old staff-app hosts that forward to the current one: "old.host=new.host,…" (src/worker/hostRedirect.ts). */
  HOST_REDIRECTS?: string;
  /** Session lifetime in days (default 30). */
  SESSION_DAYS?: string;
  /** "false" to send the session cookie without Secure (never needed on Cloudflare, which always serves HTTPS). */
  COOKIE_SECURE?: string;
  /**
   * Hosts that serve the public website at their root, comma-separated
   * ("turquoisestudio.app,www.turquoisestudio.app"; www redirects to the apex).
   * Nothing of the staff app answers on them (routing.ts).
   */
  PUBLIC_SITE_HOSTS?: string;
  /** Web Push: the VAPID public key (base64url; a var, added by the operator at deploy — `npm run vapid-keys`). Push is off without it. */
  VAPID_PUBLIC_KEY?: string;
  /** Secret: the VAPID private key (base64url) that goes with VAPID_PUBLIC_KEY. */
  VAPID_PRIVATE_KEY?: string;
}
