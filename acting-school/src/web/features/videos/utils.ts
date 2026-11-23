import type { VideoStatus } from '@shared/enums';
import type { Permission } from '@shared/permissions';
import type { Video, VideoCounts } from '@shared/schemas/videos';

/**
 * The video pipeline's screens as plain functions (unit-tested in
 * tests/unit/videos-web.test.ts): the queue's tabs for each role, their
 * order, the due-date words, the badge, the add form's defaults. Which buttons
 * a viewer sees is `videoActions` (shared/schemas/videos.ts) — the same rule
 * the API enforces.
 */

/** The queue (School section). */
export const VIDEOS_PATH = '/videos';
export const videoPagePath = (id: number) => `${VIDEOS_PATH}/${id}`;

export type QueueTab = 'toCheck' | 'toEdit' | 'editing' | 'withEditor' | 'waiting' | 'approved' | 'mine';

/** What the person does with videos, from their permissions (never a position's name). */
export interface VideoRoles {
  edit: boolean;
  review: boolean;
  add: boolean;
  read: boolean;
}

export function videoRoles(can: (p: Permission) => boolean): VideoRoles {
  return {
    edit: can('videos.edit'),
    review: can('videos.review'),
    add: can('videos.add'),
    read: can('videos.read'),
  };
}

/**
 * The queue's tabs, in order, for the person's role:
 * - the editor: To edit (new + sent back), Editing (his), Waiting for check, Approved;
 * - the reviewer: To check first, then With the editor, Approved;
 * - someone who does both (owners): To check, To edit, Editing, Approved;
 * - someone who only sees the pipeline (the director): With the editor, Waiting for check, Approved;
 * - a coach (adds only): their videos — In progress, Approved.
 */
export function queueTabs(roles: VideoRoles): QueueTab[] {
  const tabs: QueueTab[] = [];
  if (roles.review) tabs.push('toCheck');
  if (roles.edit) tabs.push('toEdit', 'editing');
  if (roles.review && !roles.edit) tabs.push('withEditor');
  if (roles.edit && !roles.review) tabs.push('waiting');
  if (!roles.edit && !roles.review) {
    if (roles.read) tabs.push('withEditor', 'waiting');
    else tabs.push('mine');
  }
  tabs.push('approved');
  return tabs;
}

/** Whether the queue lists only my own videos (a coach who only adds): GET /api/videos?mine=1. */
export function queueIsMine(roles: VideoRoles): boolean {
  return !roles.edit && !roles.review && !roles.read;
}

const TAB_STATUSES: Record<QueueTab, readonly VideoStatus[]> = {
  toCheck: ['in_review'],
  toEdit: ['new', 'changes_requested'],
  editing: ['editing'],
  withEditor: ['new', 'editing', 'changes_requested'],
  waiting: ['in_review'],
  approved: ['approved'],
  mine: ['new', 'editing', 'in_review', 'changes_requested'],
};

/**
 * The videos of one tab, in the order they are worked on: in "To edit" the
 * ones sent back with changes first, then by due date (the most overdue
 * first); "Editing" is the editor's own; "Approved" newest first; the rest by
 * due date.
 */
export function tabVideos(videos: readonly Video[], tab: QueueTab, me: number, isOwner = false): Video[] {
  const statuses = TAB_STATUSES[tab];
  const list = videos.filter((v) => statuses.includes(v.status) && (tab !== 'editing' || isOwner || v.editor?.id === me));
  if (tab === 'approved') return list.sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0) || b.id - a.id);
  if (tab === 'toEdit') return list.sort(byEditorQueue);
  return list.sort(byDue);
}

/** Due date first (oldest first), then the order they came in. */
export function byDue(a: Pick<Video, 'dueOn' | 'id'>, b: Pick<Video, 'dueOn' | 'id'>): number {
  return a.dueOn.localeCompare(b.dueOn) || a.id - b.id;
}

