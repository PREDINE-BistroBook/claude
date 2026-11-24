/**
 * The video pipeline (Part L): who sees which videos, videos as every
 * endpoint answers them (Video / VideoDetail), who is alerted, and the counts
 * the 20-second poll carries (GET /api/chat/unread → `videos`). The routes are
 * in routes/videos.ts.
 */
import type { Context } from 'hono';
import { and, asc, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { LOCALES, type Locale, type NotificationKind, type VideoStatus } from '../../shared/enums';
import { worksOnVideos } from '../../shared/permissions';
import type { SessionUser } from '../../shared/schemas/auth';
import type { PushPayload } from '../../shared/schemas/notifications';
import type { PersonRef } from '../../shared/schemas/team';
import { seesAllVideos, usesVideos, type Video, type VideoCounts, type VideoDetail, type VideoEvent, type VideoRuleFacts, type VideoStudent } from '../../shared/schemas/videos';
import type { DB } from '../db/database';
import { classSessions, courses, notifications, students, users, videoEvents, videoStudents, videos } from '../db/schema';
import type { AppEnv } from '../env';
import { hasPermission, loadAccess, ownCourseIds, seesAllClasses, studentScope, type Conn } from './access';
import { notify, type NotificationTextKey, notificationText, preview } from './notifications';
import { queuePush } from './push';
import { chunk, IN_LIST_CHUNK, inChunks } from './sqlLimits';
import { loadPersons, missingPerson } from './team';

type Reader = Pick<DB, 'select'>;
export type VideoRow = typeof videos.$inferSelect;
type Viewer = Pick<SessionUser, 'id' | 'isOwner' | 'permissions'>;

/** The video page: where every video alert points. */
export const videoPath = (videoId: number) => `/videos/${videoId}`;

/** The statuses of the editor's "To edit": new, and sent back with changes. */
export const TO_EDIT_STATUSES = ['new', 'changes_requested'] as const satisfies readonly VideoStatus[];

// ── Who sees which videos ───────────────────────────────────────────────────

/**
 * WHERE for the videos this person may see (undefined: all of them).
 * videos.read / videos.edit / videos.review (and owners) see every video.
 * Anyone else (videos.add: the coaches) sees the videos of the workshops they
 * can see — courses.read and its class scope — and the videos they added.
 */
export function videoScope(user: Viewer): SQL | undefined {
  if (seesAllVideos(user)) return undefined;
  const mine = eq(videos.addedById, user.id);
  if (!hasPermission(user, 'courses.read')) return mine;
  if (seesAllClasses(user)) return undefined;
  return sql`(${mine} or ${videos.courseId} in (${ownCourseIds(user.id)}))`;
}

/** The row, if this person may see it (else undefined: answer 404). */
export function findVisibleVideo(db: Reader, id: number, user: Viewer): VideoRow | undefined {
  return db
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), videoScope(user)))
    .get();
}

/**
 * Of these accounts, the ones that can still edit videos: active, and holding
 * videos.edit (owners hold every permission). An editor who was switched off,
 * or whose Video editor position was taken away while keeping the account,
 * is not one of them: the video they were editing goes to the other editors.
 */
export function editorsWhoCanEdit(db: Reader, userIds: readonly (number | null)[]): Set<number> {
  const ids = [...new Set(userIds.filter((id): id is number => id !== null))];
  if (!ids.length) return new Set();
  const active = new Set(
    inChunks(ids, (part) =>
      db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, part), eq(users.active, true)))
        .all(),
    ).map((r) => r.id),
  );
  const access = loadAccess(
    db,
    ids.filter((id) => active.has(id)),
  );
  return new Set([...access].filter(([, a]) => a.isOwner || a.permissions.includes('videos.edit')).map(([id]) => id));
}

/** The facts the rules read (shared/schemas/videos.ts videoActions): the status, who added it, who is editing it and whether they can still edit. */
export function videoRuleFacts(db: Reader, row: Pick<VideoRow, 'status' | 'addedById' | 'editorId'>): VideoRuleFacts {
  return {
    status: row.status,
    addedBy: row.addedById === null ? null : { id: row.addedById },
    editor: row.editorId === null ? null : { id: row.editorId },
    editorCanEdit: row.editorId !== null && editorsWhoCanEdit(db, [row.editorId]).has(row.editorId),
  };
}

// ── Videos as the API answers them ──────────────────────────────────────────

