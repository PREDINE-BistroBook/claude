import { count, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../../src/server/db/client';
import { courseSlots, courses, files, leads, positions, settings, siteCoaches, siteWorkshops, students } from '../../src/server/db/schema';
import { builtInGrantsVersion, upgradeBuiltInPositions } from '../../src/server/lib/access';
import { createCastingApplication } from '../../src/server/lib/castingApplications';
import {
  findPublicFile,
  findPublicWorkshop,
  getSiteContent,
  getSiteFormSecret,
  isPublicFile,
  loadPublicCoaches,
  loadPublicWorkshops,
  saveSiteContent,
  SITE_FORM_SECRET_SETTING,
} from '../../src/server/lib/siteContent';
import { checkFormToken, FORM_TOKEN_MAX_AGE_MS, issueFormToken } from '../../src/server/lib/siteForms';
import { sitePaths } from '../../src/server/site/paths';
import { addDays } from '../../src/shared/dates';
import { BUILT_IN_GRANTS, BUILT_IN_GRANTS_SETTING, BUILT_IN_POSITIONS, LATEST_BUILT_IN_GRANTS_VERSION } from '../../src/shared/permissions';
import { castingApplicationInput } from '../../src/shared/schemas/castingApplications';
import { DEFAULT_SITE_CONTENT, siteContent, type SiteCoach, type SiteContent, type SiteSummary, type SiteWorkshop } from '../../src/shared/schemas/site';
import { makeTestContext, PNG_1PX, todayISO, uploadPng } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const TOKEN = 'test-admin-token-0123456789abcdef';

/** A course row straight into the database (active, running from 60 days ago to 60 days ahead unless overridden). */
function course(t: Ctx, o: Partial<typeof courses.$inferInsert> = {}) {
  const today = todayISO();
  return t.db
    .insert(courses)
    .values({ name: `Course ${Math.random().toString(36).slice(2, 7)}`, startDate: addDays(today, -60), endDate: addDays(today, 60), ...o })
    .returning()
    .get()!;
}

/** A valid content object to PUT (overrides win). */
function content(o: Record<string, unknown> = {}) {
  return {
    tagline: { en: 'Acting in Giza', ar: 'التمثيل في الجيزة' },
    about: { en: 'About us.\n\nSecond paragraph.', ar: 'عن الاستوديو.' },
    address: { en: 'Mohandessin, Giza', ar: 'المهندسين، الجيزة' },
    mapUrl: 'https://maps.google.com/?q=Mohandessin',
    instagram: 'turquoisecastingstudio',
    whatsappWorkshops: '01094635959',
    whatsappCasting: '01119003100',
    phone: null,
    email: 'hello@example.com',
    heroFileId: null,
    castingCall: { open: true, intro: { en: 'Join us', ar: 'انضم إلينا' }, lookingFor: { en: 'Everyone', ar: 'الجميع' } },
    links: [{ label: { en: 'Showreel', ar: 'فيديو' }, url: 'https://vimeo.com/x', visible: true }],
    ...o,
  };
}

/** A casting application through the library (as the public form will), with `photos` PNGs. */
async function application(t: Ctx, o: Record<string, unknown> = {}, photos = 1) {
  if (!getSiteContent(t.db).castingCall.open) saveSiteContent(t.db, { ...getSiteContent(t.db), castingCall: { ...DEFAULT_SITE_CONTENT.castingCall, open: true } });
  const input = castingApplicationInput(todayISO()).parse({
    firstName: 'Nadia',
    lastName: 'Fahmy',
    gender: 'female',
    dateOfBirth: addDays(todayISO(), -25 * 366),
    phone: '0100 123 4567',
    privacyConsent: 'on',
    locale: 'en',
    ...o,
  });
  return createCastingApplication(
    t.db,
    t.files,
    input,
    Array.from({ length: photos }, () => ({ data: PNG_1PX })),
  );
}

describe('/api/site — access', () => {
  it('401 signed out, 403 without website.manage; the director and owners may', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/site/content')).status).toBe(401);
    for (const spec of ['acting_coach', 'head_of_casting', 'casting_team', 'finance', 'video_editor'] as const) {
      const client = await t.as(spec);
      for (const url of ['/api/site/content', '/api/site/coaches', '/api/site/workshops', '/api/site/summary']) {
        expect((await client.get(url)).status, `${spec} ${url}`).toBe(403);
      }
      expect((await client.put('/api/site/content', content())).status).toBe(403);
    }
    for (const spec of ['executive_director', 'ceo', 'cfo'] as const) {
      expect((await (await t.as(spec)).get('/api/site/content')).status, spec).toBe(200);
    }
    // Just the permission, nothing else.
    expect((await (await t.as({ permissions: ['website.manage'] })).get('/api/site/coaches')).status).toBe(200);
  });
});

