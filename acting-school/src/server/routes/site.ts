import { and, asc, eq, gte, max, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SessionUser } from '../../shared/schemas/auth';
import type { ListResponse } from '../../shared/schemas/common';
import type { CourseListItem } from '../../shared/schemas/courses';
import {
  siteCoachInput,
  siteCoachUpdateInput,
  siteContent,
  siteOrderInput,
  siteWorkshopInput,
  type SiteCoach,
  type SiteContent,
  type SiteSummary,
  type SiteWorkshop,
} from '../../shared/schemas/site';
import type { DB } from '../db/database';
import { castingApplications, courses, leads, positions, siteCoaches, siteWorkshops, userPositions, users } from '../db/schema';
import type { AppEnv } from '../env';
import { isVisibleActiveStaff } from '../lib/access';
import { loadCourseListItems } from '../lib/classSessions';
import { schoolToday } from '../lib/clock';
import { fieldError, notFound } from '../lib/errors';
import { assertSiteImage, getSiteContent, saveSiteContent, siteUrls, workshopOnSite } from '../lib/siteContent';
import { body, paramId } from '../lib/validate';
import { currentUser, requireAuth, requirePermission, userCan } from '../middleware/auth';

/**
 * The public website, staff side (website.manage for every route):
 *   GET/PUT /api/site/content            the site content object (settings 'site'), `published` — the
 *                                        "Website is public" switch — included (left out of a PUT: unchanged)
 *   /api/site/coaches                    coaches shown on the site (list, create, read, edit, delete, order)
 *   /api/site/workshops                  which active/upcoming workshops the site shows, with public texts
 *   GET /api/site/summary                the Website home: counts, whether the site is public, the public URLs (the
 *                                        studio's domain when configured) and the preview URLs (/site on this host)
 * Images named here (hero, coach photos, workshop covers) become public while
 * they're on the site (lib/siteContent.ts isPublicFile); a file used anywhere
 * outside the website can't be used (assertSiteImage). Coaches' staff links follow the staff
 * rules: an owner account is invisible to non-owners (as a link it reads as
 * none, and naming one answers like a missing id).
 */
const router = new Hono<AppEnv>();
router.use(requireAuth);
router.use(requirePermission('website.manage'));

type Conn = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;

// ── Content ─────────────────────────────────────────────────────────────────

router.get('/content', (c) => c.json<SiteContent>(getSiteContent(c.get('db'))));

router.put('/content', async (c) => {
  const input = await body(c, siteContent);
  const db = c.get('db');
  const saved = db.transaction((tx) => {
    const current = getSiteContent(tx);
    // Checked when it changes (as a coach's photo and a workshop's cover are): the form sends the whole content back every time.
    if (input.heroFileId && input.heroFileId !== current.heroFileId) assertSiteImage(tx, input.heroFileId, ['heroFileId']);
    // "Website is public" changes only when it is sent: saving texts never publishes or unpublishes.
    return saveSiteContent(tx, { ...input, published: input.published ?? current.published });
  });
  return c.json<SiteContent>(saved);
});

// ── Coaches ─────────────────────────────────────────────────────────────────

type CoachRow = typeof siteCoaches.$inferSelect;

/** The linked account holds an owner position (explicit table name: the column is qualified in a join). */
const linkedToOwner = sql<number>`exists (
  select 1 from ${userPositions} cup join ${positions} cp on cp.id = cup.position_id
  where cup.user_id = "site_coaches"."user_id" and cp.is_owner = 1
)`.mapWith((v) => Boolean(v));

function loadCoaches(db: Pick<DB, 'select'>, me: SessionUser, where?: SQL): SiteCoach[] {
  return db
    .select({ coach: siteCoaches, userName: users.name, ownerLink: linkedToOwner })
    .from(siteCoaches)
    .leftJoin(users, eq(users.id, siteCoaches.userId))
    .where(where)
    .orderBy(asc(siteCoaches.sortOrder), asc(siteCoaches.id))
    .all()
    .map(({ coach, userName, ownerLink }) => {
      const hidden = !me.isOwner && Boolean(ownerLink);
      return {
        id: coach.id,
        userId: hidden ? null : coach.userId,
        userName: hidden || coach.userId === null ? null : (userName ?? null),
        nameEn: coach.nameEn,
        nameAr: coach.nameAr,
        titleEn: coach.titleEn,
        titleAr: coach.titleAr,
        bioEn: coach.bioEn,
        bioAr: coach.bioAr,
        photoFileId: coach.photoFileId,
        visible: coach.visible,
        sortOrder: coach.sortOrder,
        createdAt: coach.createdAt,
        updatedAt: coach.updatedAt,
      };
    });
}

