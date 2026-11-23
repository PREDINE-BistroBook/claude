import { z } from 'zod';
import { email, username } from './common';

/**
 * Operator endpoints under /api/admin (routes/admin.ts), for running the app
 * where there's no shell next to the database (Cloudflare). They answer only
 * with `Authorization: Bearer <ADMIN_TOKEN>`; without ADMIN_TOKEN configured
 * they don't exist. Not used by the web app.
 */

/** POST /api/admin/seed-demo: the demo password for every seeded account (never the local demo1234). */
export const seedDemoInput = z.object({
  password: z.string().min(10).max(200),
});
export type SeedDemoInput = z.infer<typeof seedDemoInput>;

export interface SeedDemoResult {
  ok: true;
  /** The seeded sign-ins (all with the password sent): sign in with the username (the email works too). */
  logins: { username: string; email: string; position: string; name: string }[];
  counts: { students: number; classes: number; talent: number; castings: number; enquiries: number };
  seconds: number;
}

/**
 * POST /api/admin/seed-demo-website (no body): the website demo (studio texts,
 * coaches, workshops shown, casting call, links, casting applications, website
 * enquiries) — only while the website is empty (no 'site' settings key and no
 * coaches), else 409. Adds rows only.
 */
export interface SeedDemoWebsiteResult {
  ok: true;
  coaches: number;
  workshops: number;
  applications: number;
  enquiries: number;
}

/**
 * POST /api/admin/grant-owner: lockout recovery, the same as `npm run owner -- <username or email>`.
 * Name the account by `email` or by `username` (one of the two; `username` wins).
 */
export const grantOwnerInput = z.object({ email: email.optional(), username: username.optional() });
export type GrantOwnerInput = z.infer<typeof grantOwnerInput>;

export interface GrantOwnerResponse {
  ok: true;
  username: string;
  email: string;
  name: string;
  /** The owner position given (CEO, or another owner position if CEO is no longer one). */
  position: string;
  reactivated: boolean;
  /** CEO had to be made an owner position again (none was left). */
  restoredOwnerPosition: boolean;
  /** CEO is no longer an owner position, so another one was given. */
  ceoNotOwner: boolean;
}

/** POST /api/admin/reset (only with ALLOW_DEMO_RESET=true): every row and stored file is deleted. */
export interface ResetResult {
  ok: true;
  deletedFiles: number;
}
