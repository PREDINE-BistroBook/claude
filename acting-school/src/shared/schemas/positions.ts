import { z } from 'zod';
import { PERMISSIONS, type Permission } from '../permissions';
import { optText, reqText } from './common';

const positionFields = z.object({
  /** English name (required). */
  name: reqText(80),
  /** Arabic name; the English one is shown when it's empty. */
  nameAr: optText(80),
  /** Owner positions allow every permission. Only owners may set this. Defaults to false on create. */
  isOwner: z.boolean().optional(),
  /** What the position allows (ignored for owner positions, which allow everything). */
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length * 2),
  /** Place in the list; new positions go last when omitted. */
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

/** POST /api/positions */
export const positionInput = positionFields;
export type PositionInput = z.infer<typeof positionInput>;

/** PATCH /api/positions/:id */
export const positionUpdateInput = positionFields.partial();
export type PositionUpdateInput = z.infer<typeof positionUpdateInput>;

/** GET /api/positions → { items: Position[] } (sorted by sortOrder, then name). */
export interface Position {
  id: number;
  /** Set for built-in positions ('ceo', 'acting_coach', …): they can be renamed and changed, not deleted. */
  key: string | null;
  name: string;
  nameAr: string | null;
  isOwner: boolean;
  /** What it allows. Owner positions always list every permission. */
  permissions: Permission[];
  sortOrder: number;
  /** People holding it (that the caller can see). */
  holderCount: number;
  /** The caller may edit (and, unless built-in or in use, delete) it. */
  editable: boolean;
  /** The caller may give it to / take it from staff. */
  assignable: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Error codes (error.code) of the positions API besides the generic ones. */
export const POSITION_ERROR_CODES = {
  /** 409 — someone holds this position; move them to another one first. */
  inUse: 'position_in_use',
  /** 409 — built-in positions can be renamed and changed but not deleted. */
  builtIn: 'position_built_in',
  /** 409 — another position already has this name. */
  nameTaken: 'position_name_taken',
  /** 403 — a non-owner tried to allow something they can't do themselves. */
  exceedsYourAccess: 'exceeds_your_access',
  /** 403 — only owners may create, change or delete owner positions. */
  ownerOnly: 'owner_only',
  /** 409 — this would leave no active account holding an owner position. */
  lastOwner: 'last_owner',
} as const;
