/**
 * Casting applications (answers to the website's casting call): created by the
 * public form (createCastingApplication), read and decided by staff
 * (routes/castingApplications.ts: loaders, accept, delete). Photos go into the
 * FileStore like staff uploads (uploadedBy null) and are never public.
 */
import { asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ageOn } from '../../shared/dates';
import type { CastingApplicationStatus } from '../../shared/enums';
import {
  CASTING_APPLICATION_CONTACT_FIELDS,
  CASTING_APPLICATION_ERROR_CODES,
  type CastingApplicationDetail,
  type CastingApplicationInput,
  type CastingApplicationListItem,
} from '../../shared/schemas/castingApplications';
import type { SessionUser } from '../../shared/schemas/auth';
import type { ApiIssue } from '../../shared/schemas/common';
import { CASTING_PHOTO_MAX_BYTES, CASTING_PHOTOS_MAX, isMinor, normalizeInstagramHandle } from '../../shared/schemas/site';
import type { DB } from '../db/database';
import { castingApplicationPhotos, castingApplications, files, talent, talentPhotos, users } from '../db/schema';
import { hasPermission, redactContact, type Conn } from './access';
import { ApiError, notFound } from './errors';
import { deleteStoredFiles, takeUnusedFiles } from './fileRefs';
import type { FileStore } from './fileStore';
import { sniffImage } from './images';
import { phoneSearchDigits, withPhoneDigits } from './phone';
import { getSiteContent } from './siteContent';
import { contains } from './sqlLimits';

export type CastingApplicationRow = typeof castingApplications.$inferSelect;

// ── Creating (the public form) ──────────────────────────────────────────────

/**
 * One photo as received from the form: its bytes — or the form's own File /
 * Blob, read only when it is stored, so a request never holds every photo
 * twice — and the file name the browser gave, if any.
 */
export type CastingPhotoUpload = { name?: string | null } & ({ data: Uint8Array; blob?: undefined } | { blob: Blob; data?: undefined });

const photoSize = (p: CastingPhotoUpload) => (p.data ? p.data.byteLength : p.blob.size);
/** The first bytes (enough for sniffImage). */
const photoHead = async (p: CastingPhotoUpload) => (p.data ? p.data.subarray(0, 16) : new Uint8Array(await p.blob.slice(0, 16).arrayBuffer()));
const photoBytes = async (p: CastingPhotoUpload) => p.data ?? new Uint8Array(await p.blob.arrayBuffer());

interface CheckedPhoto {
  id: string;
  storageKey: string;
  mime: string;
  size: number;
  name: string | null;
  source: CastingPhotoUpload;
}

/**
 * Every problem with the photos of one application, as field issues on
 * `photos` (none, too many) or `photos.<i>` (over 6 MB, not a real
 * JPEG/PNG/WebP by its first bytes) — and what would be stored when there is
 * none. The public form calls it before answering, so one round trip reports
 * the photos' problems together with the other fields'.
 */
export async function checkCastingPhotos(photos: readonly CastingPhotoUpload[]): Promise<{ issues: ApiIssue[]; checked: CheckedPhoto[] }> {
  const issue = (path: (string | number)[], message: string): ApiIssue => ({ path, code: 'custom', message });
  if (!photos.length) return { issues: [issue(['photos'], 'site:errors.photoRequired')], checked: [] };
  if (photos.length > CASTING_PHOTOS_MAX) return { issues: [issue(['photos'], 'site:errors.tooManyPhotos')], checked: [] };
  const issues: ApiIssue[] = [];
  const checked: CheckedPhoto[] = [];
  for (const [i, p] of photos.entries()) {
    const size = photoSize(p);
    if (size > CASTING_PHOTO_MAX_BYTES) {
      issues.push(issue(['photos', i], 'site:errors.photoTooLarge'));
      continue;
    }
    const kind = size ? sniffImage(await photoHead(p)) : null;
    if (!kind) {
      issues.push(issue(['photos', i], 'site:errors.photoType'));
      continue;
    }
    const id = randomUUID();
    checked.push({ id, storageKey: `${id}.${kind.ext}`, mime: kind.mime, size, name: p.name?.slice(0, 200) || null, source: p });
  }
  return { issues, checked };
}

