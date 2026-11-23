/**
 * The public website's data, shared by the staff API (routes/site.ts) and the
 * public pages (src/server/site/):
 * - the site content object (settings key 'site'): getSiteContent / saveSiteContent;
 * - what the public sees: loadPublicWorkshops / findPublicWorkshop / loadPublicCoaches;
 * - which uploaded files are public (served by /site/media/:id): isPublicFile / findPublicFile;
 * - the form-token secret (settings key 'siteFormSecret'), created at startup;
 * - the public URLs (GET /api/site/summary).
 */
import { and, asc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { LOCALES, type CourseLevel, type Locale } from '../../shared/enums';
import type { ScheduleSlot } from '../../shared/schemas/courses';
import { DEFAULT_SITE_CONTENT, siteContent as siteContentSchema, type Bilingual, type SiteContent, type SiteContentParsed, type SiteLink, type SiteUrls } from '../../shared/schemas/site';
import type { DB } from '../db/database';
import { castingApplicationPhotos, courses, files, settings, siteCoaches, siteWorkshops } from '../db/schema';
import { sitePaths } from '../site/paths';
import { loadCourseListItems } from './classSessions';
import { fieldError } from './errors';
import { IMAGE_MIME_TYPES } from './images';

/** Settings key of the site content object. */
export const SITE_SETTING = 'site';
/** Settings key of the HMAC secret behind the public forms' tokens (lib/siteForms.ts). */
export const SITE_FORM_SECRET_SETTING = 'siteFormSecret';

type Reader = Pick<DB, 'select'>;

// ── Site content ────────────────────────────────────────────────────────────

const cloneDefaults = (): SiteContent => JSON.parse(JSON.stringify(DEFAULT_SITE_CONTENT)) as SiteContent;

/** A new link id: 12 hex characters. */
const newLinkId = () => randomUUID().replace(/-/g, '').slice(0, 12);

/** Links with a unique id each (a missing or repeated one gets a new id). */
function withLinkIds(links: readonly { id: string | null; label: Bilingual; url: string; visible: boolean }[]): SiteLink[] {
  const seen = new Set<string>();
  return links.map((l) => {
    let linkId = l.id && !seen.has(l.id) ? l.id : newLinkId();
    while (seen.has(linkId)) linkId = newLinkId();
    seen.add(linkId);
    return { id: linkId, label: { en: l.label.en, ar: l.label.ar }, url: l.url, visible: l.visible };
  });
}

/**
 * Stored JSON → SiteContent. Validated with the same schema as PUT; a part that
 * no longer validates (e.g. written by an older version) falls back to its
 * default instead of breaking the site.
 */
function fromStored(value: unknown): SiteContent {
  const whole = siteContentSchema.safeParse(value);
  if (whole.success) return { ...whole.data, links: withLinkIds(whole.data.links) };
  const out = cloneDefaults() as unknown as Record<string, unknown>;
  const stored = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  for (const [key, field] of Object.entries(siteContentSchema.shape)) {
    const r = (field as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(stored[key]);
    if (r.success) out[key] = r.data;
  }
  const content = out as unknown as SiteContent;
  return { ...content, links: withLinkIds(content.links as SiteContentParsed['links']) };
}

/** The site content; without a 'site' key: empty texts, no contact lines, the casting call closed (DEFAULT_SITE_CONTENT). */
export function getSiteContent(db: Reader): SiteContent {
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, SITE_SETTING)).get();
  return row ? fromStored(row.value) : cloneDefaults();
}

/**
 * Store the whole object (already validated with `siteContent`); new links get
 * an id. Returns what was stored. Callers check heroFileId first (assertSiteImage).
 */
export function saveSiteContent(db: Pick<DB, 'insert'>, content: SiteContentParsed | SiteContent): SiteContent {
  const stored: SiteContent = {
    tagline: { ...content.tagline },
    about: { ...content.about },
    address: { ...content.address },
    mapUrl: content.mapUrl,
    instagram: content.instagram,
    whatsappWorkshops: content.whatsappWorkshops,
    whatsappCasting: content.whatsappCasting,
    phone: content.phone,
    email: content.email,
    heroFileId: content.heroFileId,
    castingCall: { open: content.castingCall.open, intro: { ...content.castingCall.intro }, lookingFor: { ...content.castingCall.lookingFor } },
    links: withLinkIds(content.links),
  };
  db.insert(settings)
    .values({ key: SITE_SETTING, value: stored })
    .onConflictDoUpdate({ target: settings.key, set: { value: stored } })
    .run();
  return stored;
}

/** Has the site content ever been saved (the 'site' key exists)? */
export function hasSiteContent(db: Reader): boolean {
  return !!db.select({ key: settings.key }).from(settings).where(eq(settings.key, SITE_SETTING)).get();
}

