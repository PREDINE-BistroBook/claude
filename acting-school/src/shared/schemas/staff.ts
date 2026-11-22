import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import { ROLES, type Role } from '../roles';
import { email, optText, password, reqText } from './common';

export const staffCreateInput = z.object({
  name: reqText(120),
  email,
  role: z.enum(ROLES),
  password,
  phone: optText(50),
  locale: z.enum(LOCALES).optional(),
});
export type StaffCreateInput = z.infer<typeof staffCreateInput>;

/** PATCH /api/staff/:id — `password` here is an admin reset. */
export const staffUpdateInput = z
  .object({
    name: reqText(120),
    email,
    role: z.enum(ROLES),
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
  email: string;
  role: Role;
  phone: string | null;
  locale: Locale;
  active: boolean;
  lastLoginAt: number | null;
  createdAt: number;
}

/**
 * GET /api/staff/directory — every signed-in role may call it. Minimal fields,
 * used for "teacher" pickers and showing who teaches what.
 */
export interface StaffDirectoryEntry {
  id: number;
  name: string;
  role: Role;
  active: boolean;
}
