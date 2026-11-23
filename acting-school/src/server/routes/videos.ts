import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { addDays } from '../../shared/dates';
import type { VideoStatus } from '../../shared/enums';
import type { ListResponse } from '../../shared/schemas/common';
import {
  VIDEOS_PAGE,
  VIDEO_ERROR_CODES,
  videoActions,
  videoChangesInput,
  videoInput,
  videoNoteInput,
  videoSubmitInput,
  videoUpdateInput,
  videosQuery,
  type Video,
  type VideoDetail,
  type VideoEvent,
  type VideoStepResult,
} from '../../shared/schemas/videos';
import type { DB } from '../db/database';
import { classSessions, courses, enrollments, videoEvents, videoStudents, videos } from '../db/schema';
import type { AppEnv } from '../env';
import { courseScope, hasPermission, type Conn } from '../lib/access';
import { schoolToday } from '../lib/clock';
import { ApiError, fieldError, forbidden, notFound } from '../lib/errors';
import { markNotificationsRead, markNotificationsReadForEveryone } from '../lib/notifications';
import { inChunks, insertBatches } from '../lib/sqlLimits';
import { body, paramId, query } from '../lib/validate';
import {
  alertNote,
  deleteVideoAlerts,
  findVisibleVideo,
  loadVideoDetail,
  loadVideoEvents,
  loadVideos,
  notifyVideo,
  pushVideo,
  toldPersons,
  videoChangesRecipients,
  videoPath,
  videoPerson,
  videoRuleFacts,
  videoScope,
  videoTeam,
  type VideoAlert,
  type VideoRecipient,
  type VideoRow,
} from '../lib/videos';
import { currentUser, requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';

/**
 * The video pipeline (Part L): coach → editor → reviewer. Videos are links;
 * the app stores no video.
 *
 * - The coach (videos.add) adds a raw-footage link on a session — or a
 *   workshop — they can see (class scope), with the students in it, notes for
 *   the editor and a due date (tomorrow unless they choose). Every active
 *   editor who is not an owner is alerted.
 * - The editor (videos.edit) takes it ("Start editing"), then hands in the
 *   edited link ("Done"): every active reviewer (videos.review) who is not an
 *   owner is alerted.
 * - The reviewer approves it (the coach who added it is alerted) or asks for
 *   changes with a note (the editor who did it is alerted — every editor if
 *   nobody is named). The editor takes it again ("Start fixing") and hands it
 *   in again. An approved video can be reopened, with a note.
 *
 * Every move is an `UPDATE … WHERE status = <the status read>`: two taps, or
 * two people, can't both move it (the second gets 409 video_moved with the
 * video as it is now). Who may do what is `videoActions` (shared/schemas/videos.ts),
 * which the screens read too. Every move and every comment goes into the
 * video's history (video_events).
 *
 * Visibility: videos.read / videos.edit / videos.review see every video; a
 * coach (videos.add only) sees their workshops' videos and their own; anything
 * else is a 404. Students' names follow the student rules.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);
router.use(requireAnyPermission('videos.read', 'videos.add', 'videos.edit', 'videos.review'));

type Reader = Pick<DB, 'select'>;

/** The video (with its history) as the caller sees it now. */
function detailOf(c: Context<AppEnv>, id: number): VideoDetail {
  const detail = loadVideoDetail(c.get('db'), id, currentUser(c));
  if (!detail) throw notFound('Video not found');
  return detail;
}

/** A step's answer: the video as the caller sees it now, and who was alerted (names and photos). */
function stepResult(c: Context<AppEnv>, id: number, told: readonly VideoRecipient[]): VideoStepResult {
  return { ...detailOf(c, id), told: toldPersons(c.get('db'), told) };
}

/** 409: the video has moved on since it was read — with the video as it is now. */
function moved(c: Context<AppEnv>, id: number): ApiError {
  return new ApiError(409, VIDEO_ERROR_CODES.moved, 'This video has already moved on', undefined, { video: detailOf(c, id) });
}

/** The row, if the caller may see it; else 404 (someone else's workshop answers like a missing id). */
function visibleRow(c: Context<AppEnv>, id: number): VideoRow {
  const row = findVisibleVideo(c.get('db'), id, currentUser(c));
  if (!row) throw notFound('Video not found');
  return row;
}

/** Add a history entry. */
function addEvent(tx: Conn, videoId: number, userId: number, type: VideoEvent['type'], now: number, extra: { note?: string | null; link?: string | null } = {}) {
  tx.insert(videoEvents)
    .values({ videoId, userId, type, note: extra.note ?? null, link: extra.link ?? null, createdAt: now })
    .run();
}

/**
 * The students named for a video of `courseId`: each must be (or have been)
 * enrolled in that workshop — the session's students. Duplicates are dropped.
 */
function checkStudents(db: Reader, courseId: number, ids: readonly number[]): number[] {
  const unique = [...new Set(ids)];
  const enrolled = new Set(
    inChunks(unique, (part) =>
      db
        .select({ studentId: enrollments.studentId })
        .from(enrollments)
        .where(and(eq(enrollments.courseId, courseId), inArray(enrollments.studentId, part)))
        .all(),
    ).map((r) => r.studentId),
  );
  const issues = ids.flatMap((sid, i) => (enrolled.has(sid) ? [] : [{ path: ['studentIds', i], code: 'custom', message: 'videos:errors.notInWorkshop' }]));
  if (issues.length) throw new ApiError(400, 'validation', 'Some students are not in this workshop', issues);
  return unique;
}

function setStudents(tx: Conn, videoId: number, studentIds: readonly number[]) {
  tx.delete(videoStudents).where(eq(videoStudents.videoId, videoId)).run();
  const rows = studentIds.map((studentId) => ({ videoId, studentId }));
  for (const batch of insertBatches(videoStudents, rows)) tx.insert(videoStudents).values(batch).run();
}

/** The course's name, for alert texts. */
const courseName = (db: Reader, courseId: number) => db.select({ name: courses.name }).from(courses).where(eq(courses.id, courseId)).get()?.name ?? '';

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * The videos the caller may see. `?status=` one or several (comma-separated),
 * `?mine=1` the ones I added, edit(ed) or decided on, `?courseId=` / `?sessionId=`.
 * Open videos first, by due date; approved ones after them, newest first.
 */
router.get('/', (c) => {
  const q = query(c, videosQuery);
  const me = currentUser(c);
  const mine = q.mine === '1' || q.mine === 'true';
  const onlyApproved = q.status?.length === 1 && q.status[0] === 'approved';
  const items = loadVideos(
    c.get('db'),
    and(
      videoScope(me),
      q.status ? inArray(videos.status, q.status) : undefined,
      q.courseId ? eq(videos.courseId, q.courseId) : undefined,
      q.sessionId ? eq(videos.sessionId, q.sessionId) : undefined,
      mine ? or(eq(videos.addedById, me.id), eq(videos.editorId, me.id), eq(videos.reviewerId, me.id)) : undefined,
    ),
    me,
    {
      order: onlyApproved
        ? [desc(videos.decidedAt), desc(videos.id)]
        : [
            sql`case when ${videos.status} = 'approved' then 1 else 0 end`,
            sql`case when ${videos.status} = 'approved' then null else ${videos.dueOn} end`,
            desc(videos.decidedAt),
            asc(videos.id),
          ],
      limit: VIDEOS_PAGE,
    },
  );
  return c.json<ListResponse<Video>>({ items });
});

router.get('/:id', (c) => c.json<VideoDetail>(detailOf(c, paramId(c))));

// ── The coach: add, change or delete while new ──────────────────────────────

router.post('/', requirePermission('videos.add'), async (c) => {
  const input = await body(c, videoInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();

  // Only a session or workshop the person can see (class scope); anything else answers like a missing one.
  const seesWorkshops = hasPermission(me, 'courses.read');
  let courseId: number;
  let sessionId: number | null = null;
  if (input.sessionId !== undefined) {
    const session = seesWorkshops
      ? db
          .select({ id: classSessions.id, courseId: classSessions.courseId })
          .from(classSessions)
          .innerJoin(courses, eq(courses.id, classSessions.courseId))
          .where(and(eq(classSessions.id, input.sessionId), courseScope(me)))
          .get()
      : undefined;
    if (!session) throw notFound('Session not found');
    if (input.courseId !== undefined && input.courseId !== session.courseId) throw fieldError(['courseId'], 'videos:errors.sessionNotInWorkshop');
    courseId = session.courseId;
    sessionId = session.id;
  } else {
    const course = seesWorkshops
      ? db
          .select({ id: courses.id })
          .from(courses)
          .where(and(eq(courses.id, input.courseId!), courseScope(me)))
          .get()
      : undefined;
    if (!course) throw notFound('Workshop not found');
    courseId = course.id;
  }
  const studentIds = checkStudents(db, courseId, input.studentIds ?? []);
  const name = courseName(db, courseId);

  const { id, editors, alert } = db.transaction((tx) => {
    const row = tx
      .insert(videos)
      .values({
        courseId,
        sessionId,
        title: input.title,
        kind: input.kind ?? 'other',
        rawLink: input.rawLink,
        notesForEditor: input.notesForEditor ?? null,
        // The editor works on it the next day (the school's clock), unless the coach chose another day.
        dueOn: input.dueOn ?? addDays(schoolToday(c), 1),
        status: 'new',
        addedById: me.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: videos.id })
      .get();
    setStudents(tx, row.id, studentIds);
    addEvent(tx, row.id, me.id, 'added', now, { note: input.notesForEditor ?? null, link: input.rawLink });
    // Every active editor who is not an owner (and not the person adding it).
    const editors = videoTeam(tx, 'videos.edit', me.id);
    const alert: VideoAlert = { kind: 'video_new', title: 'videoNewTitle', body: 'videoNewBody', values: { title: input.title, course: name, name: me.name } };
    notifyVideo(tx, row.id, editors, alert, now);
    return { id: row.id, editors, alert };
  });
  pushVideo(c, id, editors, alert);
  return c.json<VideoStepResult>(stepResult(c, id, editors), 201);
});

/**
 * The coach who added it (still holding videos.add), a reviewer or an owner,
 * while the video is new: 403 for anyone else, 409 video_locked once the
 * editor has started.
 */
function assertMayChange(c: Context<AppEnv>, row: VideoRow) {
  const facts = videoRuleFacts(c.get('db'), row);
  if (!videoActions({ ...facts, status: 'new' }, currentUser(c)).edit) throw forbidden('Only the coach who added this video can change it');
  if (row.status !== 'new') {
    throw new ApiError(409, VIDEO_ERROR_CODES.locked, 'The editor has started on this video', undefined, { video: detailOf(c, row.id) });
  }
}

router.patch('/:id', requireAnyPermission('videos.add', 'videos.review'), async (c) => {
  const id = paramId(c);
  const input = await body(c, videoUpdateInput);
  const db = c.get('db');
  const row = visibleRow(c, id);
  assertMayChange(c, row);
  const studentIds = input.studentIds === undefined ? undefined : checkStudents(db, row.courseId, input.studentIds);
  const now = Date.now();

  const patch: Partial<typeof videos.$inferInsert> = { updatedAt: now };
  if (input.title !== undefined) patch.title = input.title;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.rawLink !== undefined) patch.rawLink = input.rawLink;
  if (input.notesForEditor !== undefined) patch.notesForEditor = input.notesForEditor ?? null;
  if (input.dueOn) patch.dueOn = input.dueOn;

  const done = db.transaction((tx) => {
    const updated = tx
      .update(videos)
      .set(patch)
      .where(and(eq(videos.id, id), eq(videos.status, 'new')))
      .returning({ id: videos.id })
      .get();
    if (!updated) return false;
    if (studentIds) setStudents(tx, id, studentIds);
    return true;
  });
  if (!done) throw moved(c, id);
  return c.json<VideoDetail>(detailOf(c, id));
});

router.delete('/:id', requireAnyPermission('videos.add', 'videos.review'), (c) => {
  const id = paramId(c);
  const row = visibleRow(c, id);
  assertMayChange(c, row);
  const gone = c.get('db').transaction((tx) => {
    const deleted = tx
      .delete(videos)
      .where(and(eq(videos.id, id), eq(videos.status, 'new')))
      .returning({ id: videos.id })
      .get();
    // Its alerts would open a page that is gone: they go too.
    if (deleted) deleteVideoAlerts(tx, [id]);
    return !!deleted;
  });
  if (!gone) throw moved(c, id);
  return c.body(null, 204);
});

// ── The editor ──────────────────────────────────────────────────────────────

/** "Start editing" (new), "Start fixing" (changes requested), or taking over from an editor who has left. */
router.post('/:id/take', requirePermission('videos.edit'), (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const row = visibleRow(c, id);
  if (!videoActions(videoRuleFacts(db, row), me).take) throw moved(c, id);
  const now = Date.now();
  const done = db.transaction((tx) => {
    const updated = tx
      .update(videos)
      .set({ status: 'editing', editorId: me.id, takenAt: now, updatedAt: now })
      // From the status it was read in (and the same editor, for a take-over): two editors can't both take it.
      .where(
        and(
          eq(videos.id, id),
          eq(videos.status, row.status),
          row.editorId === null ? sql`${videos.editorId} is null` : eq(videos.editorId, row.editorId),
        ),
      )
      .returning({ id: videos.id })
      .get();
    if (!updated) return false;
    addEvent(tx, id, me.id, 'taken', now);
    // Someone has it: "New video to edit" / "Changes needed" are done with, for every editor.
    markNotificationsReadForEveryone(tx, 'video_new', videoPath(id), now);
    markNotificationsReadForEveryone(tx, 'video_changes', videoPath(id), now);
    return true;
  });
  if (!done) throw moved(c, id);
  return c.json<VideoStepResult>(stepResult(c, id, []));
});

/** "Done": the edited link (and notes for the reviewer). Every active reviewer who is not an owner is alerted. */
router.post('/:id/submit', requirePermission('videos.edit'), async (c) => {
  const id = paramId(c);
  const input = await body(c, videoSubmitInput);
  const me = currentUser(c);
  const db = c.get('db');
  const row = visibleRow(c, id);
  if (row.status !== 'editing') throw moved(c, id);
  if (!videoActions(videoRuleFacts(db, row), me).submit) throw new ApiError(403, VIDEO_ERROR_CODES.notYourEdit, 'Another editor is working on this video');
  const now = Date.now();
  const name = courseName(db, row.courseId);

  const result = db.transaction((tx) => {
    const updated = tx
      .update(videos)
      .set({ status: 'in_review', editedLink: input.editedLink, editorNotes: input.notes ?? null, submittedAt: now, updatedAt: now })
      .where(and(eq(videos.id, id), eq(videos.status, 'editing'), row.editorId === null ? sql`${videos.editorId} is null` : eq(videos.editorId, row.editorId)))
      .returning({ id: videos.id })
      .get();
    if (!updated) return null;
    addEvent(tx, id, me.id, 'submitted', now, { note: input.notes ?? null, link: input.editedLink });
    markNotificationsRead(tx, me.id, 'video_changes', videoPath(id), now);
    // "Moaty checks every edit": every active reviewer who is not an owner (and not the editor).
    const reviewers = videoTeam(tx, 'videos.review', me.id);
    const alert: VideoAlert = { kind: 'video_review', title: 'videoReviewTitle', body: 'videoReviewBody', values: { title: row.title, course: name, name: me.name } };
    notifyVideo(tx, id, reviewers, alert, now);
    return { reviewers, alert };
  });
  if (!result) throw moved(c, id);
  pushVideo(c, id, result.reviewers, result.alert);
  // Who was told — none when nobody holds the Video reviewer position yet: the screen says so.
  return c.json<VideoStepResult>(stepResult(c, id, result.reviewers));
});

// ── The reviewer ────────────────────────────────────────────────────────────

/**
 * A reviewer's decision, from `from` to `to`: the history entry, the "to
 * check" alerts done with for every reviewer, and the alert to whoever is
 * told. Allowed by the one shared rule (videoActions): never on an edit the
 * reviewer made themselves (someone holding both positions), unless an owner.
 */
async function decide(c: Context<AppEnv>, opts: { from: VideoStatus; to: VideoStatus; event: 'approved' | 'changes_requested' | 'reopened'; note: string | null }) {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const row = visibleRow(c, id);
  if (row.status !== opts.from) throw moved(c, id);
  const can = videoActions(videoRuleFacts(db, row), me);
  const allowed = opts.event === 'approved' ? can.approve : opts.event === 'reopened' ? can.reopen : can.requestChanges;
  if (!allowed) throw new ApiError(403, VIDEO_ERROR_CODES.ownEdit, 'You edited this video: another reviewer checks it');
  const now = Date.now();
  const name = courseName(db, row.courseId);

  const result = db.transaction((tx) => {
    const updated = tx
      .update(videos)
      .set({ status: opts.to, reviewerId: me.id, decidedAt: now, updatedAt: now })
      .where(and(eq(videos.id, id), eq(videos.status, opts.from)))
      .returning({ id: videos.id })
      .get();
    if (!updated) return null;
    addEvent(tx, id, me.id, opts.event, now, { note: opts.note });
    markNotificationsReadForEveryone(tx, 'video_review', videoPath(id), now);
    let recipients: VideoRecipient[];
    let alert: VideoAlert;
    if (opts.event === 'approved') {
      // The coach who added it.
      recipients = videoPerson(tx, row.addedById, me.id);
      alert = { kind: 'video_approved', title: 'videoApprovedTitle', body: 'videoApprovedBody', values: { title: row.title, course: name, name: me.name } };
    } else {
      // The editor who did it — or, when nobody is named or they can no longer edit videos (switched off, position taken away), every editor who is not an owner.
      recipients = videoChangesRecipients(tx, row.editorId, me.id);
      alert = {
        kind: 'video_changes',
        title: opts.event === 'reopened' ? 'videoReopenedTitle' : 'videoChangesTitle',
        body: 'videoChangesBody',
        values: { title: row.title, course: name, name: me.name, note: alertNote(opts.note ?? '') },
      };
    }
    notifyVideo(tx, id, recipients, alert, now);
    return { recipients, alert };
  });
  if (!result) throw moved(c, id);
  pushVideo(c, id, result.recipients, result.alert);
  return c.json<VideoStepResult>(stepResult(c, id, result.recipients));
}

/** "Approved ✓". The coach who added it is alerted. */
router.post('/:id/approve', requirePermission('videos.review'), (c) => decide(c, { from: 'in_review', to: 'approved', event: 'approved', note: null }));

/** "Needs changes", with a note (required). The editor who did it is alerted. */
router.post('/:id/request-changes', requirePermission('videos.review'), async (c) => {
  const { note } = await body(c, videoChangesInput);
  return decide(c, { from: 'in_review', to: 'changes_requested', event: 'changes_requested', note });
});

/** An approved video back to the editor, with a note (required). */
router.post('/:id/reopen', requirePermission('videos.review'), async (c) => {
  const { note } = await body(c, videoChangesInput);
  return decide(c, { from: 'approved', to: 'changes_requested', event: 'reopened', note });
});

// ── Comments ────────────────────────────────────────────────────────────────

/** A comment in the history: the coach who added it, the editors, the reviewers, owners. Answers 201 with the new entry. */
router.post('/:id/comments', async (c) => {
  const id = paramId(c);
  const { note } = await body(c, videoNoteInput);
  const me = currentUser(c);
  const db = c.get('db');
  const row = visibleRow(c, id);
  if (!videoActions(videoRuleFacts(db, row), me).comment) throw forbidden('Only the people working on this video can comment');
  const now = Date.now();
  const eventId = db.transaction((tx) => {
    const event = tx.insert(videoEvents).values({ videoId: id, userId: me.id, type: 'comment', note, createdAt: now }).returning({ id: videoEvents.id }).get();
    tx.update(videos).set({ updatedAt: now }).where(eq(videos.id, id)).run();
    return event.id;
  });
  const created = loadVideoEvents(db, id).find((e) => e.id === eventId)!;
  return c.json<VideoEvent>(created, 201);
});

export default router;