// ── Images used by the site ─────────────────────────────────────────────────

/** Is this file one of a casting application's photos? Those are never public. */
export function isApplicationPhoto(db: Reader, fileId: string): boolean {
  return !!db.select({ id: castingApplicationPhotos.id }).from(castingApplicationPhotos).where(eq(castingApplicationPhotos.fileId, fileId)).get();
}

/**
 * A file staff want to show on the site (hero, coach photo, workshop cover):
 * it must exist, be an image and not be a casting application's photo —
 * otherwise a field error on `path` (same answer for each, no oracle).
 */
export function assertSiteImage(db: Reader, fileId: string, path: (string | number)[]) {
  const row = db.select({ mime: files.mime }).from(files).where(eq(files.id, fileId)).get();
  if (!row || !IMAGE_MIME_TYPES.includes(row.mime) || isApplicationPhoto(db, fileId)) throw fieldError(path, 'talent:errors.fileNotFound');
}

// ── Workshops on the site ───────────────────────────────────────────────────

/**
 * WHERE (over site_workshops joined to courses): the workshop appears on the
 * public site — visible, the course active and not over (end date ≥ today).
 */
export function workshopOnSite(today: string): SQL {
  return and(eq(siteWorkshops.visible, true), eq(courses.status, 'active'), gte(courses.endDate, today))!;
}

/** What the public site shows of a workshop. Bilingual texts: an empty half is the other language's (titles fall back to the course name). */
export interface PublicWorkshop {
  courseId: number;
  title: Bilingual;
  description: Bilingual;
  price: Bilingual;
  coverFileId: string | null;
  acceptingApplications: boolean;
  level: CourseLevel | null;
  startDate: string;
  endDate: string;
  /** Weekly slots (weekday 0 = Sunday), sorted. */
  schedule: ScheduleSlot[];
  /** The coach: the shown site coach linked to the course's teacher, else the teacher's name in both languages; null without a teacher. */
  coach: Bilingual | null;
}

/** Fill an empty half with the other one. */
export function fillBilingual(b: Bilingual, fallback = ''): Bilingual {
  const en = b.en.trim() || b.ar.trim() || fallback;
  const ar = b.ar.trim() || b.en.trim() || fallback;
  return { en, ar };
}

/** Visible coaches' public names by linked staff account (to name a workshop's coach). */
function coachNamesByUser(db: Reader): Map<number, Bilingual> {
  const rows = db
    .select({ userId: siteCoaches.userId, nameEn: siteCoaches.nameEn, nameAr: siteCoaches.nameAr })
    .from(siteCoaches)
    .where(and(eq(siteCoaches.visible, true), sql`${siteCoaches.userId} is not null`))
    .orderBy(asc(siteCoaches.sortOrder), asc(siteCoaches.id))
    .all();
  const out = new Map<number, Bilingual>();
  for (const r of rows) if (r.userId !== null && !out.has(r.userId)) out.set(r.userId, fillBilingual({ en: r.nameEn, ar: r.nameAr }));
  return out;
}

/**
 * The workshops on the public site (or just `courseId`), in site order (then
 * start date, name). A fixed number of queries.
 */