function coachDetail(db: Pick<DB, 'select'>, me: SessionUser, id: number): SiteCoach {
  const coach = loadCoaches(db, me, eq(siteCoaches.id, id))[0];
  if (!coach) throw notFound('Coach not found');
  return coach;
}

function findCoach(db: Pick<DB, 'select'>, id: number): CoachRow {
  const row = db.select().from(siteCoaches).where(eq(siteCoaches.id, id)).get();
  if (!row) throw notFound('Coach not found');
  return row;
}

/** A linked staff account: active, and one the caller may see (a hidden owner answers like a missing id). */
function assertLinkable(db: Pick<DB, 'select'>, me: SessionUser, userId: number) {
  if (!isVisibleActiveStaff(db, me, userId)) throw fieldError(['userId'], 'errors.notFound');
}

router.get('/coaches', (c) => c.json<ListResponse<SiteCoach>>({ items: loadCoaches(c.get('db'), currentUser(c)) }));

router.post('/coaches', async (c) => {
  const me = currentUser(c);
  const input = await body(c, siteCoachInput);
  const db = c.get('db');
  const id = db.transaction((tx) => {
    if (input.userId) assertLinkable(tx, me, input.userId);
    if (input.photoFileId) assertSiteImage(tx, input.photoFileId, ['photoFileId']);
    const last = tx.select({ n: max(siteCoaches.sortOrder) }).from(siteCoaches).get()?.n;
    return tx
      .insert(siteCoaches)
      .values({
        userId: input.userId ?? null,
        nameEn: input.nameEn ?? '',
        nameAr: input.nameAr ?? '',
        titleEn: input.titleEn ?? '',
        titleAr: input.titleAr ?? '',
        bioEn: input.bioEn ?? '',
        bioAr: input.bioAr ?? '',
        photoFileId: input.photoFileId ?? null,
        visible: input.visible ?? true,
        sortOrder: last == null ? 0 : last + 1,
      })
      .returning({ id: siteCoaches.id })
      .get().id;
  });
  return c.json(coachDetail(db, me, id), 201);
});

/** Set sort_order from the order of `ids`; rows not named keep their relative order after them. */
function applyOrder(tx: Conn, table: 'coaches' | 'workshops', ids: number[]) {
  if (table === 'coaches') {
    const all = tx.select({ id: siteCoaches.id }).from(siteCoaches).orderBy(asc(siteCoaches.sortOrder), asc(siteCoaches.id)).all().map((r) => r.id);
    const known = new Set(all);
    if (ids.some((x) => !known.has(x))) throw fieldError(['ids'], 'errors.notFound');
    const order = [...ids, ...all.filter((x) => !ids.includes(x))];
    order.forEach((coachId, i) => tx.update(siteCoaches).set({ sortOrder: i }).where(eq(siteCoaches.id, coachId)).run());
    return;
  }
  const existing = new Set(tx.select({ id: courses.id }).from(courses).all().map((r) => r.id));
  if (ids.some((x) => !existing.has(x))) throw fieldError(['ids'], 'errors.notFound');
  const saved = tx
    .select({ id: siteWorkshops.courseId })
    .from(siteWorkshops)
    .orderBy(asc(siteWorkshops.sortOrder), asc(siteWorkshops.courseId))
    .all()
    .map((r) => r.id);
  const order = [...ids, ...saved.filter((x) => !ids.includes(x))];
  order.forEach((courseId, i) => {
    tx.insert(siteWorkshops)
      .values({ courseId, sortOrder: i })
      .onConflictDoUpdate({ target: siteWorkshops.courseId, set: { sortOrder: i, updatedAt: Date.now() } })
      .run();
  });
}