/** The editor's "To edit": sent back with changes on top, then by due date. */
export function byEditorQueue(a: Pick<Video, 'status' | 'dueOn' | 'id'>, b: Pick<Video, 'status' | 'dueOn' | 'id'>): number {
  const back = (v: Pick<Video, 'status'>) => (v.status === 'changes_requested' ? 0 : 1);
  return back(a) - back(b) || byDue(a, b);
}

/** How many videos each tab holds (the counts on the tabs). */
export function tabCounts(videos: readonly Video[], tabs: readonly QueueTab[], me: number, isOwner = false): Record<QueueTab, number> {
  const out = {} as Record<QueueTab, number>;
  for (const tab of tabs) out[tab] = tabVideos(videos, tab, me, isOwner).length;
  return out;
}

/** The tab that opens first: the first one with something in it among the work tabs, else the first. */
export function firstTab(tabs: readonly QueueTab[], counts: Partial<Record<QueueTab, number>>): QueueTab {
  const work = tabs.filter((t) => t !== 'approved');
  return work.find((t) => (counts[t] ?? 0) > 0) ?? tabs[0]!;
}

// ── Due dates ───────────────────────────────────────────────────────────────

export type DueWords = { key: 'today' | 'tomorrow' | 'on'; late: false } | { key: 'late'; late: true; days: number };

/** "Due today" / "Due tomorrow" / "Due Tue 25 Nov" / "2 days late" — late only while the video still waits for the editor. */
export function dueWords(dueOn: string, today: string, status: VideoStatus): DueWords {
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const open = status === 'new' || status === 'editing' || status === 'changes_requested';
  if (days < 0 && open) return { key: 'late', late: true, days: -days };
  if (days === 0) return { key: 'today', late: false };
  if (days === 1) return { key: 'tomorrow', late: false };
  return { key: 'on', late: false };
}

// ── Counts (the 20-second poll) ─────────────────────────────────────────────

/** The count on the "Videos" menu entry: what waits for this person — edits to check, videos to edit. */
export function videosBadge(counts: VideoCounts | null | undefined): number {
  if (!counts) return 0;
  return (counts.toEdit ?? 0) + (counts.toCheck ?? 0);
}

export type VideoHomeCard = 'editor' | 'reviewer' | 'coach';

/**
 * The School home's video cards for this person (any that apply): the
 * editor's, the reviewer's, and the coach's — only while one of their videos
 * is still with the editor or the reviewer, or one was approved this week
 * (never a "0 approved this week").
 */
export function videoHomeCardKinds(counts: VideoCounts | null | undefined): VideoHomeCard[] {
  if (!counts) return [];
  const out: VideoHomeCard[] = [];
  if (counts.toEdit !== null) out.push('editor');
  if (counts.toCheck !== null) out.push('reviewer');
  if (counts.addedOpen > 0 || counts.approvedThisWeek > 0) out.push('coach');
  return out;
}

/**
 * Nobody checks finished edits yet (nobody holds the Video reviewer position,
 * as on the live school before an owner gives it to Moaty): what this person
 * is told. 'give' — they can give the position themselves (staff.manage and
 * videos.review: the owners), with a link to Team; 'ask' — they manage the
 * team but can't give it (the director: ask an owner); null — nothing to say
 * here (the editors are told in the "Done" sheet and after sending).
 */
export function reviewerNotice(counts: VideoCounts | null | undefined, can: (p: Permission) => boolean): 'give' | 'ask' | null {
  if (!counts || counts.reviewers !== 0 || !can('staff.manage')) return null;
  return can('videos.review') ? 'give' : 'ask';
}

// ── What a card says about time ─────────────────────────────────────────────

/**
 * The line in a card's header: the due date while the editor still has work
 * to do; once handed in, how long the edit has waited for its check; once
 * approved, when.
 */
export function cardWhen(v: Pick<Video, 'status' | 'submittedAt' | 'decidedAt'>): { kind: 'due' } | { kind: 'sent'; at: number } | { kind: 'approved'; at: number } {
  if (v.status === 'in_review' && v.submittedAt) return { kind: 'sent', at: v.submittedAt };
  if (v.status === 'approved' && v.decidedAt) return { kind: 'approved', at: v.decidedAt };
  return { kind: 'due' };
}

