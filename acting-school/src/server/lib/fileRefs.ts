/**
 * Who uses a stored file, and freeing files nothing uses any more.
 *
 * A file row (files) can be pointed at from many places — a student's or a
 * worker's photo, talent photos, the website, workshop and casting files, chat
 * attachments — and sometimes from two at once (an accepted casting
 * application's photos become the talent profile's). So deleting a record
 * never deletes its file directly: it calls releaseFile / releaseFiles (or
 * takeUnusedFiles inside its own transaction, then deleteStoredFiles), which
 * delete the file (row, then bytes) only when nothing in FILE_REFERENCES (nor
 * the site's hero photo) still points at it. So a file goes with its last
 * user, whichever record that is: an accepted applicant's photos are deleted
 * for good whether the application or the talent profile is deleted first.
 *
 * FILE_REFERENCES must name every column with a foreign key to files:
 * tests/api/files.test.ts compares it with the schema.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { ALLOWED_IMAGE_TYPES, fileKindOf, UNUSED_UPLOAD_MAX_AGE_MS } from '../../shared/schemas/files';
import type { FileKind } from '../../shared/enums';
import type { DB } from '../db/database';
import {
  castingApplicationPhotos,
  castingFiles,
  courseFiles,
  files,
  messageAttachments,
  siteCoaches,
  siteWorkshops,
  students,
  talent,
  talentPhotos,
  users,
} from '../db/schema';
import type { Conn } from './access';
import { fieldError } from './errors';
import type { FileStore } from './fileStore';
import { getSiteContent } from './siteContent';
import { chunk, IN_LIST_CHUNK, inChunks } from './sqlLimits';

/**
 * Every column holding a file id (a foreign key to files.id). `site: true`
 * marks the public website's own columns (a coach's photo, a workshop's
 * cover): what they point at can be served to anyone (/site/media/:id), so a
 * file used from any *other* column here must never be put there
 * (fileUsedOffSite).
 */
export const FILE_REFERENCES: readonly { table: SQLiteTable; column: SQLiteColumn; site?: true }[] = [
  { table: users, column: users.photoFileId },
  { table: students, column: students.photoFileId },
  { table: talent, column: talent.headshotFileId },
  { table: talentPhotos, column: talentPhotos.fileId },
  { table: siteCoaches, column: siteCoaches.photoFileId, site: true },
  { table: siteWorkshops, column: siteWorkshops.coverFileId, site: true },
  { table: castingApplicationPhotos, column: castingApplicationPhotos.fileId },
  { table: courseFiles, column: courseFiles.fileId },
  { table: castingFiles, column: castingFiles.fileId },
  { table: messageAttachments, column: messageAttachments.fileId },
];

type Reader = Pick<DB, 'select' | 'get'>;

/** Is anything pointing at this file (FILE_REFERENCES, or the site's hero photo in settings)? One statement, 10 parameters. */
export function fileInUse(db: Reader, fileId: string): boolean {
  const checks: SQL[] = FILE_REFERENCES.map(({ table, column }) => sql`exists (select 1 from ${table} where ${column} = ${fileId})`);
  const row = db.get<{ used: number }>(sql`select (${sql.join(checks, sql` or `)}) as used`);
  if (row?.used) return true;
  return getSiteContent(db).heroFileId === fileId;
}

/**
 * Is this file used by something other than the public website: someone's
 * photo (a team member's, a student's, a talent's headshot or gallery photo),
 * a casting application's photo, a workshop's or a casting's file, a chat
 * attachment? Such a file is private to the people who may see that record,
 * so it can't be made a site image (assertSiteImage in lib/siteContent.ts) —
 * the same list of places as fileInUse, minus the site's own. One statement.
 */
export function fileUsedOffSite(db: Reader, fileId: string): boolean {
  const checks: SQL[] = FILE_REFERENCES.filter((r) => !r.site).map(({ table, column }) => sql`exists (select 1 from ${table} where ${column} = ${fileId})`);
  return !!db.get<{ used: number }>(sql`select (${sql.join(checks, sql` or `)}) as used`)?.used;
}

/**
 * Inside a transaction: delete the rows of those files nothing uses any more
 * and return their storage keys — delete those from the FileStore after the
 * transaction (deleteStoredFiles). Files still used somewhere are kept.
 */
export function takeUnusedFiles(tx: Conn & Reader, fileIds: readonly string[]): string[] {
  const unused = [...new Set(fileIds)].filter((id) => !fileInUse(tx, id));
  if (!unused.length) return [];
  const rows = inChunks(unused, (part) => tx.select({ id: files.id, storageKey: files.storageKey }).from(files).where(inArray(files.id, part)).all());
  for (const part of chunk(rows.map((r) => r.id), IN_LIST_CHUNK)) tx.delete(files).where(inArray(files.id, part)).run();
  return rows.map((r) => r.storageKey);
}