describe('/api/site/content', () => {
  it('starts empty with the casting call closed, and stores the whole object', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    expect((await director.get<SiteContent>('/api/site/content')).body).toEqual(DEFAULT_SITE_CONTENT);

    const res = await director.put<SiteContent>('/api/site/content', content());
    expect(res.status).toBe(200);
    expect(res.body.castingCall.open).toBe(true);
    expect(res.body.about.en).toBe('About us.\n\nSecond paragraph.');
    expect(res.body.links).toHaveLength(1);
    expect(res.body.links[0]!.id).toMatch(/^[0-9a-f]{12}$/);
    expect((await director.get<SiteContent>('/api/site/content')).body).toEqual(res.body);

    // Saving again keeps the link ids; a missing part is stored empty.
    const again = await director.put<SiteContent>('/api/site/content', { ...res.body, links: [...res.body.links, { label: { en: 'Map', ar: '' }, url: 'https://maps.google.com' }], tagline: undefined });
    expect(again.status).toBe(200);
    expect(again.body.links[0]!.id).toBe(res.body.links[0]!.id);
    expect(again.body.links[1]).toMatchObject({ label: { en: 'Map', ar: '' }, visible: true });
    expect(again.body.tagline).toEqual({ en: '', ar: '' });
  });

  it('normalises phones and the Instagram handle; https links only', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const res = await director.put<SiteContent>(
      '/api/site/content',
      content({ whatsappWorkshops: '‪٠١٠٩٤٦٣٥٩٥٩‬', instagram: 'https://www.instagram.com/turquoisecastingstudio/', phone: '' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.whatsappWorkshops).toBe('01094635959');
    expect(res.body.instagram).toBe('turquoisecastingstudio');
    expect(res.body.phone).toBeNull();
    expect((await director.put<SiteContent>('/api/site/content', content({ instagram: '@studio.name' }))).body.instagram).toBe('studio.name');

    const bad = async (o: Record<string, unknown>) => {
      const r = await director.put('/api/site/content', content(o));
      expect(r.status).toBe(400);
      return [...new Set(r.body.error.issues.map((i: { path: (string | number)[] }) => i.path.join('.')))];
    };
    expect(await bad({ mapUrl: 'http://maps.google.com' })).toEqual(['mapUrl']);
    expect(await bad({ links: [{ label: { en: 'x', ar: '' }, url: 'javascript:alert(1)' }] })).toEqual(['links.0.url']);
    expect(await bad({ links: [{ label: { en: 'x', ar: '' }, url: 'data:text/html,hi' }] })).toEqual(['links.0.url']);
    expect(await bad({ links: [{ label: { en: '', ar: '' }, url: 'https://a.com' }] })).toEqual(['links.0.label.en']);
    expect(await bad({ links: Array.from({ length: 21 }, (_, i) => ({ label: { en: `L${i}`, ar: '' }, url: 'https://a.com' })) })).toEqual(['links']);
    expect(await bad({ about: { en: 'x'.repeat(4001), ar: '' } })).toEqual(['about.en']);
    expect(await bad({ tagline: { en: '', ar: 'ت'.repeat(161) } })).toEqual(['tagline.ar']);
    expect(await bad({ whatsappCasting: '12' })).toEqual(['whatsappCasting']);
    expect(await bad({ instagram: 'not a handle!' })).toEqual(['instagram']);
    expect(await bad({ email: 'nope' })).toEqual(['email']);
  });

  it('the hero photo must be an uploaded image, never a casting application photo', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const fileId = await uploadPng(director);
    expect((await director.put<SiteContent>('/api/site/content', content({ heroFileId: fileId }))).body.heroFileId).toBe(fileId);
    const missing = await director.put('/api/site/content', content({ heroFileId: '00000000-0000-4000-8000-000000000000' }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues[0]).toMatchObject({ path: ['heroFileId'], message: 'talent:errors.fileNotFound' });

    const app = await application(t);
    const photo = t.db.select().from(files).all().find((f) => f.uploadedBy === null)!;
    expect(app.id).toBeGreaterThan(0);
    expect((await director.put('/api/site/content', content({ heroFileId: photo.id }))).status).toBe(400);
  });

  it('stored content that no longer validates falls back part by part instead of breaking', async () => {
    const t = await makeTestContext();
    t.db.insert(settings).values({ key: 'site', value: { tagline: { en: 'Kept', ar: '' }, mapUrl: 'javascript:alert(1)', links: 'nonsense' } }).run();
    const c = getSiteContent(t.db);
    expect(c.tagline).toEqual({ en: 'Kept', ar: '' });
    expect(c.mapUrl).toBeNull();
    expect(c.links).toEqual([]);
    expect(c.castingCall.open).toBe(false);
  });

  it('is not part of GET /api/settings', async () => {
    const t = await makeTestContext();
    const owner = await t.as('ceo');
    await owner.put('/api/site/content', content());
    const res = await owner.get('/api/settings');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).not.toContain('site');
    expect(Object.keys(res.body)).not.toContain(SITE_FORM_SECRET_SETTING);
  });
});