/** How long ago, in the unit worth saying: under a minute "now", minutes up to two hours, hours up to two days, then days. */
export function waitedParts(then: number, now: number): { unit: 'now' } | { unit: 'minute' | 'hour' | 'day'; value: number } {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 120) return { unit: 'minute', value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: 'hour', value: hours };
  return { unit: 'day', value: Math.floor(hours / 24) };
}

// ── After a tap on a card ───────────────────────────────────────────────────

/** A step taken from a card's buttons. */
export type VideoStep = 'take' | 'submit' | 'approve' | 'changes' | 'reopen';

/**
 * After a tap on any step button in the queue, every step button rests this
 * long and the cards stay where they were (as on the cafeteria board): a
 * second tap on the same spot — a habit for people unsure the first one
 * worked — must not take the next video, or approve the one that slid under
 * the finger.
 */
export const QUEUE_MOVE_REST_MS = 2_000;

/** Whether the queue's step buttons are resting after the last tap on one (at `lastMoveAt`). */
export function queueResting(lastMoveAt: number | null, now: number): boolean {
  return lastMoveAt !== null && now - lastMoveAt < QUEUE_MOVE_REST_MS;
}

/** While resting: the same cards in the same places (`ids`, as they were shown), each with its new state; one that is gone is left out. */
export function pinnedVideos(videos: readonly Video[], ids: readonly number[]): Video[] {
  const byId = new Map(videos.map((v) => [v.id, v]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Where the queue goes after a step on a card: "Start editing" / "Start
 * fixing" opens the editor's "Editing" tab with that video on top (its "Open
 * raw footage" and "Done" are there); every other step stays on the tab.
 */
export function afterStep(step: VideoStep, tab: QueueTab, tabs: readonly QueueTab[], videoId: number, editingIds: readonly number[]): { tab: QueueTab; pinned: number[] | null } {
  if (step === 'take' && tabs.includes('editing'))
    return {
      tab: 'editing',
      pinned: [videoId, ...editingIds.filter((id) => id !== videoId)],
    };
  return { tab, pinned: null };
}

// ── Who was told ────────────────────────────────────────────────────────────

/**
 * "Moaty", "Ali and Hany", "Ali, Hany and Sara" (the list in the screen's
 * language), each name isolated so an English name in an Arabic sentence
 * keeps its punctuation where it belongs.
 */
export function namesList(names: readonly string[], language: string): string {
  const isolated = names.map((n) => `\u2068${n}\u2069`);
  try {
    return new Intl.ListFormat(language === 'ar' ? 'ar' : 'en', {
      style: 'long',
      type: 'conjunction',
    }).format(isolated);
  } catch {
    return isolated.join(language === 'ar' ? '، ' : ', ');
  }
}

// ── The add form ────────────────────────────────────────────────────────────

/**
 * The title offered when adding: "<workshop> — 23/11/2026". The date is in
 * digits, day first (as the school writes it): a month name in Arabic next to
 * an English workshop name (or the other way round) would be scrambled by the
 * text direction on every screen and alert that shows the title; digits read
 * the same in both directions.
 */
export function defaultVideoTitle(courseName: string, isoDate: string | null): string {
  if (!isoDate) return courseName;
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${courseName} — ${d}/${m}/${y}`;
}

/**
 * The title once the coach picks another session (from a workshop's Videos
 * tab): it follows the session as long as the coach hasn't typed their own.
 */
export function titleForSession(current: string, courseName: string, before: string | null, after: string | null): string {
  return current.trim() === defaultVideoTitle(courseName, before) || !current.trim() ? defaultVideoTitle(courseName, after) : current;
}

/**
 * A pasted link, tidied: spaces around it gone, and "https://" put in front
 * when it was copied without it ("drive.google.com/…"). Anything else is
 * left for the server to refuse.
 */
export function tidyLink(text: string): string {
  const v = text.trim();
  if (!v) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) return `https://${v}`;
  return v;
}

/** The ids of students ticked, toggled: one tap adds or removes. */
export function toggleStudent(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
