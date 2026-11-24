import { DEFAULT_TIME_ZONE, isValidTimeZone } from './lib/clock';
import { parseVapidKeys, type VapidKeys } from './lib/push/keys';

/**
 * Settings the API needs on either runtime. Built from process.env on the Node
 * server (nodeConfig.ts) and from the Worker's vars/secrets on Cloudflare
 * (src/worker/) — both through configFromVars, so a variable means the same
 * thing everywhere.
 */
export interface AppConfig {
  /** Send the session cookie with `Secure` (on behind HTTPS). */
  cookieSecure: boolean;
  sessionDays: number;
  isProduction: boolean;
  /** IANA time zone of the school: the server's "today" and "now" (lib/clock.ts). SCHOOL_TIME_ZONE, default Africa/Cairo. */
  timeZone: string;
  /** Bearer token for /api/admin/* (ADMIN_TOKEN). null: those routes don't exist (404 like any unknown route). */
  adminToken: string | null;
  /** POST /api/admin/reset may wipe the data (ALLOW_DEMO_RESET=true; demo deployments only). */
  allowDemoReset: boolean;
  /**
   * First-run setup (POST /api/auth/setup) asks for the setup code — the
   * ADMIN_TOKEN — so nobody else can claim an empty school. Always on
   * Cloudflare, where the Worker is public on the internet from the first
   * deploy (and again after a demo reset); on Node with REQUIRE_SETUP_CODE=true.
   * Without an ADMIN_TOKEN, setup is then impossible until one is set.
   */
  requireSetupCode: boolean;
  /**
   * Hosts that serve the public website at their root (PUBLIC_SITE_HOSTS,
   * comma-separated, e.g. "turquoisestudio.app,www.turquoisestudio.app"):
   * lower case, no port. On those hosts the Worker (and the Node server) maps
   * /x to the app's /site/x and nothing of the staff app answers; the site's
   * links are bare paths there (src/server/site/paths.ts). Empty: the site is
   * only at /site on every host.
   */
  publicSiteHosts: string[];
  /**
   * Web Push (lib/push/): the VAPID key pair — VAPID_PUBLIC_KEY (a var on
   * Cloudflare, env on Node) and VAPID_PRIVATE_KEY (a secret), both base64url
   * as `npm run vapid-keys` prints them. null (either missing or invalid): push
   * is off; the in-app notification bell still works.
   */
  vapid: VapidKeys | null;
}

/** Shortest ADMIN_TOKEN accepted; a shorter one is ignored (admin routes stay off) so a weak token can't be guessed. */
export const MIN_ADMIN_TOKEN_LENGTH = 24;

export type ConfigVars = Record<string, string | undefined>;

export interface RuntimeDefaults {
  cookieSecure: boolean;
  isProduction: boolean;
  requireSetupCode: boolean;
}

/** What Cloudflare implies (src/worker/school.ts): always HTTPS, and public on the internet from the first deploy. */
export const CLOUDFLARE_DEFAULTS: RuntimeDefaults = { cookieSecure: true, isProduction: true, requireSetupCode: true };

/**
 * AppConfig from string variables. `defaults` are what the runtime implies
 * when a variable is unset (Cloudflare always serves HTTPS, so cookies are
 * Secure there by default; the Node server only in production; setup needs
 * the setup code on Cloudflare).
 */
export function configFromVars(vars: ConfigVars, defaults: RuntimeDefaults): AppConfig {
  let timeZone = vars.SCHOOL_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    console.error(`SCHOOL_TIME_ZONE "${timeZone}" is not a time zone this runtime knows; using ${DEFAULT_TIME_ZONE}.`);
    timeZone = DEFAULT_TIME_ZONE;
  }
  const token = vars.ADMIN_TOKEN?.trim() || null;
  if (token && token.length < MIN_ADMIN_TOKEN_LENGTH) {
    // Never print the token itself.
    console.error(`ADMIN_TOKEN is shorter than ${MIN_ADMIN_TOKEN_LENGTH} characters, so the admin routes stay off.`);
  }
  const sessionDays = Number(vars.SESSION_DAYS ?? 30);
  const vapidPublic = vars.VAPID_PUBLIC_KEY?.trim() || null;
  const vapidPrivate = vars.VAPID_PRIVATE_KEY?.trim() || null;
  const vapid = vapidPublic && vapidPrivate ? parseVapidKeys(vapidPublic, vapidPrivate) : null;
  if ((vapidPublic || vapidPrivate) && !vapid) {
    // Never print the private key itself.
    console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are missing one half or are not a P-256 key pair (base64url), so push notifications stay off.');
  }
  return {
    // COOKIE_SECURE=false only to try a production build over plain http on a private network.
    cookieSecure: vars.COOKIE_SECURE ? vars.COOKIE_SECURE === 'true' : defaults.cookieSecure,
    sessionDays: Number.isFinite(sessionDays) && sessionDays > 0 ? sessionDays : 30,
    isProduction: defaults.isProduction,
    timeZone,
    adminToken: token && token.length >= MIN_ADMIN_TOKEN_LENGTH ? token : null,
    allowDemoReset: vars.ALLOW_DEMO_RESET === 'true',
    // Can be switched on, never off where the runtime requires it (Cloudflare).
    requireSetupCode: defaults.requireSetupCode || vars.REQUIRE_SETUP_CODE === 'true',
    publicSiteHosts: parsePublicSiteHosts(vars.PUBLIC_SITE_HOSTS),
    vapid,
  };
}

/** "turquoisestudio.app, WWW.turquoisestudio.app:443" → ["turquoisestudio.app", "www.turquoisestudio.app"]: lower case, no port, no blanks or repeats. */
export function parsePublicSiteHosts(value: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (value ?? '').split(',')) {
    const host = part.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').replace(/\.$/, '');
    if (host && /^[a-z0-9.-]+$/.test(host) && !out.includes(host)) out.push(host);
  }
  return out;
}

/** A complete config for tests and scripts: development defaults plus `overrides`. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    cookieSecure: false,
    sessionDays: 30,
    isProduction: false,
    timeZone: DEFAULT_TIME_ZONE,
    adminToken: null,
    allowDemoReset: false,
    requireSetupCode: false,
    publicSiteHosts: [],
    vapid: null,
    ...overrides,
  };
}
