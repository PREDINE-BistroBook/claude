import { z } from 'zod';
import { SUMMONS_ANSWERS, SUMMONS_VIEW_STATUSES, type SummonsViewStatus } from '../enums';
import { id } from './common';
import type { PersonRef } from './team';

/**
 * "Call to the office" (/api/summons). Calling needs staff.summon (the CEO, CFO
 * and Executive Directors as built in); answering and cancelling need only to
 * be the person called / the caller. One pending summons per caller and
 * person at a time, at most 20 an hour per caller; a pending one older than
 * two hours shows as 'expired' (SUMMONS_EXPIRY_MS in shared/enums.ts).
 */

export const MAX_SUMMONS_NOTE = 200;
/** Summonses a caller may send per hour (429 too_many_summons beyond). */
export const SUMMONS_PER_HOUR = 20;
/** GET /api/summons/sent looks back this far (24 hours). */
export const SUMMONS_SENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** POST /api/summons. */
export const summonsInput = z.object({
  userId: id,
  note: z.preprocess((v) => (typeof v === 'string' ? v.trim() || null : v), z.string().max(MAX_SUMMONS_NOTE).nullable().optional()),
});
export type SummonsInput = z.infer<typeof summonsInput>;

/** POST /api/summons/:id/answer. */
export const summonsAnswerInput = z.object({ status: z.enum(SUMMONS_ANSWERS) });
export type SummonsAnswerInput = z.infer<typeof summonsAnswerInput>;

/** GET /api/summons/sent?status= (optional; 'expired' = pending past its time). */
export const summonsSentQuery = z.object({ status: z.enum(SUMMONS_VIEW_STATUSES).optional() });
export type SummonsSentQuery = z.infer<typeof summonsSentQuery>;

/** A summons as every summons endpoint answers it (POST 201, answer, cancel, incoming, sent, /api/chat/unread). */
export interface SummonsView {
  id: number;
  /** Who is calling (name and photo, owners included). */
  from: PersonRef;
  /** Who is called. */
  to: PersonRef;
  note: string | null;
  /** 'expired': still pending in the database but older than two hours. */
  status: SummonsViewStatus;
  createdAt: number;
  /** When the person answered (on_my_way / cant_now), else null. */
  answeredAt: number | null;
  /** Epoch ms after which a pending summons counts as expired (createdAt + 2 h). */
  expiresAt: number;
}

/** Error codes (error.code) of the summons API besides the generic ones. */
export const SUMMONS_ERROR_CODES = {
  /** 400 — calling yourself. */
  cannotSummonSelf: 'cannot_summon_self',
  /** 409 — a pending summons from you to this person already exists; error.details: { summons: SummonsView }. */
  alreadyPending: 'already_pending',
  /** 429 — over 20 summonses in an hour. */
  tooManySummons: 'too_many_summons',
  /** 409 — answering or cancelling one that is no longer pending (answered, cancelled or expired); error.details: { summons: SummonsView }. */
  notPending: 'not_pending',
} as const;