router.post('/coaches/order', async (c) => {
  const { ids } = await body(c, siteOrderInput);
  const db = c.get('db');
  db.transaction((tx) => applyOrder(tx, 'coaches', ids));
  return c.json<ListResponse<SiteCoach>>({ items: loadCoaches(db, currentUser(c)) });
});

router.get('/coaches/:id', (c) => c.json(coachDetail(c.get('db'), currentUser(c), paramId(c))));

router.patch('/coaches/:id', async (c) => {
  const id = paramId(c);
  const me = currentUser(c);
  const input = await body(c, siteCoachUpdateInput);
  const db = c.get('db');
  db.transaction((tx) => {
    const existing = findCoach(tx, id);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof siteCoaches.$inferInsert>;
    // Linked to an owner account the caller can't see (it reads as no link)?
    const hiddenLink = !me.isOwner && existing.userId !== null && loadCoaches(tx, me, eq(siteCoaches.id, id))[0]?.userId === null;
    // Sending the form back as it was (no link) must not unlink it.
    if (patch.userId === null && hiddenLink) delete patch.userId;
    // An unchanged visible link is left alone (the form always sends it back, even once that account was
    // deactivated). A hidden one is checked like any other id, so naming the owner behind it answers
    // exactly like a missing id — never "yes, that's the one".
    if (patch.userId && (patch.userId !== existing.userId || hiddenLink)) assertLinkable(tx, me, patch.userId);
    if (patch.photoFileId && patch.photoFileId !== existing.photoFileId) assertSiteImage(tx, patch.photoFileId, ['photoFileId']);
    const nameEn = patch.nameEn ?? existing.nameEn;
    const nameAr = patch.nameAr ?? existing.nameAr;
    if (!nameEn && !nameAr) throw fieldError(['nameEn'], 'errors.required');
    if (Object.keys(patch).length) tx.update(siteCoaches).set(patch).where(eq(siteCoaches.id, id)).run();
  });
  return c.json(coachDetail(db, me, id));
});

router.delete('/coaches/:id', (c) => {
  const id = paramId(c);
  // The photo file stays: it's an ordinary upload that may be used elsewhere.
  const deleted = c.get('db').delete(siteCoaches).where(eq(siteCoaches.id, id)).returning({ id: siteCoaches.id }).get();
  if (!deleted) throw notFound('Coach not found');
  return c.body(null, 204);
});

// ── Workshops ───────────────────────────────────────────────────────────────

type WorkshopRow = typeof siteWorkshops.$inferSelect;

function toSiteWorkshop(course: CourseListItem, row: WorkshopRow | undefined, today: string): SiteWorkshop {
  const visible = row?.visible ?? false;
  return {
    courseId: course.id,
    courseName: course.name,
    courseStatus: course.status,
    level: course.level,
    startDate: course.startDate,
    endDate: course.endDate,
    teacherId: course.teacherId,
    teacherName: course.teacherName,
    schedule: [...course.schedule].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
    saved: !!row,
    visible,
    titleEn: row?.titleEn ?? '',
    titleAr: row?.titleAr ?? '',
    descriptionEn: row?.descriptionEn ?? '',
    descriptionAr: row?.descriptionAr ?? '',
    coverFileId: row?.coverFileId ?? null,
    acceptingApplications: row?.acceptingApplications ?? true,
    sortOrder: row?.sortOrder ?? 0,
    onSite: visible && course.status === 'active' && course.endDate >= today,
  };
}

/** The site rows of these courses (all rows when the list is long: the table holds one per course at most). */
function workshopRows(db: Pick<DB, 'select'>, courseId?: number): Map<number, WorkshopRow> {
  return new Map(
    db
      .select()
      .from(siteWorkshops)
      .where(courseId !== undefined ? eq(siteWorkshops.courseId, courseId) : undefined)
      .all()
      .map((r) => [r.courseId, r]),
  );
}

