import { parseDate } from '@shared/dates';
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from '@shared/enums';
import { OPPORTUNITY_DEADLINE_SOON_DAYS, OPPORTUNITY_MAX_FILES } from '@shared/schemas/opportunities';

/** Casting › Opportunities (Part K1): the screen's plain logic, unit-tested in tests/unit/opportunities-web.test.ts. */

/** The tabs, in order: New / Interested / Applied / Not for us. */
export const OPPORTUNITY_TABS: readonly OpportunityStatus[] = OPPORTUNITY_STATUSES;

/** ?status= → the tab; nothing or anything unknown is New (what needs a look). */
export function parseOpportunityStatus(value: string | null): OpportunityStatus {
  return value && (OPPORTUNITY_STATUSES as readonly string[]).includes(value) ? (value as OpportunityStatus) : 'new';
}

export type DeadlineLook =
  | { kind: 'none' }
  /** The deadline has passed: "Closed". */
  | { kind: 'closed' }
  /** Today … in OPPORTUNITY_DEADLINE_SOON_DAYS days: in red. */
  | { kind: 'soon'; days: number }
  | { kind: 'open'; days: number };

/** Whole days from `today` to `date` (both YYYY-MM-DD, the phone's own calendar). */
export function daysUntil(date: string, today: string): number {
  return Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / 86_400_000);
}

/** How a deadline shows on a card: red within three days (today included), "Closed" once it has passed. */
export function deadlineLook(deadline: string | null, today: string): DeadlineLook {
  if (!deadline) return { kind: 'none' };
  const days = daysUntil(deadline, today);
  if (days < 0) return { kind: 'closed' };
  return days <= OPPORTUNITY_DEADLINE_SOON_DAYS ? { kind: 'soon', days } : { kind: 'open', days };
}

/** The status buttons a card shows: Interested, Applied, Not for us — all but the one it is in. */
export function statusMoves(status: OpportunityStatus): OpportunityStatus[] {
  return (['interested', 'applied', 'dismissed'] as const).filter((s) => s !== status);
}

/** "instagram.com" for a post's address (shown next to "Open the post"); null when it isn't a web address. */
export function linkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** How many more screenshots may be added (at most OPPORTUNITY_MAX_FILES in all). */
export function screenshotRoom(count: number): number {
  return Math.max(0, OPPORTUNITY_MAX_FILES - count);
}
