import { z } from 'zod';
import { LOCALES } from '../enums';
import { email, optEmail, reqText, username } from './common';

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

/** How an existing account is named (`keep`, `owner`, grant-owner's `username`): its username or its email address, as at sign-in — looked up, not checked against the rules. */
const accountName = z.string().trim().toLowerCase().pipe(z.string().min(1).max(254));

/**
 * POST /api/admin/grant-owner: lockout recovery, the same as `npm run owner -- <username or email>`.
 * Name the account by `email` or by `username` (one of the two; `username` wins). Check the
 * `name` in the answer: a username names whoever holds it now.
 */
export const grantOwnerInput = z.object({ email: email.optional(), username: accountName.optional() });
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

// ── Clear the demo and create the real team (POST /api/admin/clear-demo) ─────

/** What happens to the public website's content (the 'site' settings object) when the demo is cleared. */
export const KEEP_SITE_CONTENT = ['contact', 'all', 'none'] as const;
export type KeepSiteContent = (typeof KEEP_SITE_CONTENT)[number];

/** At most this many accounts created, and this many kept, in one run. */
export const CLEAR_DEMO_MAX_ACCOUNTS = 50;


/**
 * One account to create. `password` is temporary — the person must choose their
 * own at the first sign-in — so it may be shorter than the password policy
 * ("salma123"). `positions` are built-in position keys ('ceo', 'cfo',
 * 'executive_director', 'head_of_casting', 'casting_team', 'video_editor',
 * 'acting_coach', 'finance'). `email` left out: <username>@<the emailDomain setting>.
 */
export const clearDemoAccountInput = z.strictObject({
  name: reqText(120),
  username,
  password: z.string().min(1).max(200),
  positions: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  locale: z.enum(LOCALES).optional(),
  email: optEmail,
});
export type ClearDemoAccountInput = z.infer<typeof clearDemoAccountInput>;

/**
 * POST /api/admin/clear-demo. Unknown fields are refused (a misspelt `dryRun`
 * must never turn into a real run).
 * - `create`: the accounts to create (may be empty when `keep` isn't).
 * - `keep`: usernames or email addresses of existing accounts that stay (name,
 *   positions, password, language and photo as they are; signed out everywhere).
 *   Left out: every existing account is deleted.
 * - `owner`: the username (or email address) of one account from `create` or
 *   `keep`. After the run it is an active owner: if none of its positions is an
 *   owner position it is given the CEO position.
 * - `keepSiteContent`: 'contact' | 'all' | 'none' — see ClearDemoSiteContent.
 * - `dryRun`: true unless `false` is sent. A dry run changes nothing and
 *   answers the plan and a `confirm` code.
 * - `confirm`: the code of a dry run of this same request, for a real run.
 */
export const clearDemoInput = z.strictObject({
  create: z.array(clearDemoAccountInput).max(CLEAR_DEMO_MAX_ACCOUNTS),
  keep: z.array(accountName).max(CLEAR_DEMO_MAX_ACCOUNTS).optional(),
  owner: accountName,
  keepSiteContent: z.enum(KEEP_SITE_CONTENT),
  dryRun: z.boolean().optional(),
  confirm: z.string().trim().min(1).max(100).optional(),
});
export type ClearDemoInput = z.infer<typeof clearDemoInput>;

/**
 * Error codes of clear-demo, restore-point and restore (`error.code`). A
 * malformed body — a username that breaks the rules included — is the usual
 * 400 `validation` with `issues` (e.g. path ['create', 2, 'username'],
 * message 'errors.usernameInvalid').
 */
export const CLEAR_DEMO_ERROR_CODES = {
  /** 400: a position key in `create[].positions` is no built-in position's key. `details.positions` lists them. */
  unknownPosition: 'unknown_position',
  /** 400: a name in `keep` is nobody's username or email address. `details.names` lists them. */
  unknownAccount: 'unknown_account',
  /** 400: two accounts of `create` and `keep` together would share a username. */
  duplicateUsername: 'duplicate_username',
  /** 400: two accounts of `create` and `keep` together would share an email address (typed or automatic). */
  duplicateEmail: 'duplicate_email',
  /** 400: `owner` names no account of `create` or `keep`. */
  ownerNotListed: 'owner_not_listed',
  /** 400: `create` and `keep` are both empty — nobody could sign in afterwards. */
  noAccounts: 'no_accounts',
  /** 409: the owner needs an owner position and none exists (run grant-owner first). */
  noOwnerPosition: 'no_owner_position',
  /** 400: a real run (`dryRun: false`) without `confirm`. */
  confirmRequired: 'confirm_required',
  /** 409: `confirm` is not the code of a dry run of this request. */
  confirmMismatch: 'confirm_mismatch',
  /** 409: the request is the same but the data changed since that dry run. Run the dry run again. */
  planChanged: 'plan_changed',
  /** 503: the restore point could not be recorded, so nothing was changed. */
  restorePointFailed: 'restore_point_failed',
  /** 501: this runtime has no point-in-time recovery (the Node server, local wrangler dev). */
  notSupported: 'not_supported',
  /** 409: the runtime refused the restore (an unknown bookmark, a time more than 30 days back). `details.reason` has its words. */
  restoreRefused: 'restore_refused',
} as const;

/**
 * Warnings in a dry run's (and the real run's) answer: things to look at twice
 * before sending the real run. They don't stop it — the request is the
 * operator's — and the confirm code covers the request, so a run goes ahead
 * only as it was looked at.
 */
