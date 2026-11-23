/**
 * Which uploaded files are still used, and letting go of those that aren't.
 * A files row is referenced by: a student's photo, a talent's headshot and
 * gallery photos, a casting application's photos, a site coach's photo, a
 * workshop's cover on the site and the site's main photo (settings 'site').
 * When the last of those goes, the file goes too — a deleted profile must not
 * leave its photos behind where no screen can remove them.
 */
import { eq, inArray } from 'drizzle-orm';
import { castingApplicationPhotos, files, siteCoaches, siteWorkshops, students, talent, talentPhotos } from '../db/schema';
import type { Conn } from './access';
import { getSiteContent } from './siteContent';
import { chunk, IN_LIST_CHUNK, inChunks } from './sqlLimits';

/** Does anything still reference this file? */
export function fileInUse(db: Pick<Conn, 'select'>, fileId: string): boolean {
  const used = (q: { get(): unknown }) => !!q.get();
  return (
    used(db.select({ id: talentPhotos.id }).from(talentPhotos).where(eq(talentPhotos.fileId, fileId))) ||
    used(db.select({ id: talent.id }).from(talent).where(eq(talent.headshotFileId, fileId))) ||
    used(db.select({ id: students.id }).from(students).where(eq(students.photoFileId, fileId))) ||
    used(db.select({ id: castingApplicationPhotos.id }).from(castingApplicationPhotos).where(eq(castingApplicationPhotos.fileId, fileId))) ||
    used(db.select({ id: siteCoaches.id }).from(siteCoaches).where(eq(siteCoaches.photoFileId, fileId))) ||
    used(db.select({ id: siteWorkshops.courseId }).from(siteWorkshops).where(eq(siteWorkshops.coverFileId, fileId))) ||
    getSiteContent(db).heroFileId === fileId
  );
}

/**
 * In the caller's transaction, **after** it removed what pointed at them:
 * delete the files rows among `fileIds` that nothing references any more.
 * Returns their storage keys — delete the bytes from the FileStore once the
 * transaction is done (`for (const key of keys) await files.delete(key).catch(() => {})`;
 * a failed delete there only leaves an orphan, never a dangling row).
 */
export function releaseUnusedFiles(tx: Conn, fileIds: readonly (string | null | undefined)[]): string[] {
  const unused = [...new Set(fileIds.filter((id): id is string => !!id))].filter((id) => !fileInUse(tx, id));
  if (!unused.length) return [];
  const rows = inChunks(unused, (part) => tx.select({ id: files.id, storageKey: files.storageKey }).from(files).where(inArray(files.id, part)).all());
  for (const part of chunk(rows.map((r) => r.id), IN_LIST_CHUNK)) tx.delete(files).where(inArray(files.id, part)).run();
  return rows.map((r) => r.storageKey);
}