/**
 * Store a casting application from the public form: `input` is the output of
 * castingApplicationInput(today) (src/shared/schemas/castingApplications.ts),
 * `photos` 1–3 images (the first is the headshot), each at most 6 MB and a real
 * JPEG/PNG/WebP by its first bytes.
 *
 * Throws (store nothing): ApiError 409 'casting_call_closed' when the casting
 * call is closed (the route should answer its 410 page before parsing at all);
 * a 400 field error on `photos` ('site:errors.photoRequired' / 'site:errors.tooManyPhotos')
 * or on `photos.<i>` ('site:errors.photoTooLarge' / 'site:errors.photoType').
 * `opts.beforeStore(bytes)` runs once everything is checked and immediately
 * before the first photo is written, with the total size of the photos about
 * to be kept: the public form counts its limits there (and throws to refuse).
 * The photos are written to the FileStore first (async, one at a time), then
 * every row in one transaction; if that fails, the stored photos are deleted again.
 */
export async function createCastingApplication(
  db: DB,
  fileStore: FileStore,
  input: CastingApplicationInput,
  photos: readonly CastingPhotoUpload[],
  opts: { beforeStore?: (photoBytes: number) => void } = {},
): Promise<{ id: number }> {
  if (!getSiteContent(db).castingCall.open) {
    throw new ApiError(409, CASTING_APPLICATION_ERROR_CODES.castingCallClosed, 'There is no open casting call');
  }
  const { issues, checked } = await checkCastingPhotos(photos);
  if (issues.length) throw new ApiError(400, 'validation', 'Some fields are missing or invalid', issues);
  opts.beforeStore?.(checked.reduce((n, p) => n + p.size, 0));

  const stored: string[] = [];
  try {
    for (const p of checked) {
      await fileStore.put(p.storageKey, await photoBytes(p.source), p.mime);
      stored.push(p.storageKey);
    }
    const id = db.transaction((tx) => {
      for (const p of checked) {
        tx.insert(files).values({ id: p.id, originalName: p.name, mime: p.mime, size: p.size, storageKey: p.storageKey, uploadedBy: null }).run();
      }
      const app = tx
        .insert(castingApplications)
        .values(
          withPhoneDigits({
            firstName: input.firstName,
            lastName: input.lastName,
            gender: input.gender,
            dateOfBirth: input.dateOfBirth,
            phone: input.phone,
            email: input.email,
            city: input.city,
            heightCm: input.heightCm,
            languages: input.languages,
            skills: input.skills,
            experience: input.experience,
            links: input.links,
            message: input.message,
            guardianName: input.guardianName,
            guardianPhone: input.guardianPhone,
            guardianConsent: input.guardianConsent,
            locale: input.locale,
            status: 'new' as const,
          }),
        )
        .returning({ id: castingApplications.id })
        .get();
      checked.forEach((p, i) => {
        tx.insert(castingApplicationPhotos).values({ applicationId: app.id, fileId: p.id, sortOrder: i }).run();
      });
      return app.id;
    });
    return { id };
  } catch (err) {
    for (const key of stored) await fileStore.delete(key).catch(() => {});
    throw err;
  }
}

// ── Reading (staff) ─────────────────────────────────────────────────────────

/**
 * Names and city; the phone (digits in any format) and email too only for
 * someone who may see them — talent.contact — since otherwise a search would
 * reveal them. instr, not LIKE (lib/sqlLimits.ts).
 */
export function applicationSearch(q: string, countryCode: string, withContact: boolean): SQL {
  const term = q.replace(/\s+/g, ' ');
  const parts: SQL[] = [
    contains(castingApplications.firstName, term),
    contains(castingApplications.lastName, term),
    contains(sql`(${castingApplications.firstName} || ' ' || ${castingApplications.lastName})`, term),
    contains(sql`(${castingApplications.lastName} || ' ' || ${castingApplications.firstName})`, term),
    contains(castingApplications.city, term),
  ];
  if (withContact) {
    parts.push(contains(castingApplications.phone, term), contains(castingApplications.email, term));
    for (const digits of phoneSearchDigits(term, countryCode) ?? []) parts.push(contains(castingApplications.phoneDigits, digits));
  }
  return or(...parts)!;
}

/** The first photo of the application in the outer query (explicit table name: see access.ts notAnOwner). */
const firstPhotoFileId = sql<string | null>`(select cap.file_id from ${castingApplicationPhotos} cap where cap.application_id = "casting_applications"."id" order by cap.sort_order, cap.id limit 1)`;

