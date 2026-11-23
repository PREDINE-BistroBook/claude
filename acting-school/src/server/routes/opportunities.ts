import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { FRESH_UPLOAD_MS } from '../../shared/schemas/chat';
import type { ListResponse } from '../../shared/schemas/common';
import { OPPORTUNITY_CASTING_TYPE, OPPORTUNITY_STATUSES, type Locale } from '../../shared/enums';
import {
  OPPORTUNITY_ERROR_CODES,
  opportunityInput,
  opportunityListQuery,
  opportunityUpdateInput,
  type Opportunity,
  type OpportunityCounts,
  type OpportunityFile,
  type OpportunityToCastingResult,
} from '../../shared/schemas/opportunities';
import { TEAM_ERROR_KEYS } from '../../shared/schemas/team';
import type { DB } from '../db/database';
import { castingFiles, castingOpportunities, castingOpportunityFiles, castings, files } from '../db/schema';
import type { AppEnv } from '../env';
import type { Conn } from '../lib/access';
import { schoolToday } from '../lib/clock';
import { ApiError, fieldError, notFound } from '../lib/errors';
import { claimUploads, releaseFiles } from '../lib/fileRefs';
import { contains, inChunks, insertBatches } from '../lib/sqlLimits';
import { loadPersons } from '../lib/team';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Casting opportunities (Part K1): what the team saw on Instagram, Facebook,
 * WhatsApp groups or websites, added by hand — no AI, nothing fetched.
 * castings.read lists and opens them (the screenshots too: their file ids go
 * only to people who may see the opportunity); castings.write adds, edits,
 * moves them between New / Interested / Applied / Dismissed, deletes them (the
 * screenshots go with them unless something else uses them) and turns one
 * into a casting (POST /:id/to-casting).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('castings.read');
const canWrite = requirePermission('castings.write');

type Row = typeof castingOpportunities.$inferSelect;
type Reader = Pick<DB, 'select'>;

function findRow(db: Reader, id: number): Row {
  const row = db.select().from(castingOpportunities).where(eq(castingOpportunities.id, id)).get();
  if (!row) throw notFound('Opportunity not found');
  return row;
}

/** Every screenshot of these opportunities, in their order. */
function filesFor(db: Reader, ids: readonly number[]): Map<number, OpportunityFile[]> {
  const rows = inChunks(ids, (part) =>
    db
      .select({
        id: castingOpportunityFiles.id,
        opportunityId: castingOpportunityFiles.opportunityId,
        fileId: castingOpportunityFiles.fileId,
        sortOrder: castingOpportunityFiles.sortOrder,
        mime: files.mime,
        name: files.originalName,
      })
      .from(castingOpportunityFiles)
      .innerJoin(files, eq(files.id, castingOpportunityFiles.fileId))
      .where(inArray(castingOpportunityFiles.opportunityId, part))
      .all(),
  );
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const out = new Map<number, OpportunityFile[]>();
  for (const r of rows) {
    const list = out.get(r.opportunityId) ?? [];
    list.push({ id: r.id, fileId: r.fileId, mime: r.mime, name: r.name });
    out.set(r.opportunityId, list);
  }
  return out;
}

