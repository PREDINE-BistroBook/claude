import { z } from 'zod';
import { LOCALES, type Locale } from '../enums';
import type { PositionSummary } from './auth';
import { email, id, optText, password, reqText } from './common';

/** One or more positions; their permissions add up. */
const positionIds = z.array(id).min(1, { message: 'staff:errors.positionRequired' }).max(20);

export const staffCreateInput = z.object({
  name: reqText(120),
  email,
  positionIds,
  password,
  phone: optText(50),
  locale: z.enum(LOCALES).optional(),
});
export type StaffCreateInput = z.infer<typeof staffCreateInput>;

/** PATCH /api/staff/:id — `password` here is an admin reset; `positionIds` replaces the person's positions. */
export const staffUpdateInput = z
  .object({
    name: reqText(120),
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
  email: string;
  phone: string | null;
  locale: Locale;
  active: boolean;
  lastLoginAt: number | null;
  createdAt: number;
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
 * GET /api/staff/directory — every signed-in person may call it. Minimal fields,
 * used for "teacher" pickers and showing who teaches what. Owner accounts are
 * left out for everyone who isn't an owner.
 */
export interface StaffDirectoryEntry {
  id: number;
  name: string;
  active: boolean;
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
  /** 403 — only owners may give or take owner positions. */
  ownerOnly: 'owner_only',
} as const;
