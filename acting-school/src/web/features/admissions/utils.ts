import { addDays } from '@shared/dates';
import { LEAD_SOURCES, LEAD_STATUSES, isClosedLeadStatus, type LeadSource, type LeadStatus } from '@shared/enums';
import type { Interview, LeadGroup } from '@shared/schemas/admissions';
import type { InterviewCriterion } from '@shared/schemas/settings';

// ── List tabs ───────────────────────────────────────────────────────────────

/** Tabs on /admissions (?tab=), in display order. */
export const LEAD_TABS = ['follow_up', 'new', 'interviews', 'open', 'closed'] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

export function parseTab(value: string | null): LeadTab {
  return (LEAD_TABS as readonly string[]).includes(value ?? '') ? (value as LeadTab) : 'follow_up';
}

/** What each tab asks the API for. */
export function tabFilter(tab: LeadTab): { group?: LeadGroup; status?: LeadStatus } {
  switch (tab) {
    case 'follow_up':
      return { group: 'follow_up_due' };
    case 'new':
      return { status: 'new' };
    case 'interviews':
      return { group: 'interviews' };
    case 'open':
      return { group: 'open' };
    case 'closed':
      return { group: 'closed' };
  }
}

/** Which LeadCounts field belongs to a tab. */
export const TAB_COUNT = { follow_up: 'followUpDue', new: 'new', interviews: 'interviews', open: 'open', closed: 'closed' } as const;

export function parseSource(value: string | null): LeadSource | undefined {
  return (LEAD_SOURCES as readonly string[]).includes(value ?? '') ? (value as LeadSource) : undefined;
}

// ── Follow-ups ──────────────────────────────────────────────────────────────

/** Quick choices offered next to the follow-up date. */
export function followUpChoices(today: string): { key: 'tomorrow' | 'in3Days' | 'nextWeek'; date: string }[] {
  return [
    { key: 'tomorrow', date: addDays(today, 1) },
    { key: 'in3Days', date: addDays(today, 3) },
    { key: 'nextWeek', date: addDays(today, 7) },
  ];
}

/** Overdue → danger, due today → warning, later → neutral. */
export function followUpTone(date: string, today: string): 'danger' | 'warning' | 'neutral' {
  return date < today ? 'danger' : date === today ? 'warning' : 'neutral';
}

// ── Status rules (mirror the server's, so the UI never offers a refused action) ──

/**
 * Statuses a person may set by hand on a lead in `current` status: never
 * 'enrolled' (only through the enrol action) and nothing at all once enrolled;
 * 'accepted'/'declined' only with admissions.decide. 'lost' also needs a reason.
 */
export function manualStatusOptions(current: LeadStatus, canDecide: boolean): LeadStatus[] {
  if (current === 'enrolled') return [];
  return LEAD_STATUSES.filter((s) => s !== current && s !== 'enrolled' && (canDecide || (s !== 'accepted' && s !== 'declined')));
}

/** Lost and declined leads can be reopened (back to contacted); enrolled is final. */
export const canReopen = (status: LeadStatus) => status === 'lost' || status === 'declined';

/** Interviews can be scheduled on open leads only (reopen a lost/declined lead first). */
export const canScheduleInterview = (status: LeadStatus) => !isClosedLeadStatus(status);

/** Statuses that scheduling an interview moves to interview_scheduled; an accepted lead keeps its decision (as the server). */
const MOVES_TO_INTERVIEW_SCHEDULED: readonly LeadStatus[] = ['new', 'contacted', 'interviewed'];

/** The lead's status once an interview is scheduled (or a cancelled one is put back). */
export function statusAfterScheduling(status: LeadStatus): LeadStatus {
  return MOVES_TO_INTERVIEW_SCHEDULED.includes(status) ? 'interview_scheduled' : status;
}

/**
 * The lead's status once this scheduled interview is cancelled or missed (as
 * the server): only a lead in 'interview_scheduled' with no other interview
 * still scheduled moves — back to 'interviewed' when an earlier interview was
 * assessed, else to 'contacted'. Any other status (e.g. accepted) stays.
 */
export function statusAfterInterviewEnds(lead: { status: LeadStatus; interviews: readonly Pick<Interview, 'id' | 'status'>[] }, interviewId: number): LeadStatus {
  if (lead.status !== 'interview_scheduled') return lead.status;
  const others = lead.interviews.filter((i) => i.id !== interviewId);
  if (others.some((i) => i.status === 'scheduled')) return lead.status;
  return others.some((i) => i.status === 'done') ? 'interviewed' : 'contacted';
}

// ── Interviews ──────────────────────────────────────────────────────────────

/** The soonest interview still scheduled. */
export function nextScheduledInterview(interviews: readonly Interview[]): Interview | null {
  return interviews.filter((i) => i.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0] ?? null;
}

/** The most recent interview recorded as done (its recommendation drives the decision). */
export function latestDoneInterview(interviews: readonly Interview[]): Interview | null {
  return interviews.filter((i) => i.status === 'done').sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0] ?? null;
}

/** Average of the given scores, or null without any. */
export function averageScore(scores: Record<string, number>): number | null {
  const values = Object.values(scores);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Criteria to score on an interview: the current list from settings, then any
 * key already scored on this interview whose criterion has since been removed
 * (shown with its key, so the score isn't lost).
 */
export function criteriaFor(criteria: readonly InterviewCriterion[], scores: Record<string, number>): (InterviewCriterion & { removed: boolean })[] {
  const known = new Set(criteria.map((c) => c.key));
  return [
    ...criteria.map((c) => ({ ...c, removed: false })),
    ...Object.keys(scores)
      .filter((k) => !known.has(k))
      .map((key) => ({ key, label: key, labelAr: null, removed: true })),
  ];
}

/** A criterion's label in the UI language (Arabic label when set). */
export function criterionLabel(c: Pick<InterviewCriterion, 'label' | 'labelAr'>, language: string): string {
  return language === 'ar' && c.labelAr ? c.labelAr : c.label;
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

/** Pre-written WhatsApp messages (text in the admissions namespace, EN + AR, under whatsapp.templates.<key>). */
export const WHATSAPP_TEMPLATES = ['first_reply', 'follow_up', 'interview_invite', 'accepted'] as const;
export type WhatsAppTemplate = (typeof WHATSAPP_TEMPLATES)[number];

/** The message that fits the lead's stage best. */
export function suggestedTemplate(status: LeadStatus, hasScheduledInterview: boolean): WhatsAppTemplate {
  if (status === 'accepted') return 'accepted';
  if (hasScheduledInterview) return 'interview_invite';
  return status === 'new' ? 'first_reply' : 'follow_up';
}
