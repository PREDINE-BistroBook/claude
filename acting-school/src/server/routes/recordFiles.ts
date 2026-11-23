import { and, desc, eq, exists, or } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { FRESH_UPLOAD_MS } from '../../shared/schemas/chat';
import type { ListResponse } from '../../shared/schemas/common';
import { recordFileInput, type RecordFile } from '../../shared/schemas/files';
import { TEAM_ERROR_KEYS } from '../../shared/schemas/team';
import type { SessionUser } from '../../shared/schemas/auth';
import type { DB } from '../db/database';
import { castingFiles, castings, classSessions, courseFiles, courses, files } from '../db/schema';
import type { AppEnv } from '../env';
import { courseScope, hasPermission } from '../lib/access';
import { forbidden, notFound } from '../lib/errors';
import { claimUploads, releaseFile } from '../lib/fileRefs';
import { loadPersons } from '../lib/team';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Photos and documents attached to a record (G1):
 * - a workshop's "Photos & files" — /api/courses/:courseId/files: seen by
 *   whoever can see the workshop (courses.read and the class scope: without
 *   classes.all only your own workshops, anything else a 404); added with
 *   courses.write or by the workshop's coach (its teacher, or the substitute on
 *   one of its sessions — so coaches can add rehearsal photos); deleted with
 *   courses.write or by whoever added it;
 * - a casting's "Files" — /api/castings/:castingId/files: castings.read to
 *   see, castings.write to add or delete.
 * The file itself is an upload of the caller's from the last hour that isn't
 * used anywhere yet (claimUploads); deleting the record frees the stored file
 * when nothing else uses it (releaseFile). File ids only ever go to people who
 * can see the record (the capability rule in CLAUDE.md).
 */

type FileRow = {
  id: number;
  fileId: string;
  kind: 'photo' | 'document';
  caption: string | null;
  uploadedById: number | null;
  createdAt: number;
  name: string | null;
  mime: string;
  size: number;
};

function toRecordFiles(db: DB, rows: FileRow[], mayDelete: (r: FileRow) => boolean): RecordFile[] {
  const people = loadPersons(
    db,
    rows.map((r) => r.uploadedById),
  );
  return rows.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    kind: r.kind,
    caption: r.caption,
    name: r.name,
    mime: r.mime,
    size: r.size,
    uploadedBy: r.uploadedById === null ? null : (people.get(r.uploadedById) ?? null),
    createdAt: r.createdAt,
    canDelete: mayDelete(r),
  }));
}

// ── Workshop files ──────────────────────────────────────────────────────────

export const courseFileRoutes = new Hono<AppEnv>();
courseFileRoutes.use(requireAuth);
const readCourses = requirePermission('courses.read');

/** The course, if this person may see it (courses.read + class scope); a 404 otherwise. */
function requireVisibleCourse(c: Context<AppEnv>, user: SessionUser): number {
  const id = paramId(c, 'courseId');
  const row = c
    .get('db')
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, id), courseScope(user)))
    .get();
  if (!row) throw notFound('Class not found');
  return row.id;
}

/** The workshop's coach: its teacher, or the substitute on any of its sessions. */
function isCourseCoach(db: DB, userId: number, courseId: number): boolean {
  return !!db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        or(
          eq(courses.teacherId, userId),
          exists(
            db
              .select({ id: classSessions.id })
              .from(classSessions)
              .where(and(eq(classSessions.courseId, courseId), eq(classSessions.teacherId, userId))),
          ),
        ),
      ),
    )
    .get();
}

const courseFileColumns = {
  id: courseFiles.id,
  fileId: courseFiles.fileId,
  kind: courseFiles.kind,
  caption: courseFiles.caption,
  uploadedById: courseFiles.uploadedById,
  createdAt: courseFiles.createdAt,
  name: files.originalName,
  mime: files.mime,
  size: files.size,
};

const mayDeleteCourseFile = (me: SessionUser) => (r: Pick<FileRow, 'uploadedById'>) => hasPermission(me, 'courses.write') || r.uploadedById === me.id;

courseFileRoutes.get('/', readCourses, (c) => {
  const me = currentUser(c);
  const courseId = requireVisibleCourse(c, me);
  const db = c.get('db');
  const rows = db
    .select(courseFileColumns)
    .from(courseFiles)
    .innerJoin(files, eq(files.id, courseFiles.fileId))
    .where(eq(courseFiles.courseId, courseId))
    .orderBy(desc(courseFiles.createdAt), desc(courseFiles.id))
    .all();
  return c.json<ListResponse<RecordFile>>({ items: toRecordFiles(db, rows, mayDeleteCourseFile(me)) });
});