/** The students in these videos, by video id — the ones the viewer may see, and how many others. */
function studentsOf(db: Reader, videoIds: readonly number[], viewer: Viewer): Map<number, { visible: VideoStudent[]; hidden: number }> {
  const rows = inChunks(videoIds, (part) =>
    db
      .select({ videoId: videoStudents.videoId, id: students.id, firstName: students.firstName, lastName: students.lastName, photoFileId: students.photoFileId })
      .from(videoStudents)
      .innerJoin(students, eq(students.id, videoStudents.studentId))
      .where(inArray(videoStudents.videoId, part))
      .orderBy(sql`${students.lastName} collate nocase`, sql`${students.firstName} collate nocase`, asc(students.id))
      .all(),
  );
  // Students' names follow the student rules: students.read, then its scope (lib/access.ts).
  let visible: (studentId: number) => boolean;
  if (!hasPermission(viewer, 'students.read')) visible = () => false;
  else if (seesAllClasses(viewer)) visible = () => true;
  else {
    const ids = [...new Set(rows.map((r) => r.id))];
    const allowed = new Set(
      inChunks(ids, (part) =>
        db
          .select({ id: students.id })
          .from(students)
          .where(and(inArray(students.id, part), studentScope(viewer)))
          .all(),
      ).map((r) => r.id),
    );
    visible = (studentId) => allowed.has(studentId);
  }
  const out = new Map<number, { visible: VideoStudent[]; hidden: number }>();
  for (const { videoId, ...s } of rows) {
    const entry = out.get(videoId) ?? { visible: [], hidden: 0 };
    if (visible(s.id)) entry.visible.push(s);
    else entry.hidden++;
    out.set(videoId, entry);
  }
  return out;
}

/** The newest "Needs changes" / reopen note of each video, by video id. */
function changesNotes(db: Reader, videoIds: readonly number[]): Map<number, string> {
  const rows = inChunks(videoIds, (part) =>
    db
      .select({ videoId: videoEvents.videoId, note: videoEvents.note })
      .from(videoEvents)
      .where(and(inArray(videoEvents.videoId, part), inArray(videoEvents.type, ['changes_requested', 'reopened'])))
      .orderBy(desc(videoEvents.id))
      .all(),
  );
  const out = new Map<number, string>();
  for (const r of rows) if (r.note && !out.has(r.videoId)) out.set(r.videoId, r.note);
  return out;
}

const listColumns = {
  video: videos,
  courseName: courses.name,
  color: courses.color,
  sessionDate: classSessions.date,
  sessionStartTime: classSessions.startTime,
};

/** Videos matching `where`, as the API answers them, in the given order (one query per kind of data, never one per row). */
export function loadVideos(db: Reader, where: SQL | undefined, viewer: Viewer, opts: { order?: SQL[]; limit?: number } = {}): Video[] {
  let q = db
    .select(listColumns)
    .from(videos)
    .innerJoin(courses, eq(courses.id, videos.courseId))
    .leftJoin(classSessions, eq(classSessions.id, videos.sessionId))
    .where(where)
    .orderBy(...(opts.order ?? [asc(videos.dueOn), asc(videos.id)]))
    .$dynamic();
  if (opts.limit) q = q.limit(opts.limit);
  const rows = q.all();
  const ids = rows.map((r) => r.video.id);
  const people = loadPersons(
    db,
    rows.flatMap((r) => [r.video.addedById, r.video.editorId, r.video.reviewerId]),
  );
  const person = (userId: number | null): PersonRef | null => (userId === null ? null : (people.get(userId) ?? missingPerson(userId)));
  const inIt = studentsOf(db, ids, viewer);
  const notes = changesNotes(db, ids);
  const canEdit = editorsWhoCanEdit(
    db,
    rows.map((r) => r.video.editorId),
  );
  return rows.map(({ video: v, ...r }) => ({
    id: v.id,
    courseId: v.courseId,
    courseName: r.courseName,
    color: r.color,
    sessionId: v.sessionId,
    sessionDate: r.sessionDate,
    sessionStartTime: r.sessionStartTime,
    title: v.title,
    kind: v.kind,
    rawLink: v.rawLink,
    notesForEditor: v.notesForEditor,
    dueOn: v.dueOn,
    status: v.status,
    addedBy: person(v.addedById),
    editor: person(v.editorId),
    editorCanEdit: v.editorId !== null && canEdit.has(v.editorId),
    reviewer: person(v.reviewerId),
    editedLink: v.editedLink,
    editorNotes: v.editorNotes,
    changesNote: notes.get(v.id) ?? null,
    takenAt: v.takenAt,
    submittedAt: v.submittedAt,
    decidedAt: v.decidedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    students: inIt.get(v.id)?.visible ?? [],
    studentsHidden: inIt.get(v.id)?.hidden ?? 0,
  }));
}

