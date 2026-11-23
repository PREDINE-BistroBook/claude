import { z } from 'zod';
import { VIDEO_KINDS, VIDEO_STATUSES, type CourseColor, type VideoEventType, type VideoKind, type VideoStatus } from '../enums';
import type { Permission } from '../permissions';
import { id, optDate, optText, reqText } from './common';
import type { PersonRef } from './team';

/**
 * The video pipeline (Part L of docs/SECTIONS_AND_WEBSITE.md), /api/videos:
 * a coach records in class and adds the raw-footage link on the session; the
 * video editor takes it ("Start editing"), hands in the edited link ("Done");
 * the reviewer checks it — "Approved", or "Needs changes" with a note, which
 * sends it back to the editor ("Start fixing" → "Done" again).
 *
 * **Videos are links** (Google Drive, WeTransfer, YouTube unlisted, …): the
 * app stores no video, so it stays at $0.
 *
 * Who sees what: videos.read, videos.edit and videos.review see every video;
 * someone with only videos.add sees the videos of the workshops they can see
 * (class scope) and the ones they added. Students' names follow the student
 * rules (students.read and its scope): the others are only counted.
 */

export const VIDEO_TITLE_MAX = 120;
export const VIDEO_LINK_MAX = 1000;
export const VIDEO_NOTE_MAX = 1000;
/** Students who appear in one video, at most. */
export const MAX_VIDEO_STUDENTS = 60;
/** GET /api/videos answers at most this many. */
export const VIDEOS_PAGE = 200;

/**
 * A video link: http or https only (never javascript:, data:, file:…),
 * at most 1000 characters. Pasted text around it ("Link: https://…") is not
 * cleaned up — the field must hold the link itself.
 */
export const videoLink = z
  .string()
  .trim()
  .min(1)
  .max(VIDEO_LINK_MAX)
  .pipe(z.url({ protocol: /^https?$/, hostname: z.regexes.domain, message: 'videos:errors.invalidLink' }));

const videoFields = z.object({
  title: reqText(VIDEO_TITLE_MAX),
  /** Defaults to 'other' on create. */
  kind: z.enum(VIDEO_KINDS).optional(),
  rawLink: videoLink,
  notesForEditor: optText(VIDEO_NOTE_MAX),
  /** Defaults to the day after it is added (the school's clock). */
  dueOn: optDate,
  /** Who appears in it: students enrolled (now or before) in the video's workshop. */
  studentIds: z.array(id).max(MAX_VIDEO_STUDENTS).optional(),
});

/**
 * POST /api/videos (videos.add): from a session (`sessionId`: the workshop is
 * the session's) or from a workshop (`courseId` alone). Only a session or a
 * workshop the person can see (class scope); anything else answers 404.
 */
export const videoInput = videoFields
  .extend({
    courseId: id.optional(),
    sessionId: id.optional(),
  })
  .refine((v) => v.courseId !== undefined || v.sessionId !== undefined, { message: 'errors.required', path: ['sessionId'] });
export type VideoInput = z.infer<typeof videoInput>;

/** PATCH /api/videos/:id — only while the video is new (nobody has started on it). */
export const videoUpdateInput = videoFields.partial();
export type VideoUpdateInput = z.infer<typeof videoUpdateInput>;

/** POST /api/videos/:id/submit (videos.edit): the edited link (required), and notes for the reviewer. */
export const videoSubmitInput = z.object({
  editedLink: videoLink,
  notes: optText(VIDEO_NOTE_MAX),
});
export type VideoSubmitInput = z.infer<typeof videoSubmitInput>;

/** POST /:id/request-changes, /:id/reopen (videos.review) and /:id/comments: a note, required. */
export const videoNoteInput = z.object({ note: reqText(VIDEO_NOTE_MAX) });
export type VideoNoteInput = z.infer<typeof videoNoteInput>;

const statusList = z
  .string()
  .max(200)
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.enum(VIDEO_STATUSES)).min(1));

/**
 * GET /api/videos query. `status`: one status or several, comma-separated
 * ("new,changes_requested"). `mine=1`: videos I added, am editing or edited,
 * or decided on. `courseId` / `sessionId`: one workshop's or session's.
 */
export const videosQuery = z.object({
  status: statusList.optional(),
  mine: z.enum(['1', 'true', '0', 'false']).optional(),
  courseId: id.optional(),
  sessionId: id.optional(),
});
export type VideosQuery = z.infer<typeof videosQuery>;

// ── Responses ───────────────────────────────────────────────────────────────

/** A student in the video, as the viewer may see them (students.read and its scope). */
export interface VideoStudent {
  id: number;
  firstName: string;
  lastName: string;
  photoFileId: string | null;
}

/** One entry of a video's history (oldest first on the video page). */
export interface VideoEvent {
  id: number;
  type: VideoEventType;
  /** The note that came with it: a comment, the reason for changes, the editor's notes. */
  note: string | null;
  /** The link that came with it: the raw footage (added), the edited video (submitted). */
  link: string | null;
  by: PersonRef | null;
  createdAt: number;
}