describe('/api/site/coaches', () => {
  it('creates, lists in order, reorders, edits and deletes coaches', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    expect((await director.post('/api/site/coaches', { titleEn: 'No name' })).body.error.issues[0]).toMatchObject({ path: ['nameEn'], message: 'errors.required' });

    const a = await director.post<SiteCoach>('/api/site/coaches', { nameEn: 'Layla', nameAr: 'ليلى', bioEn: 'Coach' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ nameEn: 'Layla', nameAr: 'ليلى', titleEn: '', visible: true, sortOrder: 0, userId: null, userName: null, photoFileId: null });
    const b = (await director.post<SiteCoach>('/api/site/coaches', { nameAr: 'دانيال', visible: false })).body;
    const c = (await director.post<SiteCoach>('/api/site/coaches', { nameEn: 'Hassan' })).body;
    expect([b.sortOrder, c.sortOrder]).toEqual([1, 2]);

    const list = await director.get<{ items: SiteCoach[] }>('/api/site/coaches');
    expect(list.body.items.map((x) => x.id)).toEqual([a.body.id, b.id, c.id]);

    const reordered = await director.post<{ items: SiteCoach[] }>('/api/site/coaches/order', { ids: [c.id, a.body.id] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.items.map((x) => x.id)).toEqual([c.id, a.body.id, b.id]);
    expect((await director.post('/api/site/coaches/order', { ids: [c.id, c.id] })).status).toBe(400);
    expect((await director.post('/api/site/coaches/order', { ids: [9999] })).status).toBe(400);

    const patched = await director.patch<SiteCoach>(`/api/site/coaches/${b.id}`, { titleEn: 'Improv', visible: true, nameAr: null, nameEn: 'Daniel' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ titleEn: 'Improv', visible: true, nameAr: '', nameEn: 'Daniel' });
    expect((await director.patch(`/api/site/coaches/${b.id}`, { nameEn: '' })).status).toBe(400);
    expect((await director.get(`/api/site/coaches/${b.id}`)).body.nameEn).toBe('Daniel');

    expect((await director.delete(`/api/site/coaches/${b.id}`)).status).toBe(204);
    expect((await director.get(`/api/site/coaches/${b.id}`)).status).toBe(404);
    expect((await director.patch(`/api/site/coaches/${b.id}`, { nameEn: 'x' })).status).toBe(404);
    expect((await director.delete(`/api/site/coaches/${b.id}`)).status).toBe(404);
  });

  it('a staff link must be an active account the caller may see; a hidden owner link survives a non-owner’s edit', async () => {
    const t = await makeTestContext();
    const owner = await t.as('ceo');
    const director = await t.as('executive_director');
    const coach = await t.createUser('acting_coach', { name: 'Layla Haddad' });
    const gone = await t.createUser('acting_coach', { active: false });
    const cfo = await t.createUser('cfo');

    const linked = await director.post<SiteCoach>('/api/site/coaches', { nameEn: 'Layla', userId: coach.id });
    expect(linked.body).toMatchObject({ userId: coach.id, userName: 'Layla Haddad' });
    for (const userId of [gone.id, cfo.id, 99999]) {
      const res = await director.post('/api/site/coaches', { nameEn: 'X', userId });
      expect(res.status).toBe(400);
      expect(res.body.error.issues[0].path).toEqual(['userId']);
    }

    // An owner links a profile to an owner account: the director sees no link, and editing keeps it.
    const ownerLinked = await owner.post<SiteCoach>('/api/site/coaches', { nameEn: 'Guest', userId: cfo.id });
    expect(ownerLinked.body.userId).toBe(cfo.id);
    expect((await director.get<SiteCoach>(`/api/site/coaches/${ownerLinked.body.id}`)).body).toMatchObject({ userId: null, userName: null });
    await director.patch(`/api/site/coaches/${ownerLinked.body.id}`, { userId: null, titleEn: 'Guest director' });
    expect(t.db.select().from(siteCoaches).where(eq(siteCoaches.id, ownerLinked.body.id)).get()!.userId).toBe(cfo.id);
    // Unlinking a visible account works.
    await director.patch(`/api/site/coaches/${linked.body.id}`, { userId: null });
    expect((await director.get<SiteCoach>(`/api/site/coaches/${linked.body.id}`)).body.userId).toBeNull();
  });

  it('photos must be uploaded images', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const fileId = await uploadPng(director);
    expect((await director.post<SiteCoach>('/api/site/coaches', { nameEn: 'A', photoFileId: fileId })).body.photoFileId).toBe(fileId);
    expect((await director.post('/api/site/coaches', { nameEn: 'A', photoFileId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await director.post('/api/site/coaches', { nameEn: 'A', photoFileId: 'not-a-uuid' })).status).toBe(400);
  });
});

describe('/api/site/workshops', () => {
  it('lists active workshops that have not ended, with defaults until saved; PUT creates then updates the row', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const today = todayISO();
    const running = course(t, { name: 'Screen Acting I', teacherId: director.user.id });
    t.db.insert(courseSlots).values({ courseId: running.id, weekday: 2, startTime: '18:00', endTime: '20:00' }).run();
    const upcoming = course(t, { name: 'Voice', startDate: addDays(today, 10), endDate: addDays(today, 70) });
    const endsToday = course(t, { name: 'Last day', endDate: today });
    course(t, { name: 'Over', endDate: addDays(today, -1) });
    course(t, { name: 'Archived', status: 'archived' });

    const list = await director.get<{ items: SiteWorkshop[] }>('/api/site/workshops');
    expect(list.status).toBe(200);
    expect(list.body.items.map((w) => w.courseName).sort()).toEqual(['Last day', 'Screen Acting I', 'Voice']);
    const screen = list.body.items.find((w) => w.courseId === running.id)!;
    expect(screen).toMatchObject({
      saved: false,
      visible: false,
      onSite: false,
      acceptingApplications: true,
      titleEn: '',
      teacherName: director.user.name,
      schedule: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
    });

    const put = await director.put<SiteWorkshop>(`/api/site/workshops/${upcoming.id}`, { visible: true, priceEn: '3,500 EGP', priceAr: '٣٥٠٠ جنيه', titleAr: 'الصوت' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ saved: true, visible: true, onSite: true, priceEn: '3,500 EGP', titleAr: 'الصوت', acceptingApplications: true });
    const second = await director.put<SiteWorkshop>(`/api/site/workshops/${upcoming.id}`, { acceptingApplications: false });
    expect(second.body).toMatchObject({ visible: true, priceEn: '3,500 EGP', acceptingApplications: false });
    expect((await director.get<SiteWorkshop>(`/api/site/workshops/${upcoming.id}`)).body.acceptingApplications).toBe(false);
    // Saved rows come first in the list.
    expect((await director.get<{ items: SiteWorkshop[] }>('/api/site/workshops')).body.items[0]!.courseId).toBe(upcoming.id);

    const reordered = await director.post<{ items: SiteWorkshop[] }>('/api/site/workshops/order', { ids: [endsToday.id, running.id, upcoming.id] });
    expect(reordered.body.items.map((w) => w.courseId)).toEqual([endsToday.id, running.id, upcoming.id]);
    expect(reordered.body.items.every((w) => w.saved)).toBe(true);
    expect((await director.post('/api/site/workshops/order', { ids: [123456] })).status).toBe(400);

    expect((await director.put('/api/site/workshops/99999', { visible: true })).status).toBe(404);
    expect((await director.get('/api/site/workshops/99999')).status).toBe(404);
    expect((await director.put(`/api/site/workshops/${upcoming.id}`, { visible: 'yes' })).status).toBe(400);
    expect((await director.put(`/api/site/workshops/${upcoming.id}`, { coverFileId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });
});

describe('/api/site/summary', () => {
  it('counts what is new and shown, and gives the public URLs from the request origin', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const shown = course(t);
    const hidden = course(t);
    await director.put(`/api/site/workshops/${shown.id}`, { visible: true });
    await director.put(`/api/site/workshops/${hidden.id}`, { visible: false });
    await director.post('/api/site/coaches', { nameEn: 'A' });
    await director.post('/api/site/coaches', { nameEn: 'B', visible: false });
    await director.post('/api/leads', { firstName: 'Web', lastName: 'Lead', phone: '0100 000 1111', source: 'website' });
    await director.post('/api/leads', { firstName: 'Walk', lastName: 'In', phone: '0100 000 2222', source: 'walk_in' });
    await application(t);

    const res = await director.get<SiteSummary>('/api/site/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      newWebsiteLeads: 1,
      newCastingApplications: 1,
      castingCallOpen: true,
      visibleWorkshops: 1,
      visibleCoaches: 1,
      urls: {
        en: { home: 'http://localhost/site/en', workshops: 'http://localhost/site/en/workshops', castingCall: 'http://localhost/site/en/casting-call', links: 'http://localhost/site/en/links' },
        ar: { home: 'http://localhost/site/ar', workshops: 'http://localhost/site/ar/workshops', castingCall: 'http://localhost/site/ar/casting-call', links: 'http://localhost/site/ar/links' },
      },
    });
    const viaHost = await t.app.request('https://studio.example/api/site/summary', { headers: { cookie: director.cookie!, 'x-requested-with': 'fetch' } });
    expect(((await viaHost.json()) as SiteSummary).urls.ar.links).toBe('https://studio.example/site/ar/links');

    // Website-only staff don't get the admissions / casting numbers.
    const webOnly = await t.as({ permissions: ['website.manage'] });
    expect((await webOnly.get<SiteSummary>('/api/site/summary')).body).toMatchObject({ newWebsiteLeads: null, newCastingApplications: null, visibleCoaches: 1 });
  });
});

describe('the public side (library functions for /site)', () => {
  it('workshops appear only when visible, active and not over; titles fall back to the course name; the coach is the linked site coach', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const coachUser = await t.createUser('acting_coach', { name: 'Layla Staff' });
    const today = todayISO();
    const a = course(t, { name: 'Screen Acting I', teacherId: coachUser.id, startDate: addDays(today, 5) });
    const b = course(t, { name: 'Voice', startDate: addDays(today, -5) });
    const hidden = course(t, { name: 'Hidden' });
    const over = course(t, { name: 'Over', endDate: addDays(today, -1) });
    const archived = course(t, { name: 'Archived', status: 'archived' });
    for (const c of [a, b, over, archived]) await director.put(`/api/site/workshops/${c.id}`, { visible: true });
    await director.put(`/api/site/workshops/${a.id}`, { titleAr: 'التمثيل أمام الكاميرا', descriptionEn: 'Camera work' });
    await director.put(`/api/site/workshops/${hidden.id}`, { visible: false });

    const list = loadPublicWorkshops(t.db, today);
    expect(list.map((w) => w.courseId)).toEqual([a.id, b.id]);
    expect(list[0]).toMatchObject({
      title: { en: 'Screen Acting I', ar: 'التمثيل أمام الكاميرا' },
      description: { en: 'Camera work', ar: 'Camera work' },
      coach: { en: 'Layla Staff', ar: 'Layla Staff' },
    });
    for (const c of [hidden, over, archived]) expect(findPublicWorkshop(t.db, c.id, today)).toBeNull();
    expect(findPublicWorkshop(t.db, 99999, today)).toBeNull();

    // A shown site coach linked to the teacher names the workshop's coach in both languages.
    await director.post('/api/site/coaches', { nameEn: 'Layla Haddad', nameAr: 'ليلى حداد', userId: coachUser.id });
    expect(findPublicWorkshop(t.db, a.id, today)!.coach).toEqual({ en: 'Layla Haddad', ar: 'ليلى حداد' });
    await director.post('/api/site/coaches', { nameEn: 'Not shown', visible: false });
    expect(loadPublicCoaches(t.db).map((c) => c.name.en)).toEqual(['Layla Haddad']);
  });

  it('/site/media rule: only the hero, shown coaches’ photos and covers of workshops on the site are public — never application photos', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const today = todayISO();
    const [hero, coachPhoto, hiddenCoachPhoto, cover, hiddenCover, overCover, plain] = await Promise.all(Array.from({ length: 7 }, () => uploadPng(director)));
    await director.put('/api/site/content', content({ heroFileId: hero }));
    await director.post('/api/site/coaches', { nameEn: 'Shown', photoFileId: coachPhoto });
    await director.post('/api/site/coaches', { nameEn: 'Hidden', photoFileId: hiddenCoachPhoto, visible: false });
    const shownCourse = course(t);
    const hiddenCourse = course(t);
    const overCourse = course(t, { endDate: addDays(today, -1) });
    await director.put(`/api/site/workshops/${shownCourse.id}`, { visible: true, coverFileId: cover });
    await director.put(`/api/site/workshops/${hiddenCourse.id}`, { visible: false, coverFileId: hiddenCover });
    await director.put(`/api/site/workshops/${overCourse.id}`, { visible: true, coverFileId: overCover });

    expect([hero, coachPhoto, cover].map((f) => isPublicFile(t.db, f!, today))).toEqual([true, true, true]);
    expect([hiddenCoachPhoto, hiddenCover, overCover, plain].map((f) => isPublicFile(t.db, f!, today))).toEqual([false, false, false, false]);
    expect(findPublicFile(t.db, hero!, today)).toMatchObject({ id: hero, mime: 'image/png' });
    expect(findPublicFile(t.db, plain!, today)).toBeNull();
    expect(findPublicFile(t.db, '../etc/passwd', today)).toBeNull();

    // An application photo stays private even if it ends up named as the hero.
    await application(t);
    const appPhoto = t.db.select().from(files).all().find((f) => f.uploadedBy === null)!.id;
    saveSiteContent(t.db, { ...getSiteContent(t.db), heroFileId: appPhoto });
    expect(isPublicFile(t.db, appPhoto, today)).toBe(false);

    // A non-image file is never served.
    t.db.insert(files).values({ id: '11111111-1111-4111-8111-111111111111', mime: 'text/html', size: 1, storageKey: 'x.html' }).run();
    saveSiteContent(t.db, { ...getSiteContent(t.db), heroFileId: '11111111-1111-4111-8111-111111111111' });
    expect(findPublicFile(t.db, '11111111-1111-4111-8111-111111111111', today)).toBeNull();
  });

  it('form tokens: fine between 3 s and 24 h old; too fast, expired, forged, for the other form or missing are refused', async () => {
    const t = await makeTestContext();
    const now = Date.now();
    const token = issueFormToken(t.db, 'apply', now);
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(checkFormToken(t.db, token, 'apply', now + 5_000)).toBe('ok');
    expect(checkFormToken(t.db, token, 'apply', now + 1_000)).toBe('too_fast');
    expect(checkFormToken(t.db, token, 'apply', now + FORM_TOKEN_MAX_AGE_MS + 1)).toBe('expired');
    expect(checkFormToken(t.db, token, 'casting', now + 5_000)).toBe('invalid');
    const [issued, mac] = token.split('.');
    expect(checkFormToken(t.db, `${Number(issued) - 10_000}.${mac}`, 'apply', now + 5_000)).toBe('invalid');
    expect(checkFormToken(t.db, `${issued}.${'0'.repeat(64)}`, 'apply', now + 5_000)).toBe('invalid');
    expect(checkFormToken(t.db, 'garbage', 'apply', now + 5_000)).toBe('invalid');
    expect(checkFormToken(t.db, '', 'apply', now)).toBe('missing');
    expect(checkFormToken(t.db, undefined, 'apply', now)).toBe('missing');
  });

  it('the form secret is 32 random bytes made once at startup, different per database, and survives restarts', async () => {
    const t = await makeTestContext();
    const secret = getSiteFormSecret(t.db);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(getSiteFormSecret(t.db)).toBe(secret);
    const other = await makeTestContext();
    expect(getSiteFormSecret(other.db)).not.toBe(secret);
  });

  it('paths live in one place', () => {
    expect(sitePaths.home('ar')).toBe('/site/ar');
    expect(sitePaths.workshopApply('en', 4)).toBe('/site/en/workshops/4/apply');
    expect(sitePaths.thanks('ar', 'casting')).toBe('/site/ar/thanks?k=casting');
    expect(sitePaths.media('abc')).toBe('/site/media/abc');
  });
});