/** A video's history, oldest first. */
export function loadVideoEvents(db: Reader, videoId: number): VideoEvent[] {
  const rows = db.select().from(videoEvents).where(eq(videoEvents.videoId, videoId)).orderBy(asc(videoEvents.createdAt), asc(videoEvents.id)).all();
  const people = loadPersons(
    db,
    rows.map((r) => r.userId),
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    note: r.note,
    link: r.link,
    by: r.userId === null ? null : (people.get(r.userId) ?? missingPerson(r.userId)),
    createdAt: r.createdAt,
  }));
}

/** The video with its history, if this person may see it. */
export function loadVideoDetail(db: Reader, id: number, viewer: Viewer): VideoDetail | null {
  const video = loadVideos(db, and(eq(videos.id, id), videoScope(viewer)), viewer)[0];
  if (!video) return null;
  return { ...video, events: loadVideoEvents(db, id) };
}

// ── Who is alerted ──────────────────────────────────────────────────────────

/** A person an alert goes to, with the language it is written in. */
export interface VideoRecipient {
  id: number;
  locale: Locale;
}

/**
 * The working editors (videos.edit) or reviewers (videos.review): every
 * active account that holds the permission and does not manage the team
 * (worksOnVideos, VID-PERM-3 — so never the owners, who hold staff.manage like
 * every permission, nor the Executive Director, who holds videos.edit and
 * videos.review only to keep reach over those accounts). Who is alerted as an
 * editor or a reviewer, and who counts as "someone checks finished edits".
 * `exceptUserId` leaves out whoever is acting.
 */
export function videoTeam(db: Reader, permission: 'videos.edit' | 'videos.review', exceptUserId?: number): VideoRecipient[] {
  const active = db.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.active, true)).orderBy(asc(users.id)).all();
  const access = loadAccess(
    db,
    active.map((u) => u.id),
  );
  return active.filter((u) => {
    const a = access.get(u.id);
    return u.id !== exceptUserId && !!a && worksOnVideos(a.permissions, permission);
  });
}

/** One person, if active and not the one acting (the coach who added a video). */
export function videoPerson(db: Reader, userId: number | null, exceptUserId: number): VideoRecipient[] {
  if (userId === null || userId === exceptUserId) return [];
  const row = db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.active, true)))
    .get();
  return row ? [row] : [];
}

/**
 * Who hears that an edit needs changes (or an approved one is reopened): the
 * editor who did it, while they are still a working editor — active, holding
 * videos.edit, not managing the team (videoTeam) — else every working editor,
 * so the video never waits on someone who can no longer open it or who is
 * never alerted as an editor (an owner or the director who did the edit
 * themselves: VID-PERM-3). Nobody when the one deciding is the editor themselves.
 */
export function videoChangesRecipients(db: Reader, editorId: number | null, exceptUserId: number): VideoRecipient[] {
  if (editorId === exceptUserId) return [];
  const editors = videoTeam(db, 'videos.edit', exceptUserId);
  const theOne = editors.filter((e) => e.id === editorId);
  return theOne.length ? theOne : editors;
}

/** The people alerted, as names and photos for the answer (VideoStepResult.told): "Moaty got an alert". */
export function toldPersons(db: Reader, recipients: readonly VideoRecipient[]): PersonRef[] {
  const people = loadPersons(
    db,
    recipients.map((r) => r.id),
  );
  return recipients.map((r) => people.get(r.id) ?? missingPerson(r.id));
}

/** The video's alerts in everyone's bell (they would open a page that is gone): deleting a video, or the workshop that holds it. */
export function deleteVideoAlerts(tx: Conn, videoIds: readonly number[]): void {
  for (const part of chunk(videoIds.map(videoPath), IN_LIST_CHUNK)) tx.delete(notifications).where(inArray(notifications.link, part)).run();
}

/** What one alert says, written for each reader's language. */
export interface VideoAlert {
  kind: Extract<NotificationKind, 'video_new' | 'video_review' | 'video_changes' | 'video_approved'>;
  title: NotificationTextKey;
  body: NotificationTextKey;
  /** Filled into both texts ({{title}}, {{course}}, {{name}}, {{note}}). */
  values: Record<string, string>;
}

/** The note as a short preview in an alert. */
export const alertNote = (note: string) => preview(note);

/**
 * Inside the transaction: the alert in each recipient's bell — one per video
 * and kind, updated and moved to the top when it comes again (a second round
 * of changes, a resubmitted edit).
 */