/** The list, newest first. `today` (the school's) gives ages and the minor flag. */
export function loadApplicationListItems(db: Pick<DB, 'select'>, where: SQL | undefined, today: string): CastingApplicationListItem[] {
  return db
    .select({
      id: castingApplications.id,
      firstName: castingApplications.firstName,
      lastName: castingApplications.lastName,
      gender: castingApplications.gender,
      dateOfBirth: castingApplications.dateOfBirth,
      city: castingApplications.city,
      status: castingApplications.status,
      createdAt: castingApplications.createdAt,
      photoFileId: firstPhotoFileId,
    })
    .from(castingApplications)
    .where(where)
    .orderBy(desc(castingApplications.createdAt), desc(castingApplications.id))
    .all()
    .map(({ dateOfBirth, ...r }) => ({ ...r, age: ageOn(dateOfBirth, today), minor: isMinor(dateOfBirth, today) }));
}

export function findApplication(db: Pick<DB, 'select'>, id: number): CastingApplicationRow {
  const row = db.select().from(castingApplications).where(eq(castingApplications.id, id)).get();
  if (!row) throw notFound('Application not found');
  return row;
}

/** Everything about one application; contact fields only for talent.contact. */
export function loadApplicationDetail(db: Pick<DB, 'select'>, id: number, viewer: Pick<SessionUser, 'permissions'>, today: string): CastingApplicationDetail {
  const r = findApplication(db, id);
  const photos = db
    .select({ fileId: castingApplicationPhotos.fileId })
    .from(castingApplicationPhotos)
    .where(eq(castingApplicationPhotos.applicationId, id))
    .orderBy(asc(castingApplicationPhotos.sortOrder), asc(castingApplicationPhotos.id))
    .all();
  const reviewer = r.reviewedById !== null ? db.select({ name: users.name }).from(users).where(eq(users.id, r.reviewedById)).get() : undefined;
  return redactContact(
    {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      age: ageOn(r.dateOfBirth, today),
      minor: isMinor(r.dateOfBirth, today),
      phone: r.phone as string | null,
      email: r.email,
      city: r.city,
      heightCm: r.heightCm,
      languages: r.languages ?? [],
      skills: r.skills ?? [],
      experience: r.experience,
      links: (r.links ?? []) as string[] | null,
      message: r.message,
      guardianName: r.guardianName,
      guardianPhone: r.guardianPhone,
      guardianConsent: r.guardianConsent,
      locale: r.locale,
      status: r.status,
      reviewedById: r.reviewedById,
      reviewedByName: reviewer?.name ?? null,
      reviewedAt: r.reviewedAt,
      talentId: r.talentId,
      photos,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    },
    CASTING_APPLICATION_CONTACT_FIELDS,
    hasPermission(viewer, 'talent.contact'),
  );
}