describe('BUILT_IN_GRANTS v2: website.manage for the Executive Director', () => {
  const perms = (db: DB, key: string) => db.select().from(positions).where(eq(positions.key, key)).get()!.permissions as string[];

  it('is in the built-in list (director only, besides the owners) and in the changelog as version 2', () => {
    expect(BUILT_IN_GRANTS.find((g) => g.version === 2)).toEqual({ version: 2, grants: { executive_director: ['website.manage'] } });
    expect(LATEST_BUILT_IN_GRANTS_VERSION).toBeGreaterThanOrEqual(2);
    for (const p of BUILT_IN_POSITIONS) {
      expect((p.permissions as readonly string[]).includes('website.manage'), p.key).toBe(p.isOwner || p.key === 'executive_director');
    }
  });

  it('an existing database (version 1) gives the director website.manage once; removing it afterwards sticks', () => {
    const db = createDb(':memory:');
    db.update(positions)
      .set({ permissions: perms(db, 'executive_director').filter((p) => p !== 'website.manage') as never })
      .where(eq(positions.key, 'executive_director'))
      .run();
    db.update(settings).set({ value: 1 }).where(eq(settings.key, BUILT_IN_GRANTS_SETTING)).run();
    const coach = perms(db, 'acting_coach');

    upgradeBuiltInPositions(db);
    expect(perms(db, 'executive_director').filter((p) => p === 'website.manage')).toHaveLength(1);
    expect(perms(db, 'executive_director').at(-1)).toBe('website.manage');
    expect(perms(db, 'acting_coach')).toEqual(coach);
    expect(builtInGrantsVersion(db)).toBe(LATEST_BUILT_IN_GRANTS_VERSION);

    db.update(positions)
      .set({ permissions: perms(db, 'executive_director').filter((p) => p !== 'website.manage') as never })
      .where(eq(positions.key, 'executive_director'))
      .run();
    upgradeBuiltInPositions(db);
    upgradeBuiltInPositions(db);
    expect(perms(db, 'executive_director')).not.toContain('website.manage');
  });
});