function toOpportunities(db: Reader, rows: Row[]): Opportunity[] {
  const byId = filesFor(
    db,
    rows.map((r) => r.id),
  );
  const people = loadPersons(
    db,
    rows.flatMap((r) => [r.createdById, r.reviewedById]),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    details: r.details,
    projectType: r.projectType,
    roles: r.roles,
    location: r.location,
    deadline: r.deadline,
    contact: r.contact,
    link: r.link,
    source: r.source,
    asksForPayment: r.asksForPayment,
    involvesMinors: r.involvesMinors,
    status: r.status,
    castingId: r.castingId,
    files: byId.get(r.id) ?? [],
    createdBy: r.createdById === null ? null : (people.get(r.createdById) ?? null),
    reviewedBy: r.reviewedById === null ? null : (people.get(r.reviewedById) ?? null),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

const loadOne = (db: Reader, id: number): Opportunity => toOpportunities(db, [findRow(db, id)])[0]!;

/** Title, where it was seen, roles, location or notes contain the term (instr, not LIKE: lib/sqlLimits.ts). */
function searchCondition(q: string): SQL {
  const term = q.replace(/\s+/g, ' ');
  const o = castingOpportunities;
  return or(contains(o.title, term), contains(o.source, term), contains(o.roles, term), contains(o.location, term), contains(o.details, term))!;
}

/** Sets the screenshots rows of an opportunity to `claimed`, in that order (inside the write's transaction). */
function insertFiles(tx: Conn, opportunityId: number, fileIds: readonly string[]) {
  const rows = fileIds.map((fileId, i) => ({ opportunityId, fileId, sortOrder: i }));
  for (const batch of insertBatches(castingOpportunityFiles, rows)) tx.insert(castingOpportunityFiles).values(batch).run();
}

const claimOptions = (now: number) => ({ now, maxAgeMs: FRESH_UPLOAD_MS, path: ['fileIds'], message: TEAM_ERROR_KEYS.fileNotYours, imagesOnly: true });

/** Who reviewed it after a move: back to new = nobody has looked yet; any other status = the person who moved it. */
const reviewedBy = (status: Row['status'], userId: number) => (status === 'new' ? null : userId);

// ── List and counts ─────────────────────────────────────────────────────────

router.get('/', canRead, (c) => {
  const { status, q } = query(c, opportunityListQuery);
  const db = c.get('db');
  const today = schoolToday(c);
  const o = castingOpportunities;
  const rows = db
    .select()
    .from(o)
    .where(and(status ? eq(o.status, status) : undefined, q ? searchCondition(q) : undefined))
    .orderBy(
      // Still open first (the nearest deadline first), then those with no deadline, then the closed ones; newest first within each.
      sql`case when ${o.deadline} is null then 1 when ${o.deadline} < ${today} then 2 else 0 end`,
      asc(o.deadline),
      desc(o.createdAt),
      desc(o.id),
    )
    .all();
  return c.json<ListResponse<Opportunity>>({ items: toOpportunities(db, rows) });
});

router.get('/counts', canRead, (c) => {
  const rows = c
    .get('db')
    .select({ status: castingOpportunities.status, n: count() })
    .from(castingOpportunities)
    .groupBy(castingOpportunities.status)
    .all();
  const counts = Object.fromEntries(OPPORTUNITY_STATUSES.map((s) => [s, 0])) as OpportunityCounts;
  for (const r of rows) counts[r.status] = r.n;
  return c.json(counts);
});

router.get('/:id', canRead, (c) => c.json(loadOne(c.get('db'), paramId(c))));

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', canWrite, async (c) => {
  const { fileIds = [], ...input } = await body(c, opportunityInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const id = db.transaction((tx) => {
    const claimed = claimUploads(tx, me.id, fileIds, claimOptions(now));
    const status = input.status ?? 'new';
    const created = tx
      .insert(castingOpportunities)
      .values({
        ...input,
        asksForPayment: input.asksForPayment ?? false,
        involvesMinors: input.involvesMinors ?? false,
        status,
        createdById: me.id,
        reviewedById: reviewedBy(status, me.id),
      })
      .returning({ id: castingOpportunities.id })
      .get();
    insertFiles(
      tx,
      created.id,
      claimed.map((f) => f.id),
    );
    return created.id;
  });
  return c.json(loadOne(db, id), 201);
});

// ── Update ──────────────────────────────────────────────────────────────────

router.patch('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const { fileIds, ...input } = await body(c, opportunityUpdateInput);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof input>;
  const removed = db.transaction((tx) => {
    const current = findRow(tx, id);
    const set: Partial<typeof castingOpportunities.$inferInsert> = { ...changes };
    if (changes.status && changes.status !== current.status) set.reviewedById = reviewedBy(changes.status, me.id);
    else delete set.status;
    let gone: string[] = [];
    if (fileIds) {
      if (new Set(fileIds).size !== fileIds.length) throw fieldError(['fileIds'], TEAM_ERROR_KEYS.fileNotYours);
      const existing = tx
        .select({ fileId: castingOpportunityFiles.fileId })
        .from(castingOpportunityFiles)
        .where(eq(castingOpportunityFiles.opportunityId, id))
        .all()
        .map((r) => r.fileId);
      const kept = new Set(existing);
      // Ids already on this opportunity stay; anything else must be a fresh, unused upload of the caller's.
      claimUploads(
        tx,
        me.id,
        fileIds.filter((f) => !kept.has(f)),
        claimOptions(now),
      );
      gone = existing.filter((f) => !fileIds.includes(f));
      tx.delete(castingOpportunityFiles).where(eq(castingOpportunityFiles.opportunityId, id)).run();
      insertFiles(tx, id, fileIds);
      // A change to the screenshots alone still counts as a change.
      set.updatedAt = now;
    }
    if (Object.keys(set).length) tx.update(castingOpportunities).set(set).where(eq(castingOpportunities.id, id)).run();
    return gone;
  });
  await releaseFiles(db, c.get('files'), removed);
  return c.json(loadOne(db, id));
});

// ── Delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const fileIds = db
    .select({ fileId: castingOpportunityFiles.fileId })
    .from(castingOpportunityFiles)
    .where(eq(castingOpportunityFiles.opportunityId, id))
    .all()
    .map((r) => r.fileId);
  // Its screenshot rows go with it (ON DELETE CASCADE); the stored files too, unless something else (its casting) uses them.
  const deleted = db.delete(castingOpportunities).where(eq(castingOpportunities.id, id)).returning({ id: castingOpportunities.id }).get();
  if (!deleted) throw notFound('Opportunity not found');
  await releaseFiles(db, c.get('files'), fileIds);
  return c.body(null, 204);
});

// ── Turn into a casting ─────────────────────────────────────────────────────

/** The words the casting's notes are written with, in the language of the person turning it. */
const NOTE_LABELS: Record<Locale, { roles: string; link: string; contact: string; source: string; minors: string; payment: string }> = {
  en: {
    roles: 'Roles',
    link: 'Link',
    contact: 'Contact',
    source: 'Seen on',
    minors: 'Children or teenagers are involved.',
    payment: 'Careful: the post asks the actors for money.',
  },
  ar: {
    roles: 'الأدوار',
    link: 'الرابط',
    contact: 'للتواصل',
    source: 'شوهدت على',
    minors: 'يشارك فيها أطفال أو مراهقون.',
    payment: 'انتبه: المنشور يطلب من الممثلين مالًا.',
  },
};

/** The casting's description: the opportunity's notes, then its roles, link, contact and source, one per line. */
export function castingNotesFrom(o: Pick<Row, 'details' | 'roles' | 'link' | 'contact' | 'source' | 'involvesMinors' | 'asksForPayment'>, locale: Locale): string | null {
  const l = NOTE_LABELS[locale];
  const lines = [
    o.asksForPayment ? l.payment : null,
    o.involvesMinors ? l.minors : null,
    o.roles ? `${l.roles}: ${o.roles}` : null,
    o.link ? `${l.link}: ${o.link}` : null,
    o.contact ? `${l.contact}: ${o.contact}` : null,
    o.source ? `${l.source}: ${o.source}` : null,
  ].filter((x): x is string => !!x);
  const parts = [o.details, lines.join('\n')].filter((x): x is string => !!x);
  return parts.length ? parts.join('\n\n') : null;
}

router.post('/:id/to-casting', canWrite, (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const db = c.get('db');
  const now = Date.now();
  const castingId = db.transaction((tx) => {
    const o = findRow(tx, id);
    // casting_id is set to null when that casting is deleted, so a value here is a casting that exists.
    if (o.castingId !== null) {
      throw new ApiError(409, OPPORTUNITY_ERROR_CODES.alreadyCasting, 'This opportunity is already a casting', undefined, { castingId: o.castingId });
    }
    const casting = tx
      .insert(castings)
      .values({
        title: o.title,
        type: o.projectType ? OPPORTUNITY_CASTING_TYPE[o.projectType] : null,
        location: o.location,
        submissionDeadline: o.deadline,
        description: castingNotesFrom(o, me.locale),
        status: 'open',
        createdBy: me.id,
      })
      .returning({ id: castings.id })
      .get();
    // The post's screenshots go to the casting's files as well (the same people see both: castings.read).
    const shots = tx
      .select({ fileId: castingOpportunityFiles.fileId })
      .from(castingOpportunityFiles)
      .where(eq(castingOpportunityFiles.opportunityId, id))
      .orderBy(asc(castingOpportunityFiles.sortOrder), asc(castingOpportunityFiles.id))
      .all();
    const fileRows = shots.map((s) => ({ castingId: casting.id, fileId: s.fileId, kind: 'photo' as const, caption: null, uploadedById: me.id, createdAt: now }));
    for (const batch of insertBatches(castingFiles, fileRows)) tx.insert(castingFiles).values(batch).run();
    // Someone has looked at it now: a new one moves to Interested.
    const status = o.status === 'new' ? 'interested' : o.status;
    tx.update(castingOpportunities)
      .set({ castingId: casting.id, status, reviewedById: status === o.status ? o.reviewedById : me.id })
      .where(eq(castingOpportunities.id, id))
      .run();
    return casting.id;
  });
  return c.json<OpportunityToCastingResult>({ castingId }, 201);
});

export default router;