/** WHERE (over files), one condition per FILE_REFERENCES column: nothing there points at the file. The site's hero photo is checked beside them (it lives in settings). */
const nothingRefersToIt = (): SQL[] => FILE_REFERENCES.map(({ table, column }) => sql`not exists (select 1 from ${table} where ${column} = ${files.id})`);

/**
 * Inside a transaction: delete the row of **every** file nothing uses (the
 * same FILE_REFERENCES check, and the site's hero photo as stored right now)
 * and return their storage keys for deleteStoredFiles — for a clean-out that
 * has just deleted the records themselves (db/clearDemo.ts). One statement,
 * whatever the number of files. Unlike sweepUnusedUploads it has no age
 * limit: an upload that is still waiting to be attached goes too.
 */
export function takeEveryUnusedFile(tx: Conn & Reader): string[] {
  const hero = getSiteContent(tx).heroFileId;
  return tx
    .delete(files)
    .where(and(hero ? ne(files.id, hero) : undefined, ...nothingRefersToIt()))
    .returning({ storageKey: files.storageKey })
    .all()
    .map((r) => r.storageKey);
}

/** After the transaction: remove the bytes. A failure only leaves an orphan (logged), never a dangling row. */
export async function deleteStoredFiles(store: FileStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await store.delete(key).catch((err) => console.error(`Could not delete stored file ${key}`, err));
  }
}

/** Files looked at per sweep (each needs one fileInUse check). */
export const SWEEP_BATCH = 20;

/**
 * Delete staff uploads older than UNUSED_UPLOAD_MAX_AGE_MS that were never
 * attached anywhere (picked, then removed before sending; a form left
 * unsaved). At most SWEEP_BATCH per call, oldest first, so it can run as new
 * uploads come in (POST /api/files) without holding up the request. Files
 * with no uploader (the website's casting applications) are left to their
 * own clean-up. Returns how many were deleted.
 */
export async function sweepUnusedUploads(db: DB, store: FileStore, now: number): Promise<number> {
  const unreferenced = nothingRefersToIt();
  const hero = getSiteContent(db).heroFileId;
  const keys = db.transaction((tx) => {
    const candidates = tx
      .select({ id: files.id })
      .from(files)
      .where(and(isNotNull(files.uploadedBy), lt(files.createdAt, now - UNUSED_UPLOAD_MAX_AGE_MS), hero ? ne(files.id, hero) : undefined, ...unreferenced))
      .orderBy(asc(files.createdAt))
      .limit(SWEEP_BATCH)
      .all();
    // takeUnusedFiles checks each one again (fileInUse) before deleting anything.
    return candidates.length ? takeUnusedFiles(tx, candidates.map((r) => r.id)) : [];
  });
  await deleteStoredFiles(store, keys);
  return keys.length;
}

/** Delete these files (rows, then bytes) unless something still uses them. Returns how many were deleted. */
export async function releaseFiles(db: DB, store: FileStore, fileIds: readonly (string | null | undefined)[]): Promise<number> {
  const ids = fileIds.filter((id): id is string => !!id);
  if (!ids.length) return 0;
  const keys = db.transaction((tx) => takeUnusedFiles(tx, ids));
  await deleteStoredFiles(store, keys);
  return keys.length;
}

/** Delete one file (row, then bytes) unless something still uses it. True when it was deleted. */
export async function releaseFile(db: DB, store: FileStore, fileId: string | null | undefined): Promise<boolean> {
  return (await releaseFiles(db, store, [fileId])) > 0;
}

// ── Claiming uploads ────────────────────────────────────────────────────────

/** An upload being attached somewhere (a chat message, a workshop, a casting, a profile photo). */
export interface ClaimedFile {
  id: string;
  mime: string;
  size: number;
  name: string | null;
  kind: FileKind;
}

/**
 * The files a person may attach: each one they uploaded themselves within the
 * last `maxAgeMs`, not used anywhere yet (so a file id seen elsewhere can't be
 * copied into a place more people can see), and an image when `imagesOnly`.
 * Throws a 400 field error on `path` otherwise (also for repeats). Call inside
 * the write's transaction so nothing changes in between.
 */
export function claimUploads(
  tx: Conn & Reader,
  uploaderId: number,
  fileIds: readonly string[],
  opts: { now: number; maxAgeMs: number; path: (string | number)[]; message: string; imagesOnly?: boolean },
): ClaimedFile[] {
  if (new Set(fileIds).size !== fileIds.length) throw fieldError(opts.path, opts.message);
  if (!fileIds.length) return [];
  const rows = inChunks(fileIds, (part) =>
    tx
      .select({ id: files.id, mime: files.mime, size: files.size, name: files.originalName })
      .from(files)
      .where(and(inArray(files.id, part), eq(files.uploadedBy, uploaderId), gte(files.createdAt, opts.now - opts.maxAgeMs)))
      .all(),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return fileIds.map((id) => {
    const row = byId.get(id);
    if (!row || fileInUse(tx, id) || (opts.imagesOnly && !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(row.mime))) {
      throw fieldError(opts.path, opts.message);
    }
    return { ...row, kind: fileKindOf(row.mime) };
  });
}
