import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { upgradeBuiltInPositions } from '../lib/access';
import type { FileStore } from '../lib/fileStore';
import { ensureSiteFormSecret } from '../lib/siteContent';
import type { DB } from './database';
import * as t from './schema';

/** Every table, children before parents (so no cascade has work left to do). */
export const WIPE_ORDER: SQLiteTable[] = [
  t.cafeOrderItems,
  t.cafeOrders,
  t.cafeItems,
  t.pushSubscriptions,
  t.notifications,
  t.summons,
  t.messageAttachments,
  t.messages,
  t.conversationMembers,
  t.conversations,
  t.castingOpportunityFiles,
  t.castingOpportunities,
  t.castingFiles,
  t.courseFiles,
  t.castingApplicationPhotos,
  t.castingApplications,
  t.siteWorkshops,
  t.siteCoaches,
  t.rateLimits,
  t.interviews,
  t.leadActivities,
  t.leads,
  t.submissions,
  t.castingRoles,
  t.castings,
  t.talentPhotos,
  t.talent,
  t.attendance,
  t.classSessions,
  t.enrollments,
  t.courseSlots,
  t.courses,
  t.students,
  t.fileChunks,
  t.files,
  t.authSessions,
  t.userPositions,
  t.positions,
  t.users,
  t.settings,
  t.loginFailures,
];

/**
 * Delete every row (one transaction), then the stored files, then put the
 * built-in positions back — a fresh, empty school that asks for first-run
 * setup again. Demo deployments only (POST /api/admin/reset with
 * ALLOW_DEMO_RESET=true). Ids keep counting from where they were.
 */
export async function wipeAllData(db: DB, files: FileStore): Promise<{ deletedFiles: number }> {
  const keys = db.transaction((tx) => {
    const stored = tx.select({ key: t.files.storageKey }).from(t.files).all().map((r) => r.key);
    // Profile photos point at files from users, which go after files (users.photo_file_id has no ON DELETE action in the database).
    tx.update(t.users).set({ photoFileId: null }).run();
    for (const table of WIPE_ORDER) tx.delete(table).run();
    return stored;
  });
  upgradeBuiltInPositions(db);
  ensureSiteFormSecret(db);
  // After the rows: a file that fails to delete is only an orphan, never a dangling row.
  for (const key of keys) await files.delete(key);
  return { deletedFiles: keys.length };
}
