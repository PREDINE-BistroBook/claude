import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import type { Permission } from '../permissions';
import { email, optText, password, reqText, username } from './common';

/** What someone types in the sign-in field — a username or an email address — trimmed and lower-cased. Not checked against either's rules: a wrong one is just "incorrect". */
const signInName = z.string().trim().toLowerCase().pipe(z.string().min(1).max(254));

/**
 * POST /api/auth/login. `username` is the one sign-in field: the person's
 * username **or** their email address (it is an email when it has an "@").
 * `email` is that field's old name, still read so an installed app that hasn't
 * updated yet can sign in; send one of the two (`username` wins).
 */
export const loginInput = z.object({
  username: signInName.optional(),
  email: signInName.optional(),
  /** Any length: a temporary first password set by the operator may be shorter than the policy. */
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

/** The typed sign-in name of a login request (lower-case), or null when neither field was sent. */
export function signInNameOf(input: LoginInput): string | null {
  return input.username ?? input.email ?? null;
}

/** First run only: creates the owner account and names the school. */
export const setupInput = z.object({
  schoolName: reqText(120),
  /** Optional Arabic name (see settings.schoolNameAr). */
  schoolNameAr: optText(80),
  name: reqText(120),
  /** The owner's username; left out, it is made from the email's first part. */
  username: username.optional(),
  email,
  password,
  locale: z.enum(LOCALES).optional(),
  /** Asked for only where MeResponse.setupCodeRequired (Cloudflare): the ADMIN_TOKEN, from whoever deployed the app. */
  setupCode: z.string().trim().max(200).optional(),
});
export type SetupInput = z.infer<typeof setupInput>;

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

/**
 * POST /api/auth/choose-password — only while SessionUser.mustChangePassword:
 * the person replaces the temporary password someone else gave them. The new
 * one meets the normal policy and must not be the temporary one again.
 */
export const choosePasswordInput = z.object({
  newPassword: password,
});
export type ChoosePasswordInput = z.infer<typeof choosePasswordInput>;

/** The "Choose your own password" screen: the new password typed twice. Only `newPassword` is sent. */
export const choosePasswordForm = z
  .object({
    newPassword: password,
    repeatPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.repeatPassword !== v.newPassword) ctx.addIssue({ code: 'custom', path: ['repeatPassword'], message: 'errors.passwordsDontMatch' });
  });

/** Error codes (error.code) of the auth API besides the generic ones. */
export const AUTH_ERROR_CODES = {
  /**
   * 403 from every API route outside /api/auth while SessionUser.mustChangePassword:
   * the person signed in with a temporary password and has to choose their own first.
   */
  passwordChangeRequired: 'password_change_required',
  /** 409 from POST /api/auth/choose-password when the account has no temporary password (use POST /api/auth/password). */
  passwordChangeNotRequired: 'password_change_not_required',
  /** 409 — another account has this username (or the address that goes with it). Never says whose. Issue on `username`. */
  usernameTaken: 'username_taken',
} as const;

/** What a signed-in person may change about themselves. */
export const profileInput = z
  .object({
    name: reqText(120),
    phone: optText(50),
    locale: z.enum(LOCALES),
    /**
     * Your own username (the same rules and uniqueness check as everywhere).
     * An email address that was the automatic one (<username>@<emailDomain>) follows it.
     */
    username,
  })
  .partial();

/** A position as shown next to a person (staff list, profile, directory). */
export interface PositionSummary {
  id: number;
  /** Built-in positions only ('ceo', 'acting_coach', …). */
  key: string | null;
  name: string;
  /** Arabic name; show `name` when null. */
  nameAr: string | null;
  isOwner: boolean;
}

/**
 * The signed-in staff member, as returned by GET /api/auth/me and POST /api/auth/login.
 * Positions and permissions are worked out on every request, so a change applies
 * on the person's next request.
 */
export interface SessionUser {
  id: number;
  /** What they sign in with (their email works too). Change it with PATCH /api/auth/profile. */
  username: string;
  email: string;
  name: string;
  phone: string | null;
  locale: Locale;
  /** Profile photo (GET /api/files/:id); change it with PUT /api/auth/photo. */
  photoFileId: string | null;
  /** Sorted like the positions list (sortOrder, then name). */
  positions: PositionSummary[];
  /** Holds at least one owner position (CEO, CFO): every permission, sees owner accounts. */
  isOwner: boolean;
  /** Effective permissions: everything the positions add up to (owners: all). */
  permissions: Permission[];
  /**
   * Their password was set by someone else (a manager adding them or resetting
   * it, the operator) and they haven't chosen their own yet. Until they do —
   * POST /api/auth/choose-password — the app shows only that screen and every
   * API route outside /api/auth answers 403 `password_change_required`.
   */
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: SessionUser | null;
  /** True only while no staff account exists yet (first run → /setup). */
  needsSetup: boolean;
  /** Setup asks for the setup code (SetupInput.setupCode); only while needsSetup. */
  setupCodeRequired: boolean;
  schoolName: string;
  /** Arabic name; show `schoolName` when null. */
  schoolNameAr: string | null;
}