export function loadPublicWorkshops(db: DB, today: string, courseId?: number): PublicWorkshop[] {
  const shown = sql`${courses.id} in (select sw.course_id from ${siteWorkshops} sw where sw.visible = 1)`;
  const list = loadCourseListItems(db, and(eq(courses.status, 'active'), gte(courses.endDate, today), shown, courseId !== undefined ? eq(courses.id, courseId) : undefined), today);
  if (!list.length) return [];
  const rows = new Map(
    db
      .select()
      .from(siteWorkshops)
      .where(and(eq(siteWorkshops.visible, true), courseId !== undefined ? eq(siteWorkshops.courseId, courseId) : undefined))
      .all()
      .map((r) => [r.courseId, r]),
  );
  const coaches = coachNamesByUser(db);
  const out: (PublicWorkshop & { sortOrder: number; name: string })[] = [];
  for (const c of list) {
    const r = rows.get(c.id);
    if (!r) continue;
    out.push({
      courseId: c.id,
      title: fillBilingual({ en: r.titleEn, ar: r.titleAr }, c.name),
      description: fillBilingual({ en: r.descriptionEn, ar: r.descriptionAr }),
      price: fillBilingual({ en: r.priceEn, ar: r.priceAr }),
      coverFileId: r.coverFileId,
      acceptingApplications: r.acceptingApplications,
      level: c.level,
      startDate: c.startDate,
      endDate: c.endDate,
      schedule: [...c.schedule].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
      coach: c.teacherId !== null ? (coaches.get(c.teacherId) ?? (c.teacherName ? { en: c.teacherName, ar: c.teacherName } : null)) : null,
      sortOrder: r.sortOrder,
      name: c.name,
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name) || a.courseId - b.courseId);
  return out.map(({ sortOrder: _s, name: _n, ...w }) => w);
}

/** One workshop if it appears on the public site now; null if hidden, archived, over or missing (the public 404). */
export function findPublicWorkshop(db: DB, courseId: number, today: string): PublicWorkshop | null {
  return loadPublicWorkshops(db, today, courseId)[0] ?? null;
}

// ── Coaches on the site ─────────────────────────────────────────────────────

export interface PublicCoach {
  id: number;
  name: Bilingual;
  title: Bilingual;
  bio: Bilingual;
  photoFileId: string | null;
}

/** The coaches shown on the site, in order (empty halves filled from the other language). */
export function loadPublicCoaches(db: Reader): PublicCoach[] {
  return db
    .select()
    .from(siteCoaches)
    .where(eq(siteCoaches.visible, true))
    .orderBy(asc(siteCoaches.sortOrder), asc(siteCoaches.id))
    .all()
    .map((r) => ({
      id: r.id,
      name: fillBilingual({ en: r.nameEn, ar: r.nameAr }),
      title: fillBilingual({ en: r.titleEn, ar: r.titleAr }),
      bio: fillBilingual({ en: r.bioEn, ar: r.bioAr }),
      photoFileId: r.photoFileId,
    }));
}

// ── Public files ────────────────────────────────────────────────────────────

/**
 * Is this file public on the website? Only: the site's hero photo, the photo of
 * a visible coach, or the cover of a workshop that appears on the site (on
 * `today`) — and never a casting application's photo.
 */
export function isPublicFile(db: Reader, fileId: string, today: string): boolean {
  if (isApplicationPhoto(db, fileId)) return false;
  if (getSiteContent(db).heroFileId === fileId) return true;
  const coach = db
    .select({ id: siteCoaches.id })
    .from(siteCoaches)
    .where(and(eq(siteCoaches.photoFileId, fileId), eq(siteCoaches.visible, true)))
    .get();
  if (coach) return true;
  const cover = db
    .select({ id: siteWorkshops.courseId })
    .from(siteWorkshops)
    .innerJoin(courses, eq(courses.id, siteWorkshops.courseId))
    .where(and(eq(siteWorkshops.coverFileId, fileId), workshopOnSite(today)))
    .get();
  return !!cover;
}

/**
 * What GET /site/media/:id may serve: the files row when the file is public
 * (isPublicFile) and an image; null for every other id (answer 404). Read the
 * bytes with the FileStore: files.get(row.storageKey).
 */
export function findPublicFile(db: Reader, fileId: string, today: string): { id: string; mime: string; size: number; storageKey: string } | null {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
  const row = db.select({ id: files.id, mime: files.mime, size: files.size, storageKey: files.storageKey }).from(files).where(eq(files.id, fileId)).get();
  if (!row || !IMAGE_MIME_TYPES.includes(row.mime)) return null;
  return isPublicFile(db, fileId, today) ? row : null;
}

// ── Public URLs ─────────────────────────────────────────────────────────────

/** The site's page URLs in both languages, absolute on `origin` ("https://host"). */
export function siteUrls(origin: string): Record<Locale, SiteUrls> {
  const base = origin.replace(/\/+$/, '');
  return Object.fromEntries(
    LOCALES.map((lang) => [
      lang,
      {
        home: base + sitePaths.home(lang),
        workshops: base + sitePaths.workshops(lang),
        castingCall: base + sitePaths.castingCall(lang),
        links: base + sitePaths.links(lang),
      },
    ]),
  ) as Record<Locale, SiteUrls>;
}

// ── Form-token secret ───────────────────────────────────────────────────────

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Startup (initDb): create the forms' HMAC secret once — 32 random bytes, hex — if missing. Never changes afterwards. */
export function ensureSiteFormSecret(db: Pick<DB, 'insert'>) {
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  db.insert(settings).values({ key: SITE_FORM_SECRET_SETTING, value: secret }).onConflictDoNothing().run();
}

/** The forms' HMAC secret (created if a database somehow lacks it). */
export function getSiteFormSecret(db: Pick<DB, 'select' | 'insert'>): string {
  const read = () => db.select({ value: settings.value }).from(settings).where(eq(settings.key, SITE_FORM_SECRET_SETTING)).get()?.value;
  let value = read();
  if (typeof value !== 'string' || value.length < 32) {
    ensureSiteFormSecret(db);
    value = read();
  }
  return String(value);
}