describe('POST /api/admin/seed-demo-website', () => {
  const call = (t: Ctx, token: string | null = TOKEN) =>
    t.anon.raw('/api/admin/seed-demo-website', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("doesn't exist without ADMIN_TOKEN, needs the bearer token", async () => {
    const off = await makeTestContext();
    const unknown = await off.anon.raw('/api/no-such-route', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    const res = await call(off);
    expect([res.status, await res.text()]).toEqual([unknown.status, await unknown.text()]);
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    expect((await call(t, null)).status).toBe(401);
    expect((await call(t, 'wrong-token-wrong-token-wrong')).status).toBe(401);
  });

  it('fills an empty website once (coaches linked to the demo coaches, applications, enquiries) and never touches other data', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const owner = await t.as('ceo');
    const layla = await t.createUser('acting_coach', { email: 'coach@demo.school', name: 'Layla Haddad' });
    await owner.post('/api/students', { firstName: 'Kept', lastName: 'Student' });
    const screen = course(t, { name: 'Screen Acting I', teacherId: layla.id });
    course(t, { name: 'Voice & Speech' });
    const studentsBefore = t.db.select().from(students).all();
    const coursesBefore = t.db.select().from(courses).all();

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await call(t);
    log.mockRestore();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, coaches: 3, workshops: 2, applications: 4, enquiries: 2 });

    const site = getSiteContent(t.db);
    expect(site.castingCall.open).toBe(true);
    expect(site.whatsappWorkshops).toBe('01094635959');
    expect(site.whatsappCasting).toBe('01119003100');
    expect(site.instagram).toBe('turquoisecastingstudio');
    expect(site.address).toEqual({ en: 'Mohandessin, Giza', ar: 'المهندسين، الجيزة' });
    expect(site.links).toHaveLength(3);
    expect(siteContent.safeParse(site).success).toBe(true);
    expect(t.db.select().from(siteCoaches).where(eq(siteCoaches.userId, layla.id)).all()).toHaveLength(1);
    expect(findPublicWorkshop(t.db, screen.id, todayISO())).toMatchObject({ price: { en: '3,500 EGP', ar: '٣٥٠٠ جنيه' }, coach: { en: 'Layla Haddad', ar: 'ليلى حداد' } });

    const director = await t.as('executive_director');
    const apps = (await director.get('/api/casting-applications')).body.items;
    expect(apps).toHaveLength(4);
    expect(apps.filter((a: { minor: boolean }) => a.minor)).toHaveLength(1);
    const websiteLeads = t.db.select().from(leads).where(eq(leads.source, 'website')).all();
    expect(websiteLeads).toHaveLength(2);
    expect(websiteLeads.find((l) => l.preferredCourseId === screen.id)).toBeTruthy();

    expect(t.db.select().from(students).all()).toEqual(studentsBefore);
    expect(t.db.select().from(courses).all()).toEqual(coursesBefore);

    // Once only.
    expect((await call(t)).status).toBe(409);
    expect(t.db.select({ n: count() }).from(siteCoaches).get()!.n).toBe(3);
  });

  it('409 when the website already has content or coaches', async () => {
    const t = await makeTestContext({ config: { adminToken: TOKEN } });
    const director = await t.as('executive_director');
    await director.post('/api/site/coaches', { nameEn: 'Someone' });
    expect((await call(t)).status).toBe(409);

    const u = await makeTestContext({ config: { adminToken: TOKEN } });
    await (await u.as('executive_director')).put('/api/site/content', content());
    expect((await call(u)).status).toBe(409);
    expect(u.db.select({ n: count() }).from(siteWorkshops).get()!.n).toBe(0);
  });
});