/** What a list answers for each video (GET /api/videos). */
export interface Video {
  id: number;
  courseId: number;
  courseName: string;
  color: CourseColor | null;
  sessionId: number | null;
  /** The session's date and start time, when the video belongs to a session. */
  sessionDate: string | null;
  sessionStartTime: string | null;
  title: string;
  kind: VideoKind;
  rawLink: string;
  notesForEditor: string | null;
  dueOn: string;
  status: VideoStatus;
  /** The coach who added it. */
  addedBy: PersonRef | null;
  /** The editor who took it (and hands in the edit). */
  editor: PersonRef | null;
  /** The reviewer who decided last (approved, asked for changes, reopened). */
  reviewer: PersonRef | null;
  editedLink: string | null;
  editorNotes: string | null;
  /** The newest "Needs changes" (or reopen) note, for the editor's card; null when there was none. */
  changesNote: string | null;
  takenAt: number | null;
  submittedAt: number | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** The students in it the viewer may see. */
  students: VideoStudent[];
  /** How many more are in it that the viewer may not see (no students.read, or outside their scope). */
  studentsHidden: number;
}

/** GET /api/videos/:id, and every write's answer: the video with its whole history. */
export interface VideoDetail extends Video {
  events: VideoEvent[];
}

/**
 * The video pipeline's part of the 20-second poll (GET /api/chat/unread →
 * `videos`): the counts behind the "Videos" menu badge and the School home's
 * cards. null for someone who holds no videos permission. Owners hold every
 * permission but get no editor's or reviewer's counts (they are not alerted
 * either, the school's rule): those are null for them.
 */
export interface VideoCounts {
  /** videos.edit (not owners): new videos and videos sent back with changes — the editor's "To edit". */
  toEdit: number | null;
  /** …of those, due today. */
  dueToday: number | null;
  /** …of those, due before today (late). */
  late: number | null;
  /** videos.review (not owners): edits waiting for a check. */
  toCheck: number | null;
  /** Videos I added (any status): whether the coach's card shows. */
  addedByMe: number;
  /** Videos I added that were approved this week (the school's week, its time zone). */
  approvedThisWeek: number;
}

/** Error codes (error.code) of the videos API besides the generic ones. */
export const VIDEO_ERROR_CODES = {
  /** 409 — the video has moved on since it was read (two taps, two people): details.video is the video as it is now. */
  moved: 'video_moved',
  /** 409 — PATCH / DELETE once the editor has started: only a new video can be changed or deleted. */
  locked: 'video_locked',
  /** 403 — "Done" from an editor who isn't the one editing it. */
  notYourEdit: 'not_your_edit',
} as const;

// ── Who may do what (the API enforces it; the screens show the buttons) ─────

/** The viewer, as far as the video rules care. */
export interface VideoViewer {
  id: number;
  isOwner: boolean;
  permissions: readonly Permission[];
}

/** A video, as far as the rules care. */
export interface VideoRuleFacts {
  status: VideoStatus;
  addedBy: Pick<PersonRef, 'id'> | null;
  editor: Pick<PersonRef, 'id' | 'active'> | null;
}

export interface VideoActions {
  /** Change the title, links, notes, students or due date (while new). */
  edit: boolean;
  /** Delete it (while new). */
  remove: boolean;
  /** "Start editing" (new), "Start fixing" (changes requested), or take over from an editor who has left. */
  take: boolean;
  /** "Done": hand in the edited link (the editor who is editing it). */
  submit: boolean;
  /** "Approved ✓" (an edit waiting for a check). */
  approve: boolean;
  /** "Needs changes", with a note (an edit waiting for a check). */
  requestChanges: boolean;
  /** Reopen an approved video, with a note: back to the editor. */
  reopen: boolean;
  /** Add a comment to the history (the coach who added it, the editors, the reviewers, owners). */
  comment: boolean;
}

/**
 * What the viewer may do with a video now — the one rule both sides read:
 * the API refuses anything outside it, and the screens show only these
 * buttons (never decided from a position's name).
 */
export function videoActions(v: VideoRuleFacts, viewer: VideoViewer): VideoActions {
  const holds = (p: Permission) => viewer.isOwner || viewer.permissions.includes(p);
  const editor = holds('videos.edit');
  const reviewer = holds('videos.review');
  const isAdder = v.addedBy?.id === viewer.id;
  const isEditor = v.editor?.id === viewer.id;
  // The coach who added it (still adding videos), a reviewer, or an owner.
  const mayChange = v.status === 'new' && ((isAdder && holds('videos.add')) || reviewer || viewer.isOwner);
  // An editor who has left (account switched off) leaves the video to the other editors.
  const abandoned = v.status === 'editing' && (v.editor === null || !v.editor.active) && !isEditor;
  return {
    edit: mayChange,
    remove: mayChange,
    take: editor && (v.status === 'new' || v.status === 'changes_requested' || abandoned),
    submit: editor && v.status === 'editing' && (isEditor || viewer.isOwner),
    approve: reviewer && v.status === 'in_review',
    requestChanges: reviewer && v.status === 'in_review',
    reopen: reviewer && v.status === 'approved',
    comment: isAdder || isEditor || editor || reviewer,
  };
}

/** Whether the viewer sees every video (not only their workshops' and their own). */
export function seesAllVideos(viewer: VideoViewer): boolean {
  return viewer.isOwner || viewer.permissions.some((p) => p === 'videos.read' || p === 'videos.edit' || p === 'videos.review');
}

/** Holds any videos permission (the pipeline exists for them). */
export function usesVideos(viewer: Pick<VideoViewer, 'permissions'>): boolean {
  return viewer.permissions.some((p) => p.startsWith('videos.'));
}

/** The host of a link, to show next to it ("drive.google.com"); null when it isn't a link. */
export function videoLinkHost(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
