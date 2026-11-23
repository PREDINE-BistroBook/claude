/**
 * "Call to the office" (summons table): the shape every endpoint answers
 * (SummonsView), and the summonses waiting for a person's answer — read by
 * GET /api/summons/incoming and by the 20-second poll (GET /api/chat/unread)
 * that shows the can't-miss banner.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import { SUMMONS_EXPIRY_MS, type SummonsViewStatus } from '../../shared/enums';
import type { SummonsView } from '../../shared/schemas/summons';
import type { DB } from '../db/database';
import { summons } from '../db/schema';
import { loadPersons, missingPerson } from './team';

type SummonsRow = typeof summons.$inferSelect;

/** Pending past its two hours: shown as expired, can't be answered or cancelled. */
export function isExpired(row: Pick<SummonsRow, 'status' | 'createdAt'>, now: number): boolean {
  return row.status === 'pending' && row.createdAt <= now - SUMMONS_EXPIRY_MS;
}

export function viewStatus(row: Pick<SummonsRow, 'status' | 'createdAt'>, now: number): SummonsViewStatus {
  return isExpired(row, now) ? 'expired' : row.status;
}

/** Rows → SummonsView, with both people's name and photo (one query for all of them). */
export function toSummonsViews(db: Pick<DB, 'select'>, rows: readonly SummonsRow[], now: number): SummonsView[] {
  const people = loadPersons(
    db,
    rows.flatMap((r) => [r.fromUserId, r.toUserId]),
  );
  return rows.map((r) => ({
    id: r.id,
    from: people.get(r.fromUserId) ?? missingPerson(r.fromUserId),
    to: people.get(r.toUserId) ?? missingPerson(r.toUserId),
    note: r.note,
    status: viewStatus(r, now),
    createdAt: r.createdAt,
    answeredAt: r.answeredAt,
    expiresAt: r.createdAt + SUMMONS_EXPIRY_MS,
  }));
}

/** Summonses waiting for this person's answer (pending, not expired), newest first. */
export function incomingSummons(db: Pick<DB, 'select'>, userId: number, now: number): SummonsView[] {
  const rows = db
    .select()
    .from(summons)
    .where(and(eq(summons.toUserId, userId), eq(summons.status, 'pending'), gt(summons.createdAt, now - SUMMONS_EXPIRY_MS)))
    .orderBy(desc(summons.createdAt), desc(summons.id))
    .limit(20)
    .all();
  return toSummonsViews(db, rows, now);
}
