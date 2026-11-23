import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import type { Permission } from '../permissions';
import { email, optText, password, reqText } from './common';

export const loginInput = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

/** First run only: creates the owner account and names the school. */
export const setupInput = z.object({
  schoolName: reqText(120),
  /** Optional Arabic name (see settings.schoolNameAr). */
  schoolNameAr: optText(80),
  name: reqText(120),
  email,
  password,
  locale: z.enum(LOCALES).optional(),
});
export type SetupInput = z.infer<typeof setupInput>;

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

/** What a signed-in person may change about themselves. */
export const profileInput = z
  .object({
    name: reqText(120),
    phone: optText(50),
    locale: z.enum(LOCALES),
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
  email: string;
  name: string;
  phone: string | null;
  locale: Locale;
  /** Sorted like the positions list (sortOrder, then name). */
  positions: PositionSummary[];
  /** Holds at least one owner position (CEO, CFO): every permission, sees owner accounts. */
  isOwner: boolean;
  /** Effective permissions: everything the positions add up to (owners: all). */
  permissions: Permission[];
}

export interface MeResponse {
  user: SessionUser | null;
  /** True only while no staff account exists yet (first run → /setup). */
  needsSetup: boolean;
  schoolName: string;
  /** Arabic name; show `schoolName` when null. */
  schoolNameAr: string | null;
}
