import { z } from 'zod';
import { OPPORTUNITY_PROJECT_TYPES, OPPORTUNITY_STATUSES, type OpportunityProjectType, type OpportunityStatus } from '../enums';
import { optDate, optEnum, optText, reqText } from './common';
import type { PersonRef } from './team';

/**
 * Casting opportunities (Part K1, Casting › Opportunities): what the team saw
 * on Instagram, Facebook, a WhatsApp group or a website, added by hand — no AI,
 * nothing fetched. castings.read sees the list; castings.write adds, edits,
 * moves, deletes and turns one into a casting. API: /api/opportunities.
 */

/** Screenshots or photos of the post, per opportunity. */
export const OPPORTUNITY_MAX_FILES = 3;
/** A deadline this many days away or closer is shown in red. */
export const OPPORTUNITY_DEADLINE_SOON_DAYS = 3;

/** Error codes (error.code) of /api/opportunities. */
export const OPPORTUNITY_ERROR_CODES = {
  /** 409 (POST /:id/to-casting) — it already has its casting (details.castingId says which). */
  alreadyCasting: 'already_casting',
} as const;

/** The post's address: http or https only (never javascript:, data:, …), ≤ 1000 characters. */
const optLink = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || null : v),
  z.url({ protocol: /^https?$/, message: 'errors.invalidUrl' }).max(1000).nullable().optional(),
);

const opportunityFields = z.object({
  title: reqText(200),
  /** Notes: what the post says. */
  details: optText(5000),
  projectType: optEnum(OPPORTUNITY_PROJECT_TYPES),
  roles: optText(1000),
  location: optText(200),
  deadline: optDate,
  contact: optText(300),
  link: optLink,
  /** Where it was seen, e.g. "Instagram — Frame Casting". */
  source: optText(120),
  asksForPayment: z.boolean().optional(),
  involvesMinors: z.boolean().optional(),
  /** Defaults to 'new' on create. */
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  /**
   * The screenshots, in order (≤ OPPORTUNITY_MAX_FILES): on create, images you
   * uploaded in the last hour (POST /api/files) that aren't used anywhere yet;
   * on PATCH, the full new list — ids already on this opportunity stay, new
   * ones follow the create rule, the missing ones are removed.
   */
  fileIds: z.array(z.uuid()).max(OPPORTUNITY_MAX_FILES, { message: 'opportunities:errors.tooManyFiles' }).optional(),
});

/** POST /api/opportunities — only the title is required. */
export const opportunityInput = opportunityFields;
export type OpportunityInput = z.infer<typeof opportunityInput>;
/** PATCH /api/opportunities/:id — what it names. */
export const opportunityUpdateInput = opportunityFields.partial();
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateInput>;

export const opportunityListQuery = z.object({
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});

/** A screenshot of the post: an image, shown through GET /api/files/:fileId. */
export interface OpportunityFile {
  id: number;
  fileId: string;
  mime: string;
  name: string | null;
}

/** GET /api/opportunities → { items }, GET /api/opportunities/:id, and what create / patch answer. */
export interface Opportunity {
  id: number;
  title: string;
  details: string | null;
  projectType: OpportunityProjectType | null;
  roles: string | null;
  location: string | null;
  deadline: string | null;
  contact: string | null;
  link: string | null;
  source: string | null;
  asksForPayment: boolean;
  involvesMinors: boolean;
  status: OpportunityStatus;
  /** The casting made from it, while that casting exists. */
  castingId: number | null;
  files: OpportunityFile[];
  createdBy: PersonRef | null;
  reviewedBy: PersonRef | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/opportunities/counts — numbers for the tabs (and the Casting menu's badge: `new`). */
export type OpportunityCounts = Record<OpportunityStatus, number>;

/** POST /api/opportunities/:id/to-casting (201). */
export interface OpportunityToCastingResult {
  castingId: number;
}