export const CLEAR_DEMO_WARNING_CODES = {
  /** Created accounts share one temporary password: whoever signs in first with it can take any of them (`owner: true` when an owner's account is one). */
  sharedPassword: 'shared_password',
  /** A created account takes the username or email of an account that is deleted (it belongs under `keep` if that person should keep it). */
  replacesAccount: 'replaces_account',
} as const;

export type ClearDemoWarning =
  | { code: typeof CLEAR_DEMO_WARNING_CODES.sharedPassword; usernames: string[]; owner: boolean; message: string }
  | { code: typeof CLEAR_DEMO_WARNING_CODES.replacesAccount; username: string; replaces: { id: number; username: string; name: string }; message: string };

/** An account a run deletes, as it is before the run. */
export interface ClearDemoDeletedAccount {
  id: number;
  username: string;
  email: string;
  name: string;
  active: boolean;
  /** Holds an owner position now. */
  owner: boolean;
}

/** An account as it is after the run. */
export interface ClearDemoAccount {
  /** null for an account a dry run would create. */
  id: number | null;
  username: string;
  email: string;
  name: string;
  /** Its positions after the run (`key` is null for a position the school made itself). */
  positions: { key: string | null; name: string }[];
  /** Holds an owner position after the run. */
  owner: boolean;
  active: boolean;
  status: 'created' | 'kept';
}

/**
 * What happens to the website's content object (settings key 'site'):
 * - 'contact': the tagline, about text, address, map link, WhatsApp lines,
 *   phone, email and Instagram stay; the custom links, the main photo and the
 *   casting call's texts go, the casting call is closed and the website is
 *   not public.
 * - 'all': the object stays exactly as it is (links, main photo, casting call
 *   and the "Website is public" switch included).
 * - 'none': the object is removed: empty texts, nothing public.
 * In every mode the coaches and the workshops shown go with the records they
 * were about (their counts are under site_coaches / site_workshops).
 */
export interface ClearDemoSiteContent {
  mode: KeepSiteContent;
  /** "Website is public" after the run. */
  published: boolean;
  /** The casting call's switch after the run. */
  castingCallOpen: boolean;
  /** The texts and contact lines that still have a value after the run. */
  kept: string[];
  links: { kept: number; removed: number };
  mainPhoto: 'kept' | 'removed' | 'none';
}

/** Rows per table, by the table's SQL name ('students', 'class_sessions', … 'users', 'files'). */
export type ClearDemoCounts = Record<string, number>;

/**
 * Where a real run can be taken back to:
 * - Cloudflare: the Durable Object's point-in-time-recovery bookmark, taken
 *   just before the run — POST /api/admin/restore { bookmark } within 30 days;
 * - Node: a copy of the database file, made just before the run (stop the
 *   server and put it back by hand).
 */
export type RestorePoint = { kind: 'bookmark'; bookmark: string; at: number } | { kind: 'file'; file: string; at: number };

interface ClearDemoPlan {
  /**
   * The code a real run of this same request must send as `confirm`. It
   * covers the request and the plan (the accounts afterwards, the ids of the
   * accounts that go, the counts, the website content) — not the sign-in
   * sessions, sign-in brakes, rate-limit counters and phone-alert
   * subscriptions, which change whenever someone signs in. It works once:
   * after a run, the same request plans to delete the accounts that run
   * created, which have new ids (409 `plan_changed`).
   */
  confirm: string;
  /** Every account that exists after the run: the kept ones, then the created ones. */
  accounts: ClearDemoAccount[];
  /** Look at these twice before the real run (CLEAR_DEMO_WARNING_CODES); [] when there is nothing to say. */
  warnings: ClearDemoWarning[];
  siteContent: ClearDemoSiteContent;
}

export type ClearDemoResult =
  | (ClearDemoPlan & { dryRun: true; /** Every account the run would delete, by id. */ willDeleteAccounts: ClearDemoDeletedAccount[]; willDelete: ClearDemoCounts })
  | (ClearDemoPlan & {
      dryRun: false;
      /** Every account the run deleted, as it was. */
      deletedAccounts: ClearDemoDeletedAccount[];
      deleted: ClearDemoCounts;
      /** null where the runtime has none to offer (local wrangler dev). */
      restorePoint: RestorePoint | null;
    });

// ── Restore points (Cloudflare) ─────────────────────────────────────────────

/** GET /api/admin/restore-point: a bookmark for the database as it is right now. */
export interface RestorePointResponse {
  bookmark: string;
  /** Epoch ms. */
  at: number;
}

/** 30 days in minutes: how far back point-in-time recovery reaches. */
export const RESTORE_MAX_MINUTES_AGO = 30 * 24 * 60;

/**
 * POST /api/admin/restore: take the whole database back — to a bookmark, or
 * to how it was `minutesAgo` minutes ago. One of the two.
 */
export const restoreInput = z
  .strictObject({
    bookmark: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .regex(/^[0-9A-Za-z_-]+$/)
      .optional(),
    minutesAgo: z.number().int().min(1).max(RESTORE_MAX_MINUTES_AGO).optional(),
  })
  .refine((v) => (v.bookmark === undefined) !== (v.minutesAgo === undefined), { message: 'errors.required', path: ['bookmark'] });
export type RestoreInput = z.infer<typeof restoreInput>;

/** 202: the database goes back to `restoringTo` as the object restarts (within a second). */
export interface RestoreResponse {
  restoringTo: string;
  /** Restore to this one to undo the restore: the database as it was just before it. */
  undoBookmark: string;
}
