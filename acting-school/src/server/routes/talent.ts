import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ApiIssue, ListResponse } from '../../shared/schemas/common';
import {
  TALENT_CONTACT_FIELDS,
  talentInput,
  talentListQuery,
  talentPhotoInput,
  talentPhotoUpdateInput,
  talentUpdateInput,
  type Talent,
  type TalentDetail,
  type TalentListItem,
  type TalentPhoto,
  type TalentTags,
} from '../../shared/schemas/talent';
import type { DB } from '../db/database';
import { castingRoles, castings, files, students, submissions, talent, talentPhotos } from '../db/schema';
import type { AppEnv } from '../env';
import type { SessionUser } from '../../shared/schemas/auth';
import { schoolToday } from '../lib/clock';
import { hasPermission, maySeeStudent, redactContact, withoutContact } from '../lib/access';
import { ApiError, conflict, notFound } from '../lib/errors';
import { IMAGE_MIME_TYPES } from '../lib/images';
import { contains } from '../lib/sqlLimits';
import { body, paramId, query } from '../lib/validate';
import { currentUser, requireAuth, requirePermission } from '../middleware/auth';

/**
 * Talent: the agency's roster. talent.read shows it, talent.write changes it.
 * Phone and email need talent.contact: without it they come back null
 * (contactHidden: true) and are ignored on writes (search never looks at them).
 * A talent may be linked to one student (talent.student_id is unique). The
 * link follows student access: only someone who may open that student
 * (students.read, and the student in their class scope) sees it (studentId,
 * student) or can make it — to anyone else a student they can't see is as
 * unknown as a missing one. Photos are attached after the profile exists; the
 * primary headshot is always one of the talent's own photos.
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);

const canRead = requirePermission('talent.read');
const canWrite = requirePermission('talent.write');

type TalentRow = typeof talent.$inferSelect;
/** The database or an open transaction — helpers run inside either. */
type Conn = DB | Parameters<Parameters<DB['transaction']>[0]>[0];
type PhotoRow = typeof talentPhotos.$inferSelect;

const seesContact = (user: SessionUser) => hasPermission(user, 'talent.contact');

/** The profile's linked student, if this person may see them (null otherwise, or when not linked). */
function visibleStudentId(db: Conn, r: Pick<TalentRow, 'studentId'>, user: SessionUser): number | null {
  return r.studentId !== null && maySeeStudent(db, user, r.studentId) ? r.studentId : null;
}

function toTalent(db: Conn, r: TalentRow, user: SessionUser): Talent {
  return redactContact(
    {
    id: r.id,
    studentId: visibleStudentId(db, r, user),
    firstName: r.firstName,
    lastName: r.lastName,
    stageName: r.stageName,
    email: r.email,
    phone: r.phone,
    dateOfBirth: r.dateOfBirth,
    gender: r.gender,
    playingAgeMin: r.playingAgeMin,
    playingAgeMax: r.playingAgeMax,
    heightCm: r.heightCm,
    eyeColor: r.eyeColor,
    hairColor: r.hairColor,
    city: r.city,
    languages: r.languages ?? [],
    skills: r.skills ?? [],
    showreelUrl: r.showreelUrl,
    instagram: r.instagram,
    headshotFileId: r.headshotFileId,
    status: r.status,
    representedSince: r.representedSince,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    },
    TALENT_CONTACT_FIELDS,
    seesContact(user),
  );
}

function toPhoto(r: PhotoRow): TalentPhoto {
  return { id: r.id, fileId: r.fileId, caption: r.caption, sortOrder: r.sortOrder };
}

/** 400 'validation' with one field issue — the same shape zod failures produce. */
function fieldError(field: string, message: string): ApiError {
  const issue: ApiIssue = { path: [field], code: 'custom', message };
  return new ApiError(400, 'validation', 'Some fields are missing or invalid', [issue]);
}

function findTalent(db: Conn, id: number): TalentRow {
  const row = db.select().from(talent).where(eq(talent.id, id)).get();
  if (!row) throw notFound('Talent not found');
  return row;
}

/** Tags are compared case-insensitively everywhere (filters, de-duplication). */
const tagKey = (s: string) => s.trim().toLowerCase();

