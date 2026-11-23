import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import type { PositionSummary } from './auth';
import { email, id, optEmail, optText, password, reqText, username } from './common';

/** One or more positions; their permissions add up. */
const positionIds = z.array(id).min(1, { message: 'staff:errors.positionRequired' }).max(20);

/**
 * POST /api/staff — add a team member. They sign in with `username` and the
 * first password, which is temporary: at their first sign-in they must choose
 * their own (SessionUser.mustChangePassword).
 * - `username`: what the form asks for. Left out (an older copy of the app,
 *   which sent an email instead), it is made from the email's first part.
 * - `email`: optional. Empty → `<username>@<the emailDomain setting>`.
 * One of the two is needed (else 400 on `username`).
 */
export const staffCreateInput = z.object({
  name: reqText(120),
  username: username.optional(),
  email: optEmail,
  positionIds,
  password,
  phone: optText(50),
  locale: z.enum(LOCALES).optional(),
});
export type StaffCreateInput = z.infer<typeof staffCreateInput>;

/**
 * PATCH /api/staff/:id — `password` here is a manager's reset (the person is
 * signed out everywhere and must choose their own password at the next
 * sign-in); `positionIds` replaces the person's positions; a new `username`
 * takes the email address with it when that was the automatic one
 * (<username>@<emailDomain>) and no `email` is sent.
 */
export const staffUpdateInput = z
  .object({
    name: reqText(120),
    username,
    email,
    positionIds,
    phone: optText(50),
    active: z.boolean(),
    password,
    locale: z.enum(LOCALES),
  })
  .partial();
export type StaffUpdateInput = z.infer<typeof staffUpdateInput>;

export interface StaffMember {
  id: number;
  name: string;
  /** What they sign in with (their email works too). */
  username: string;
  email: string;
  phone: string | null;
  locale: Locale;
  active: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  /** Still on a password someone else set: they will be asked to choose their own at the next sign-in. */
  mustChangePassword: boolean;
  /** Profile photo; set with PUT /api/staff/:id/photo (staff.manage, same reach rules as editing). */
  photoFileId: string | null;
  positions: PositionSummary[];
  /** Holds an owner position. Only owners ever see such accounts. */
  isOwner: boolean;
  /**
   * Whether the caller may edit, deactivate or reset the password of this
   * account: owners always; others only when this person can't do anything
   * the caller can't.
   */
  manageable: boolean;
}

/**
 * GET /api/staff/username-check (staff.manage) — for the add and edit forms,
 * as the manager types:
 * - `username`: is this one valid and free? (`exceptId`: the account being
 *   edited, whose own username is of course "free" for it.)
 * - `name`: a free username to offer for this person's name.
 */
export const usernameCheckQuery = z.object({
  username: z.string().trim().max(60).optional(),
  name: z.string().trim().max(120).optional(),
  exceptId: id.optional(),
});

export interface UsernameCheck {
  /** The username looked at, lower-cased; null when none was sent. */
  username: string | null;
  /**
   * `ok`: valid and free. `invalid`: breaks the rules (shared/usernames.ts).
   * `reserved`: kept for the studio (RESERVED_USERNAMES: admin, postmaster,
   * info…). `taken`: another account has it, or the address that would go
   * with it — never says whose (it may be an owner's, whom the caller can't
   * see). null when no username was sent.
   */
  status: 'ok' | 'invalid' | 'reserved' | 'taken' | null;
  /**
   * For `name`: the first name in Latin letters ("ahmed"); when that is taken,
   * first.last ("ahmed.abdellah"), then a number. null when no name was sent
   * or it has no Latin letters (an Arabic name: the manager types one).
   */
  suggestion: string | null;
  /** The address a new account with this username gets when no email is typed: <username>@<emailDomain>. null without a valid username. */
  automaticEmail: string | null;
}

/**
 * GET /api/staff/directory — every signed-in person may call it. Minimal fields,
 * used for "teacher" pickers and showing who teaches what. Owner accounts are
 * left out for everyone who isn't an owner.
 */
export interface StaffDirectoryEntry {
  id: number;
  name: string;
  active: boolean;
  photoFileId: string | null;
  positions: PositionSummary[];
  /**
   * Holds a coaching position (one that marks attendance for the classes its
   * holder teaches, without seeing every class). Listed first in teacher pickers.
   */
  coach: boolean;
}

/** Error codes (error.code) of the staff API besides the generic ones. */
export const STAFF_ERROR_CODES = {
  /** 409 — you can't change your own positions or deactivate yourself. */
  cannotChangeSelf: 'cannot_change_self',
  /** 409 — this would leave no active account holding an owner position. */
  lastOwner: 'last_owner',
  /** 403 — the change would give or touch access the caller doesn't have. */
  exceedsYourAccess: 'exceeds_your_access',
  /**
   * 403 — only owners may give or take owner positions. (A safety net: to a
   * non-owner owner positions don't exist, so naming one is the same 400
   * staff:errors.positionNotFound as an unknown id.)
   */
  ownerOnly: 'owner_only',
} as const;