/** How many applications are in each status (the tabs). */
export function applicationCounts(db: Pick<DB, 'select'>): Record<CastingApplicationStatus, number> {
  const rows = db
    .select({ status: castingApplications.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(castingApplications)
    .groupBy(castingApplications.status)
    .all();
  const out: Record<CastingApplicationStatus, number> = { new: 0, reviewing: 0, accepted: 0, declined: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

// ── Accepting: the application becomes a talent profile ─────────────────────

const isInstagramLink = (url: string) => /^https:\/\/(www\.)?instagram\.com\//i.test(url);

/**
 * Accepted, with its talent profile still there: nothing about it can change
 * any more. An accepted application whose profile was deleted (talent_id set
 * null by the foreign key) is open again — it can be added once more, marked
 * reviewing or declined — instead of being stuck with Delete as its only way out.
 */
export const isOnRoster = (r: Pick<CastingApplicationRow, 'status' | 'talentId'>) => r.status === 'accepted' && r.talentId !== null;

/**
 * The talent's notes: what the application had that talent has no field for.
 * Never the guardian's phone or the raw links: on the application those are
 * contact fields (talent.contact), while a talent's notes are read by everyone
 * with talent.read. They stay on the application, linked through talent_id.
 */
function talentNotes(r: CastingApplicationRow, today: string): string {
  const lines = [`From a website casting application (${today}).`];
  if (r.experience) lines.push('', `Experience: ${r.experience}`);
  if (r.message) lines.push('', `Message: ${r.message}`);
  if (r.guardianName || r.guardianPhone) {
    const consent = r.guardianConsent ? ' (consent given)' : '';
    lines.push('', r.guardianName ? `Guardian: ${r.guardianName}${consent}. Their phone number is on the casting application.` : `Guardian${consent}: their phone number is on the casting application.`);
  }
  return lines.join('\n').slice(0, 5000);
}

/**
 * "Add to roster", in the caller's transaction: create the talent profile from
 * the application (names, gender, date of birth, phone, email, city, height,
 * languages, skills; an Instagram link → instagram, the first other link →
 * showreel; experience, message and the guardian's name in the notes — not the
 * guardian's phone or the other links, which stay on the application), attach
 * the same photo files (the first is the headshot), then mark the application
 * accepted by `reviewerId`. 409 application_accepted when it already has a
 * talent profile (isOnRoster); one whose profile was deleted since can be
 * added again. Returns the talent id.
 */
export function acceptApplication(tx: Conn, id: number, reviewerId: number, today: string): number {
  const r = findApplication(tx, id);
  if (isOnRoster(r)) throw new ApiError(409, CASTING_APPLICATION_ERROR_CODES.alreadyAccepted, 'This application is already on the roster');
  const photos = tx
    .select({ fileId: castingApplicationPhotos.fileId })
    .from(castingApplicationPhotos)
    .where(eq(castingApplicationPhotos.applicationId, id))
    .orderBy(asc(castingApplicationPhotos.sortOrder), asc(castingApplicationPhotos.id))
    .all();
  const links = r.links ?? [];
  const instagramLink = links.find(isInstagramLink);
  const instagram = instagramLink ? normalizeInstagramHandle(instagramLink) : null;
  const showreel = links.find((l) => !isInstagramLink(l)) ?? null;
  const created = tx
    .insert(talent)
    .values({
      firstName: r.firstName,
      lastName: r.lastName,
      gender: r.gender,
      dateOfBirth: r.dateOfBirth,
      // talent has no phone_digits column (only students and leads keep one): the phone is stored normalised as it came.
      phone: r.phone,
      email: r.email,
      city: r.city,
      heightCm: r.heightCm,
      languages: r.languages ?? [],
      skills: r.skills ?? [],
      instagram: typeof instagram === 'string' ? instagram.slice(0, 100) : null,
      showreelUrl: showreel,
      headshotFileId: photos[0]?.fileId ?? null,
      status: 'active',
      representedSince: today,
      notes: talentNotes(r, today),
    })
    .returning({ id: talent.id })
    .get();
  photos.forEach((p, i) => {
    tx.insert(talentPhotos)
      .values({ talentId: created.id, fileId: p.fileId, caption: i === 0 ? 'Headshot' : null, sortOrder: i })
      .onConflictDoNothing()
      .run();
  });
  tx.update(castingApplications)
    .set({ status: 'accepted', talentId: created.id, reviewedById: reviewerId, reviewedAt: Date.now() })
    .where(eq(castingApplications.id, id))
    .run();
  return created.id;
}

// ── Deleting ────────────────────────────────────────────────────────────────

/**
 * Delete an application and the files of its photos that nothing else uses
 * (files already linked to a talent profile — an accepted application's — are
 * kept; they go when that profile or photo is deleted, so whichever of the two
 * is deleted last takes the photos with it). "Used" is lib/fileRefs.ts's one
 * list of places (FILE_REFERENCES and the site's main photo), the same check
 * every other delete goes through. Rows in one transaction, then the bytes
 * from the FileStore (a failed delete there only leaves an orphan, never a
 * dangling row). 404 when missing.
 */
export async function deleteApplication(db: DB, fileStore: FileStore, id: number): Promise<{ deletedFiles: number }> {
  const keys = db.transaction((tx) => {
    findApplication(tx, id);
    const fileIds = tx
      .select({ fileId: castingApplicationPhotos.fileId })
      .from(castingApplicationPhotos)
      .where(eq(castingApplicationPhotos.applicationId, id))
      .all()
      .map((p) => p.fileId);
    // The application's own photo rows go first, so what still points at a file after that is somebody else.
    tx.delete(castingApplicationPhotos).where(eq(castingApplicationPhotos.applicationId, id)).run();
    tx.delete(castingApplications).where(eq(castingApplications.id, id)).run();
    return takeUnusedFiles(tx, fileIds);
  });
  await deleteStoredFiles(fileStore, keys);
  return { deletedFiles: keys.length };
}