/** Drop repeated tags ("Singing", "singing") keeping the first spelling. */
function uniqueTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return tags;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tagKey(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** People paste "@handle" or a profile link; store the bare handle. */
function normalizeInstagram(v: string | null | undefined): string | null | undefined {
  if (v == null) return v;
  const handle = v
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/[/?#].*$/, '')
    .trim();
  return handle || null;
}

/**
 * Linking a student: they must exist and be someone this person may see
 * (otherwise the same field error on studentId — no oracle), and must not
 * already be on the roster under another profile (409 student_already_talent).
 */
function assertStudentLinkable(db: Conn, user: SessionUser, studentId: number, exceptTalentId?: number) {
  if (!maySeeStudent(db, user, studentId)) throw fieldError('studentId', 'talent:errors.studentNotFound');
  const linked = db.select({ id: talent.id }).from(talent).where(eq(talent.studentId, studentId)).get();
  if (linked && linked.id !== exceptTalentId) {
    throw new ApiError(409, 'student_already_talent', 'This student is already on the talent roster');
  }
}

/** Names and stage name contain the term (instr, not LIKE: lib/sqlLimits.ts). */
function searchCondition(q: string): SQL {
  const term = q.replace(/\s+/g, ' ');
  return or(
    contains(talent.firstName, term),
    contains(talent.lastName, term),
    contains(talent.stageName, term),
    contains(sql`(${talent.firstName} || ' ' || ${talent.lastName})`, term),
    contains(sql`(${talent.lastName} || ' ' || ${talent.firstName})`, term),
  )!;
}

/**
 * The latest birth date for someone who is at least `years` old today, as
 * "YYYY-MM-DD". ageOn(dob) >= years  ⇔  dob <= birthDateBound(years).
 * Plain string comparison, so it also works across 29 February.
 */
function birthDateBound(years: number, today: string): string {
  const [y, m, d] = today.split('-') as [string, string, string];
  return `${String(Number(y) - years).padStart(4, '0')}-${m}-${d}`;
}

/**
 * Who can play `age` (on the school's `today`): a playing range that contains it (a missing end is open),
 * or — for talent without any playing range — an actual age within ±1 year.
 */
function ageCondition(age: number, today: string): SQL {
  const inRange = and(
    or(isNotNull(talent.playingAgeMin), isNotNull(talent.playingAgeMax)),
    or(isNull(talent.playingAgeMin), lte(talent.playingAgeMin, age)),
    or(isNull(talent.playingAgeMax), gte(talent.playingAgeMax, age)),
  );
  const byActualAge = and(
    isNull(talent.playingAgeMin),
    isNull(talent.playingAgeMax),
    isNotNull(talent.dateOfBirth),
    // actual age >= age - 1 …
    lte(talent.dateOfBirth, birthDateBound(age - 1, today)),
    // … and actual age <= age + 1 (i.e. not yet age + 2).
    gt(talent.dateOfBirth, birthDateBound(age + 2, today)),
  );
  return or(inRange, byActualAge)!;
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', canRead, (c) => {
  const { q, status, gender, age, skill, language, studentId } = query(c, talentListQuery);
  const db = c.get('db');
  // Filtering by a student you can't see finds nothing (it would reveal whether they're on the roster).
  if (studentId && !maySeeStudent(db, currentUser(c), studentId)) return c.json<ListResponse<TalentListItem>>({ items: [] });

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(talent.status, status));
  if (gender) conditions.push(eq(talent.gender, gender));
  if (studentId) conditions.push(eq(talent.studentId, studentId));
  if (q) conditions.push(searchCondition(q));
  if (age !== undefined) conditions.push(ageCondition(age, schoolToday(c)));

  let items: TalentListItem[] = db
    .select({
      id: talent.id,
      firstName: talent.firstName,
      lastName: talent.lastName,
      stageName: talent.stageName,
      gender: talent.gender,
      dateOfBirth: talent.dateOfBirth,
      playingAgeMin: talent.playingAgeMin,
      playingAgeMax: talent.playingAgeMax,
      heightCm: talent.heightCm,
      city: talent.city,
      headshotFileId: talent.headshotFileId,
      skills: talent.skills,
      languages: talent.languages,
      status: talent.status,
    })
    .from(talent)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${talent.lastName} collate nocase`, sql`${talent.firstName} collate nocase`, asc(talent.id))
    .all();

  // Tag filters run here rather than in SQL: JavaScript lower-cases every
  // script (SQLite's lower() only knows ASCII), and rosters are small.
  if (skill) {
    const key = tagKey(skill);
    items = items.filter((t) => t.skills.some((s) => tagKey(s) === key));
  }
  if (language) {
    const key = tagKey(language);
    items = items.filter((t) => t.languages.some((l) => tagKey(l) === key));
  }

  const res: ListResponse<TalentListItem> = { items };
  return c.json(res);
});

// ── Tags (registered before /:id) ───────────────────────────────────────────

/** Distinct tags, case-insensitively; each shown in its most common spelling. */
function distinctTags(lists: string[][]): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const list of lists) {
    for (const raw of list) {
      const tag = raw.trim();
      if (!tag) continue;
      const key = tagKey(tag);
      const spellings = groups.get(key) ?? new Map<string, number>();
      spellings.set(tag, (spellings.get(tag) ?? 0) + 1);
      groups.set(key, spellings);
    }
  }
  const out: string[] = [];
  for (const spellings of groups.values()) {
    const [best] = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.push(best![0]);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

router.get('/tags', canRead, (c) => {
  const rows = c.get('db').select({ skills: talent.skills, languages: talent.languages }).from(talent).all();
  const res: TalentTags = {
    skills: distinctTags(rows.map((r) => r.skills ?? [])),
    languages: distinctTags(rows.map((r) => r.languages ?? [])),
  };
  return c.json(res);
});

// ── Create ──────────────────────────────────────────────────────────────────

router.post('/', canWrite, async (c) => {
  const me = currentUser(c);
  const input = withoutContact(await body(c, talentInput), TALENT_CONTACT_FIELDS, seesContact(me));
  if (input.headshotFileId) throw fieldError('headshotFileId', 'talent:errors.headshotOnCreate');
  const db = c.get('db');

  const created = db.transaction((tx) => {
    if (input.studentId) assertStudentLinkable(tx, me, input.studentId);
    return tx
      .insert(talent)
      .values({
        ...input,
        headshotFileId: null,
        instagram: normalizeInstagram(input.instagram),
        languages: uniqueTags(input.languages) ?? [],
        skills: uniqueTags(input.skills) ?? [],
        status: input.status ?? 'active',
      })
      .returning()
      .get();
  });
  return c.json(toTalent(db, created, me), 201);
});

// ── Detail ──────────────────────────────────────────────────────────────────

router.get('/:id', canRead, (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const row = findTalent(db, id);

  const photos = db
    .select()
    .from(talentPhotos)
    .where(eq(talentPhotos.talentId, id))
    .orderBy(asc(talentPhotos.sortOrder), asc(talentPhotos.id))
    .all()
    .map(toPhoto);

  const subs: TalentDetail['submissions'] = db
    .select({
      id: submissions.id,
      status: submissions.status,
      castingId: castings.id,
      castingTitle: castings.title,
      roleId: castingRoles.id,
      roleName: castingRoles.name,
      auditionAt: submissions.auditionAt,
      updatedAt: submissions.updatedAt,
    })
    .from(submissions)
    .innerJoin(castingRoles, eq(castingRoles.id, submissions.roleId))
    .innerJoin(castings, eq(castings.id, castingRoles.castingId))
    .where(eq(submissions.talentId, id))
    .orderBy(desc(submissions.updatedAt), desc(submissions.id))
    .all();

  const me = currentUser(c);
  const studentId = visibleStudentId(db, row, me);
  const student =
    studentId !== null
      ? (db
          .select({ id: students.id, firstName: students.firstName, lastName: students.lastName })
          .from(students)
          .where(eq(students.id, studentId))
          .get() ?? null)
      : null;

  const res: TalentDetail = { ...toTalent(db, row, me), photos, submissions: subs, student };
  return c.json(res);
});

// ── Update ──────────────────────────────────────────────────────────────────

router.patch('/:id', canWrite, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  const existing = findTalent(db, id);
  const me = currentUser(c);
  const input = withoutContact(await body(c, talentUpdateInput), TALENT_CONTACT_FIELDS, seesContact(me));

  // The range rule applies to the profile as it will be saved, not just to this request.
  const min = input.playingAgeMin !== undefined ? input.playingAgeMin : existing.playingAgeMin;
  const max = input.playingAgeMax !== undefined ? input.playingAgeMax : existing.playingAgeMax;
  if (min != null && max != null && max < min) throw fieldError('playingAgeMax', 'errors.rangeOrder');

  if (input.headshotFileId) {
    const own = db
      .select({ id: talentPhotos.id })
      .from(talentPhotos)
      .where(and(eq(talentPhotos.talentId, id), eq(talentPhotos.fileId, input.headshotFileId)))
      .get();
    if (!own) throw fieldError('headshotFileId', 'talent:errors.headshotNotPhoto');
  }

  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof talent.$inferInsert>;
  if (input.instagram !== undefined) patch.instagram = normalizeInstagram(input.instagram);
  if (input.languages !== undefined) patch.languages = uniqueTags(input.languages);
  if (input.skills !== undefined) patch.skills = uniqueTags(input.skills);
  if (!Object.keys(patch).length) return c.json(toTalent(db, existing, me));

  const updated = db.transaction((tx) => {
    // Checked even when it's the current link: that answer must not tell someone who can't see the student which one it is.
    if (input.studentId) assertStudentLinkable(tx, me, input.studentId, id);
    return tx.update(talent).set(patch).where(eq(talent.id, id)).returning().get();
  });
  if (!updated) throw notFound('Talent not found');
  return c.json(toTalent(db, updated, me));
});

// ── Delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', canWrite, (c) => {
  const id = paramId(c);
  // Photos and submissions cascade. Image files stay: a student may share them.
  const deleted = c.get('db').delete(talent).where(eq(talent.id, id)).returning({ id: talent.id }).get();
  if (!deleted) throw notFound('Talent not found');
  return c.body(null, 204);
});

// ── Photos ──────────────────────────────────────────────────────────────────

function findPhoto(db: Conn, talentId: number, photoId: number): PhotoRow {
  const row = db
    .select()
    .from(talentPhotos)
    .where(and(eq(talentPhotos.id, photoId), eq(talentPhotos.talentId, talentId)))
    .get();
  if (!row) throw notFound('Photo not found');
  return row;
}

router.post('/:id/photos', canWrite, async (c) => {
  const id = paramId(c);
  const db = c.get('db');
  findTalent(db, id);
  const input = await body(c, talentPhotoInput);

  const created = db.transaction((tx) => {
    // An uploaded image (uploads can also be documents).
    const file = tx.select({ mime: files.mime }).from(files).where(eq(files.id, input.fileId)).get();
    if (!file || !IMAGE_MIME_TYPES.includes(file.mime)) throw fieldError('fileId', 'talent:errors.fileNotFound');
    const dup = tx
      .select({ id: talentPhotos.id })
      .from(talentPhotos)
      .where(and(eq(talentPhotos.talentId, id), eq(talentPhotos.fileId, input.fileId)))
      .get();
    if (dup) throw conflict('This photo is already in the gallery');

    const maxOrder = tx
      .select({ n: sql<number | null>`max(${talentPhotos.sortOrder})` })
      .from(talentPhotos)
      .where(eq(talentPhotos.talentId, id))
      .get()?.n;
    const photo = tx
      .insert(talentPhotos)
      .values({ talentId: id, fileId: input.fileId, caption: input.caption ?? null, sortOrder: maxOrder == null ? 0 : maxOrder + 1 })
      .returning()
      .get();
    // The first photo becomes the headshot.
    tx.update(talent).set({ headshotFileId: input.fileId }).where(and(eq(talent.id, id), isNull(talent.headshotFileId))).run();
    return photo;
  });
  return c.json(toPhoto(created), 201);
});

router.patch('/:id/photos/:photoId', canWrite, async (c) => {
  const id = paramId(c);
  const photoId = paramId(c, 'photoId');
  const db = c.get('db');
  findTalent(db, id);
  const existing = findPhoto(db, id, photoId);
  const input = await body(c, talentPhotoUpdateInput);

  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof talentPhotos.$inferInsert>;
  if (!Object.keys(patch).length) return c.json(toPhoto(existing));
  const updated = db.update(talentPhotos).set(patch).where(eq(talentPhotos.id, photoId)).returning().get();
  return c.json(toPhoto(updated!));
});

router.delete('/:id/photos/:photoId', canWrite, (c) => {
  const id = paramId(c);
  const photoId = paramId(c, 'photoId');
  const db = c.get('db');

  db.transaction((tx) => {
    const t = tx.select({ headshotFileId: talent.headshotFileId }).from(talent).where(eq(talent.id, id)).get();
    if (!t) throw notFound('Talent not found');
    const photo = findPhoto(tx, id, photoId);
    tx.delete(talentPhotos).where(eq(talentPhotos.id, photoId)).run();
    if (t.headshotFileId === photo.fileId) {
      // The headshot moves to the first remaining photo, or none.
      const next = tx
        .select({ fileId: talentPhotos.fileId })
        .from(talentPhotos)
        .where(eq(talentPhotos.talentId, id))
        .orderBy(asc(talentPhotos.sortOrder), asc(talentPhotos.id))
        .get();
      tx.update(talent).set({ headshotFileId: next?.fileId ?? null }).where(eq(talent.id, id)).run();
    }
  });
  return c.body(null, 204);
});

export default router;
