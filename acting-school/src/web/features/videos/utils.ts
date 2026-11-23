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
  return { edit: can('videos.edit'), review: can('videos.review'), add: can('videos.add'), read: can('videos.read') };
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

// ── The add form ────────────────────────────────────────────────────────────

/** The title offered when adding: "<workshop> — <date>" (the date as the reader writes it). */
export function defaultVideoTitle(courseName: string, formattedDate: string | null): string {
  return formattedDate ? `${courseName} — ${formattedDate}` : courseName;
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
