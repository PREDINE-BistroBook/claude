import { parseDate } from '@shared/dates';
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from '@shared/enums';
import { OPPORTUNITY_DEADLINE_SOON_DAYS, OPPORTUNITY_MAX_FILES } from '@shared/schemas/opportunities';
import { isolate } from '../team/utils';

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

/** The status buttons a card shows, in one row: Interested, Applied, Not for us — all but the one it is in. */
export function statusMoves(status: OpportunityStatus): OpportunityStatus[] {
  return (['interested', 'applied', 'dismissed'] as const).filter((s) => s !== status);
}

/**
 * The status buttons on an opportunity's own page: the card's, plus "Back to
 * New" for one that isn't new any more (a wrong tap can be undone; the API
 * clears who reviewed it).
 */
export function detailStatusMoves(status: OpportunityStatus): OpportunityStatus[] {
  return OPPORTUNITY_STATUSES.filter((s) => s !== status);
}

/**
 * What a card shows besides "Open the post" and the status row, so a card
 * stays short on a phone: "Open the casting" once it has one; "Turn into a
 * casting" only under Interested and Applied (someone has looked at it). The
 * opportunity's own page always offers it.
 */
export function cardCastingButton(o: { status: OpportunityStatus; castingId: number | null }): 'open' | 'turn' | null {
  if (o.castingId !== null) return 'open';
  return o.status === 'interested' || o.status === 'applied' ? 'turn' : null;
}

/** Turning a New opportunity into a casting also moves it to Interested — the confirm says so. */
export function turnMovesToInterested(status: OpportunityStatus): boolean {
  return status === 'new';
}

/** Where "Turn into a casting" lands: the new casting, scrolled to its Roles block (the next thing to fill in). */
export function castingRolesPath(castingId: number): string {
  return `/castings/${castingId}#roles`;
}

/**
 * A link pasted without its scheme — "instagram.com/p/abc123", common in
 * forwarded WhatsApp text — gets "https://" in front, so nobody has to type it
 * on a phone. Anything with a scheme, or that doesn't look like an address
 * (no dot before the path, spaces), is left as typed for the form to judge
 * (the server takes http and https only).
 */
export function normalizeLink(value: string): string {
  const v = value.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (v.startsWith('//')) return `https:${v}`;
  if (/\s/.test(v)) return v;
  const host = v.split(/[/?#]/)[0]!;
  return /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(host) ? `https://${v}` : v;
}

/** "Added by {{name}} · {{date}}": the name isolated, so a Latin name in an Arabic line doesn't pull the date's day number next to it. */
export function addedByArgs(name: string, date: string): { name: string; date: string } {
  return { name: isolate(name), date };
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
