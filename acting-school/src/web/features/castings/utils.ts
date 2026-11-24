import { ageOn, parseDate, todayISO } from '@shared/dates';
import type { CastingStatus, SubmissionStatus } from '@shared/enums';
import type { CastingRole } from '@shared/schemas/castings';
import type { TalentListItem } from '@shared/schemas/talent';
import { STATUS_TONES, type Tone } from '@web/components/ui';

const DAY = 86_400_000;

/** Whole days from `today` to `date` (negative when past). Both "YYYY-MM-DD". */
export function daysUntil(date: string, today: string = todayISO()): number {
  // Math.round absorbs the hour a DST change adds or removes.
  return Math.round((parseDate(date).getTime() - parseDate(today).getTime()) / DAY);
}

export type DeadlineState = { kind: 'passed' } | { kind: 'soon'; days: number } | null;

/** Open castings whose deadline is past, or 3 days away or less, deserve a warning. */
export function deadlineState(c: { status: CastingStatus; submissionDeadline: string | null }, today: string = todayISO()): DeadlineState {
  if (c.status !== 'open' || !c.submissionDeadline) return null;
  const days = daysUntil(c.submissionDeadline, today);
  if (days < 0) return { kind: 'passed' };
  if (days <= 3) return { kind: 'soon', days };
  return null;
}

/** Badge tones for submission statuses — StatusBadge's own mapping, for count badges StatusBadge can't draw. */
export const SUBMISSION_TONES: Record<SubmissionStatus, Tone> = STATUS_TONES.submissionStatus;

/** Statuses that end a talent's journey on a role ("booked" is the happy ending of the pipeline). */
export const FINAL_STATUSES: readonly SubmissionStatus[] = ['rejected', 'withdrawn'];

/** "YYYY-MM-DDTHH:MM" → the two inputs of the audition picker. */
export function splitAudition(at: string | null): { date: string; time: string } {
  if (!at) return { date: '', time: '' };
  return { date: at.slice(0, 10), time: at.slice(11, 16) };
}

/** Two inputs → "YYYY-MM-DDTHH:MM", null when both are empty, 'incomplete' when only one is set. */
export function joinAudition(date: string, time: string): string | null | 'incomplete' {
  if (!date && !time) return null;
  if (!date || !time) return 'incomplete';
  return `${date}T${time}`;
}

/**
 * Ages a talent can play: their playing-age range (a missing end is open), or —
 * with no range — their actual age ±1 (the same rule the talent API's ?age= uses).
 * null when nothing is known.
 */
export function playableSpan(t: Pick<TalentListItem, 'playingAgeMin' | 'playingAgeMax' | 'dateOfBirth'>, today: string = todayISO()): [number, number] | null {
  if (t.playingAgeMin != null || t.playingAgeMax != null) return [t.playingAgeMin ?? 0, t.playingAgeMax ?? 150];
  const age = ageOn(t.dateOfBirth, today);
  return age === null ? null : [age - 1, age + 1];
}

export function roleHasRequirements(role: Pick<CastingRole, 'gender' | 'ageMin' | 'ageMax'>): boolean {
  return !!role.gender || role.ageMin != null || role.ageMax != null;
}

/** Does the talent fit the role's gender and age range? Unknown gender/age doesn't fit a role that asks for one. */
export function matchesRole(
  t: Pick<TalentListItem, 'gender' | 'playingAgeMin' | 'playingAgeMax' | 'dateOfBirth'>,
  role: Pick<CastingRole, 'gender' | 'ageMin' | 'ageMax'>,
  today: string = todayISO(),
): boolean {
  if (role.gender && t.gender !== role.gender) return false;
  if (role.ageMin == null && role.ageMax == null) return true;
  const span = playableSpan(t, today);
  if (!span) return false;
  return span[0] <= (role.ageMax ?? 150) && span[1] >= (role.ageMin ?? 0);
}

/** "tel:" wants digits and a leading +, nothing else. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * Wrap user data interpolated into a sentence in Unicode isolates (FSI…PDI), so a
 * Latin name inside an Arabic sentence (or the reverse) doesn't reorder the
 * punctuation around it — e.g. the quotes in «Amal (lead)».
 */
export const isolate = (s: string) => `\u2068${s}\u2069`;
