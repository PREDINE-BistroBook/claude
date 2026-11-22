import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import type { Role } from '../roles';
import { email, optText, password, reqText } from './common';

export const loginInput = z.object({
  email,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInput>;

/** First run only: creates the owner account and names the school. */
export const setupInput = z.object({
  schoolName: reqText(120),
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

/** The signed-in staff member, as returned by GET /api/auth/me and POST /api/auth/login. */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  locale: Locale;
}

export interface MeResponse {
  user: SessionUser | null;
  /** True only while no staff account exists yet (first run → /setup). */
  needsSetup: boolean;
  schoolName: string;
}