courseFileRoutes.post('/', readCourses, async (c) => {
  const me = currentUser(c);
  const courseId = requireVisibleCourse(c, me);
  const input = await body(c, recordFileInput);
  const db = c.get('db');
  if (!hasPermission(me, 'courses.write') && !isCourseCoach(db, me.id, courseId)) throw forbidden('Only the workshop’s coach or someone who can edit workshops can add files');
  const now = Date.now();
  const id = db.transaction((tx) => {
    const [file] = claimUploads(tx, me.id, [input.fileId], { now, maxAgeMs: FRESH_UPLOAD_MS, path: ['fileId'], message: TEAM_ERROR_KEYS.fileNotYours });
    return tx
      .insert(courseFiles)
      .values({ courseId, fileId: file!.id, kind: file!.kind, caption: input.caption ?? null, uploadedById: me.id, createdAt: now })
      .returning({ id: courseFiles.id })
      .get().id;
  });
  const row = db.select(courseFileColumns).from(courseFiles).innerJoin(files, eq(files.id, courseFiles.fileId)).where(eq(courseFiles.id, id)).get()!;
  return c.json(toRecordFiles(db, [row], mayDeleteCourseFile(me))[0]!, 201);
});

courseFileRoutes.delete('/:fileRecordId', readCourses, async (c) => {
  const me = currentUser(c);
  const courseId = requireVisibleCourse(c, me);
  const recordId = paramId(c, 'fileRecordId');
  const db = c.get('db');
  const row = db
    .select({ fileId: courseFiles.fileId, uploadedById: courseFiles.uploadedById })
    .from(courseFiles)
    .where(and(eq(courseFiles.id, recordId), eq(courseFiles.courseId, courseId)))
    .get();
  if (!row) throw notFound('File not found');
  if (!mayDeleteCourseFile(me)(row)) throw forbidden('Only whoever added it or someone who can edit workshops can delete it');
  db.delete(courseFiles).where(eq(courseFiles.id, recordId)).run();
  await releaseFile(db, c.get('files'), row.fileId);
  return c.body(null, 204);
});

// ── Casting files ───────────────────────────────────────────────────────────

export const castingFileRoutes = new Hono<AppEnv>();
castingFileRoutes.use(requireAuth);
const readCastings = requirePermission('castings.read');
const writeCastings = requirePermission('castings.write');

function requireCasting(c: Context<AppEnv>): number {
  const id = paramId(c, 'castingId');
  const row = c.get('db').select({ id: castings.id }).from(castings).where(eq(castings.id, id)).get();
  if (!row) throw notFound('Casting not found');
  return row.id;
}

const castingFileColumns = {
  id: castingFiles.id,
  fileId: castingFiles.fileId,
  kind: castingFiles.kind,
  caption: castingFiles.caption,
  uploadedById: castingFiles.uploadedById,
  createdAt: castingFiles.createdAt,
  name: files.originalName,
  mime: files.mime,
  size: files.size,
};

const mayDeleteCastingFile = (me: SessionUser) => () => hasPermission(me, 'castings.write');

castingFileRoutes.get('/', readCastings, (c) => {
  const castingId = requireCasting(c);
  const db = c.get('db');
  const rows = db
    .select(castingFileColumns)
    .from(castingFiles)
    .innerJoin(files, eq(files.id, castingFiles.fileId))
    .where(eq(castingFiles.castingId, castingId))
    .orderBy(desc(castingFiles.createdAt), desc(castingFiles.id))
    .all();
  return c.json<ListResponse<RecordFile>>({ items: toRecordFiles(db, rows, mayDeleteCastingFile(currentUser(c))) });
});

castingFileRoutes.post('/', writeCastings, async (c) => {
  const castingId = requireCasting(c);
  const input = await body(c, recordFileInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const id = db.transaction((tx) => {
    const [file] = claimUploads(tx, me.id, [input.fileId], { now, maxAgeMs: FRESH_UPLOAD_MS, path: ['fileId'], message: TEAM_ERROR_KEYS.fileNotYours });
    return tx
      .insert(castingFiles)
      .values({ castingId, fileId: file!.id, kind: file!.kind, caption: input.caption ?? null, uploadedById: me.id, createdAt: now })
      .returning({ id: castingFiles.id })
      .get().id;
  });
  const row = db.select(castingFileColumns).from(castingFiles).innerJoin(files, eq(files.id, castingFiles.fileId)).where(eq(castingFiles.id, id)).get()!;
  return c.json(toRecordFiles(db, [row], mayDeleteCastingFile(me))[0]!, 201);
});

castingFileRoutes.delete('/:fileRecordId', writeCastings, async (c) => {
  const castingId = requireCasting(c);
  const recordId = paramId(c, 'fileRecordId');
  const db = c.get('db');
  const deleted = db
    .delete(castingFiles)
    .where(and(eq(castingFiles.id, recordId), eq(castingFiles.castingId, castingId)))
    .returning({ fileId: castingFiles.fileId })
    .get();
  if (!deleted) throw notFound('File not found');
  await releaseFile(db, c.get('files'), deleted.fileId);
  return c.body(null, 204);
});