/** Active courses that haven't ended, site order first (unsaved ones after), then start date and name. */
function loadSiteWorkshops(db: DB, today: string): SiteWorkshop[] {
  const rows = workshopRows(db);
  return loadCourseListItems(db, and(eq(courses.status, 'active'), gte(courses.endDate, today)), today)
    .map((course) => toSiteWorkshop(course, rows.get(course.id), today))
    .sort(
      (a, b) =>
        Number(!a.saved) - Number(!b.saved) ||
        a.sortOrder - b.sortOrder ||
        a.startDate.localeCompare(b.startDate) ||
        a.courseName.localeCompare(b.courseName) ||
        a.courseId - b.courseId,
    );
}

function siteWorkshopDetail(db: DB, courseId: number, today: string): SiteWorkshop {
  const course = loadCourseListItems(db, eq(courses.id, courseId), today)[0];
  if (!course) throw notFound('Workshop not found');
  return toSiteWorkshop(course, workshopRows(db, courseId).get(courseId), today);
}

router.get('/workshops', (c) => c.json<ListResponse<SiteWorkshop>>({ items: loadSiteWorkshops(c.get('db'), schoolToday(c)) }));

router.post('/workshops/order', async (c) => {
  const { ids } = await body(c, siteOrderInput);
  const db = c.get('db');
  db.transaction((tx) => applyOrder(tx, 'workshops', ids));
  return c.json<ListResponse<SiteWorkshop>>({ items: loadSiteWorkshops(db, schoolToday(c)) });
});

router.get('/workshops/:courseId', (c) => c.json(siteWorkshopDetail(c.get('db'), paramId(c, 'courseId'), schoolToday(c))));

router.put('/workshops/:courseId', async (c) => {
  const courseId = paramId(c, 'courseId');
  const input = await body(c, siteWorkshopInput);
  const db = c.get('db');
  db.transaction((tx) => {
    const course = tx.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).get();
    if (!course) throw notFound('Workshop not found');
    const existing = tx.select().from(siteWorkshops).where(eq(siteWorkshops.courseId, courseId)).get();
    if (input.coverFileId && input.coverFileId !== existing?.coverFileId) assertSiteImage(tx, input.coverFileId, ['coverFileId']);
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof siteWorkshops.$inferInsert>;
    if (existing) {
      if (Object.keys(patch).length) tx.update(siteWorkshops).set(patch).where(eq(siteWorkshops.courseId, courseId)).run();
      return;
    }
    const last = tx.select({ n: max(siteWorkshops.sortOrder) }).from(siteWorkshops).get()?.n;
    tx.insert(siteWorkshops)
      .values({ visible: false, acceptingApplications: true, ...patch, courseId, sortOrder: last == null ? 0 : last + 1 })
      .run();
  });
  return c.json(siteWorkshopDetail(db, courseId, schoolToday(c)));
});

// ── Summary (the Website home) ──────────────────────────────────────────────

router.get('/summary', (c) => {
  const db = c.get('db');
  const today = schoolToday(c);
  const n = (q: { get(): { n: number } | undefined }) => q.get()?.n ?? 0;
  const counted = sql<number>`count(*)`.mapWith(Number);
  const content = getSiteContent(db);
  const origin = new URL(c.req.url).origin;
  const publicHosts = c.get('config').publicSiteHosts;
  const res: SiteSummary = {
    newWebsiteLeads: userCan(c, 'admissions.read')
      ? n(db.select({ n: counted }).from(leads).where(and(eq(leads.source, 'website'), eq(leads.status, 'new'))))
      : null,
    newCastingApplications: userCan(c, 'talent.read') ? n(db.select({ n: counted }).from(castingApplications).where(eq(castingApplications.status, 'new'))) : null,
    castingCallOpen: content.castingCall.open,
    visibleWorkshops: n(db.select({ n: counted }).from(siteWorkshops).innerJoin(courses, eq(courses.id, siteWorkshops.courseId)).where(workshopOnSite(today))),
    visibleCoaches: n(db.select({ n: counted }).from(siteCoaches).where(eq(siteCoaches.visible, true))),
    // The studio's own domain when configured (PUBLIC_SITE_HOSTS), else this host's /site previews.
    urls: siteUrls(origin, publicHosts),
    published: content.published,
    publicHost: publicHosts[0] ?? null,
    previewUrls: siteUrls(origin),
  };
  return c.json(res);
});

export default router;
