/**
 * The video pipeline (Part L): who sees which videos, videos as every
 * endpoint answers them (Video / VideoDetail), who is alerted, and the counts
 * the 20-second poll carries (GET /api/chat/unread → `videos`). The routes are
 * in routes/videos.ts.
 */
import type { Context } from 'hono';
import { and, asc, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { LOCALES, type Locale, type NotificationKind, type VideoStatus } from '../../shared/enums';
import type { SessionUser } from '../../shared/schemas/auth';
import type { PushPayload } from '../../shared/schemas/notifications';
import type { PersonRef } from '../../shared/schemas/team';
import { seesAllVideos, usesVideos, type Video, type VideoCounts, type VideoDetail, type VideoEvent, type VideoRuleFacts, type VideoStudent } from '../../shared/schemas/videos';
import type { DB } from '../db/database';
import { classSessions, courses, students, users, videoEvents, videoStudents, videos } from '../db/schema';
import type { AppEnv } from '../env';
import { hasPermission, loadAccess, ownCourseIds, seesAllClasses, studentScope, type Conn } from './access';
import { notify, type NotificationTextKey, notificationText, preview } from './notifications';
import { queuePush } from './push';
import { inChunks } from './sqlLimits';
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

/** The facts the rules read (shared/schemas/videos.ts videoActions): the status, who added it, who is editing it and whether they are still active. */
export function videoRuleFacts(db: Reader, row: Pick<VideoRow, 'status' | 'addedById' | 'editorId'>): VideoRuleFacts {
  const people = loadPersons(db, [row.addedById, row.editorId]);
  return {
    status: row.status,
    addedBy: row.addedById === null ? null : { id: row.addedById },
    editor: row.editorId === null ? null : (people.get(row.editorId) ?? missingPerson(row.editorId)),
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
 * Every active account holding `permission` that is not an owner (the
 * school's rule: owners hold every permission but are only alerted about what
 * they did themselves) — the editors (videos.edit) or the reviewers
 * (videos.review). `exceptUserId` leaves out whoever is acting.
 */
export function videoTeam(db: Reader, permission: 'videos.edit' | 'videos.review', exceptUserId?: number): VideoRecipient[] {
  const active = db.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.active, true)).orderBy(asc(users.id)).all();
  const access = loadAccess(
    db,
    active.map((u) => u.id),
  );
  return active.filter((u) => {
    const a = access.get(u.id);
    return u.id !== exceptUserId && !!a && !a.isOwner && a.permissions.includes(permission);
  });
}

/** One person, if active and not the one acting (the coach who added a video, the editor who did it). */
export function videoPerson(db: Reader, userId: number | null, exceptUserId: number): VideoRecipient[] {
  if (userId === null || userId === exceptUserId) return [];
  const row = db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.active, true)))
    .get();
  return row ? [row] : [];
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

// ── The poll ────────────────────────────────────────────────────────────────

/**
 * The video pipeline's part of GET /api/chat/unread: null without any videos
 * permission; the editor's and the reviewer's counts only for holders who are
 * not owners (like the alerts); the coach's own counts for everyone who adds.
 * `weekStart`: epoch ms of the school's week start (its time zone), worked
 * out only when needed.
 */
export function videoCounts(db: Reader, user: Viewer, today: string, weekStart: () => number): VideoCounts | null {
  if (!usesVideos(user)) return null;
  const out: VideoCounts = { toEdit: null, dueToday: null, late: null, toCheck: null, addedByMe: 0, approvedThisWeek: 0 };
  if (!user.isOwner && hasPermission(user, 'videos.edit')) {
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
  if (!user.isOwner && hasPermission(user, 'videos.review')) {
    out.toCheck = db.select({ n: count() }).from(videos).where(eq(videos.status, 'in_review')).get()?.n ?? 0;
  }
  out.addedByMe = db.select({ n: count() }).from(videos).where(eq(videos.addedById, user.id)).get()?.n ?? 0;
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