export function notifyVideo(tx: Conn, videoId: number, recipients: readonly VideoRecipient[], alert: VideoAlert, now: number): void {
  for (const r of recipients) {
    notify(
      tx,
      {
        userId: r.id,
        kind: alert.kind,
        title: notificationText(r.locale, alert.title, alert.values),
        body: notificationText(r.locale, alert.body, alert.values),
        link: videoPath(videoId),
      },
      now,
      { replace: true },
    );
  }
}

/**
 * After the transaction: the same alert pushed to the recipients' phones, one
 * message per language. Finished edits wake the phone (the reviewer must
 * know); the others arrive normally.
 */
export function pushVideo(c: Context<AppEnv>, videoId: number, recipients: readonly VideoRecipient[], alert: VideoAlert): void {
  for (const locale of LOCALES) {
    const ids = recipients.filter((r) => r.locale === locale).map((r) => r.id);
    const payload: PushPayload = {
      title: notificationText(locale, alert.title, alert.values),
      body: notificationText(locale, alert.body, alert.values),
      link: videoPath(videoId),
      kind: alert.kind,
      tag: `video-${videoId}`,
    };
    queuePush(c, ids, payload, { ttl: 24 * 60 * 60, urgency: alert.kind === 'video_review' || alert.kind === 'video_changes' ? 'high' : 'normal', topic: `video-${videoId}` });
  }
}

/**
 * Video alerts left out of a person's bell and its count: the editor's
 * ("New video to edit", "Changes needed") without videos.edit, the reviewer's
 * ("Edit ready to check") without videos.review, "Video approved" without any
 * videos permission — someone whose position was taken away keeps no alert
 * that only opens a "No access" page.
 */
export function hiddenVideoKinds(user: Pick<SessionUser, 'permissions'>): NotificationKind[] {
  const out: NotificationKind[] = [];
  if (!user.permissions.includes('videos.edit')) out.push('video_new', 'video_changes');
  if (!user.permissions.includes('videos.review')) out.push('video_review');
  if (!usesVideos(user)) out.push('video_approved');
  return out;
}

// ── The poll ────────────────────────────────────────────────────────────────

/**
 * The video pipeline's part of GET /api/chat/unread: null without any videos
 * permission; the editor's and the reviewer's counts only for the working
 * editors and reviewers (worksOnVideos: never someone who manages the team —
 * owners, the director —, like the alerts); the coach's own counts for everyone who adds.
 * `weekStart`: epoch ms of the school's week start (its time zone), worked
 * out only when needed.
 */
export function videoCounts(db: Reader, user: Viewer, today: string, weekStart: () => number): VideoCounts | null {
  if (!usesVideos(user)) return null;
  const out: VideoCounts = { toEdit: null, dueToday: null, late: null, toCheck: null, addedByMe: 0, addedOpen: 0, approvedThisWeek: 0, reviewers: null };
  if (worksOnVideos(user.permissions, 'videos.edit')) {
    const r = db
      .select({
        n: count(),
        dueToday: sql<number>`coalesce(sum(case when ${videos.dueOn} = ${today} then 1 else 0 end), 0)`.mapWith(Number),
        late: sql<number>`coalesce(sum(case when ${videos.dueOn} < ${today} then 1 else 0 end), 0)`.mapWith(Number),
      })
      .from(videos)
      .where(inArray(videos.status, [...TO_EDIT_STATUSES]))
      .get();
    out.toEdit = r?.n ?? 0;
    out.dueToday = r?.dueToday ?? 0;
    out.late = r?.late ?? 0;
  }
  if (worksOnVideos(user.permissions, 'videos.review')) {
    out.toCheck = db.select({ n: count() }).from(videos).where(eq(videos.status, 'in_review')).get()?.n ?? 0;
  }
  // Whether "Done" alerts anyone — how many working reviewers there are (the same rule as the alerts): for the editors,
  // and for whoever gives positions (a school where nobody checks yet is told).
  if (hasPermission(user, 'videos.edit') || hasPermission(user, 'staff.manage')) out.reviewers = videoTeam(db, 'videos.review').length;
  const mine = db
    .select({
      n: count(),
      open: sql<number>`coalesce(sum(case when ${videos.status} <> 'approved' then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(videos)
    .where(eq(videos.addedById, user.id))
    .get();
  out.addedByMe = mine?.n ?? 0;
  out.addedOpen = mine?.open ?? 0;
  if (out.addedByMe > 0) {
    out.approvedThisWeek =
      db
        .select({ n: count() })
        .from(videos)
        .where(and(eq(videos.addedById, user.id), eq(videos.status, 'approved'), gte(videos.decidedAt, weekStart())))
        .get()?.n ?? 0;
  }
  return out;
}
