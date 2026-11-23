import { count, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../../src/server/db/client';
import { courseSlots, courses, files, leadActivities, leads, positions, settings, siteCoaches, siteWorkshops, students, users } from '../../src/server/db/schema';
import { builtInGrantsVersion, upgradeBuiltInPositions } from '../../src/server/lib/access';
import { createWebsiteLead, sameLeadPerson, WEBSITE_GENERAL_ENQUIRY } from '../../src/server/lib/admissions';
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
  siteUrls,
} from '../../src/server/lib/siteContent';
import { checkFormToken, FORM_TOKEN_MAX_AGE_MS, issueFormToken } from '../../src/server/lib/siteForms';
import { publicHostSitePaths, sitePaths } from '../../src/server/site/paths';
import { addDays } from '../../src/shared/dates';
import { BUILT_IN_GRANTS, BUILT_IN_GRANTS_SETTING, BUILT_IN_POSITIONS, LATEST_BUILT_IN_GRANTS_VERSION } from '../../src/shared/permissions';
import { castingApplicationInput } from '../../src/shared/schemas/castingApplications';
import type { LeadDetail, LeadListItem } from '../../src/shared/schemas/admissions';
import { DEFAULT_SITE_CONTENT, siteApplyInput, siteContent, type SiteCoach, type SiteContent, type SiteSummary, type SiteWorkshop } from '../../src/shared/schemas/site';
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
    // Naming the owner behind that hidden link answers exactly like a missing id (no "yes, that's the one"), and changes nothing.
    const guess = await director.patch(`/api/site/coaches/${ownerLinked.body.id}`, { userId: cfo.id });
    const missing = await director.patch(`/api/site/coaches/${ownerLinked.body.id}`, { userId: 99999 });
    expect(guess.status).toBe(400);
    expect(guess.body.error.issues[0].path).toEqual(['userId']);
    expect(guess.body).toEqual(missing.body);
    expect(t.db.select().from(siteCoaches).where(eq(siteCoaches.id, ownerLinked.body.id)).get()!.userId).toBe(cfo.id);
    // The owner may send it back unchanged.
    expect((await owner.patch(`/api/site/coaches/${ownerLinked.body.id}`, { userId: cfo.id })).status).toBe(200);
    // An unchanged visible link keeps saving even after that account was deactivated (the form always sends it back).
    t.db.update(users).set({ active: false }).where(eq(users.id, coach.id)).run();
    const resave = await director.patch<SiteCoach>(`/api/site/coaches/${linked.body.id}`, { userId: coach.id, titleEn: 'Still here' });
    expect(resave.status).toBe(200);
    expect(t.db.select().from(siteCoaches).where(eq(siteCoaches.id, linked.body.id)).get()).toMatchObject({ userId: coach.id, titleEn: 'Still here' });
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

describe('site images are the website’s own uploads', () => {
  it('a student’s photo or a talent’s photo can’t be made the hero, a coach photo or a workshop cover — by anyone holding only website.manage or more', async () => {
    const t = await makeTestContext();
    const owner = await t.as('ceo');
    const studentPhoto = await uploadPng(owner);
    const talentPhoto = await uploadPng(owner);
    const student = await owner.post('/api/students', { firstName: 'Sara', lastName: 'Nabil', photoFileId: studentPhoto });
    expect(student.status).toBe(201);
    const person = await owner.post('/api/talent', { firstName: 'Omar', lastName: 'Zaki' });
    expect((await owner.post(`/api/talent/${person.body.id}/photos`, { fileId: talentPhoto })).status).toBe(201);
    const c = course(t);

    const web = await t.as({ permissions: ['website.manage'] });
    expect((await web.get('/api/students')).status).toBe(403);
    for (const fileId of [studentPhoto, talentPhoto]) {
      const hero = await web.put('/api/site/content', content({ heroFileId: fileId }));
      expect(hero.status).toBe(400);
      expect(hero.body.error.issues[0]).toMatchObject({ path: ['heroFileId'], message: 'talent:errors.fileNotFound' });
      expect((await web.post('/api/site/coaches', { nameEn: 'X', photoFileId: fileId })).status).toBe(400);
      expect((await web.put(`/api/site/workshops/${c.id}`, { visible: true, coverFileId: fileId })).status).toBe(400);
      expect((await owner.put('/api/site/content', content({ heroFileId: fileId }))).status).toBe(400);
      expect((await t.app.request(`/site/media/${fileId}`)).status).toBe(404);
    }
    // Its own upload is fine.
    const own = await uploadPng(web);
    expect((await web.put('/api/site/content', content({ heroFileId: own }))).status).toBe(200);
    expect((await t.app.request(`/site/media/${own}`)).status).toBe(200);
  });

  it('a casting photo stays off the site after its application was accepted and deleted (it is a talent photo then)', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const app = await application(t);
    const photo = t.db.select().from(files).all().find((f) => f.uploadedBy === null)!;
    expect((await director.post(`/api/casting-applications/${app.id}/accept`)).status).toBe(201);
    expect((await director.delete(`/api/casting-applications/${app.id}`)).status).toBe(204);
    expect(t.db.select().from(files).where(eq(files.id, photo.id)).get()).toBeTruthy();
    expect((await director.put('/api/site/content', content({ heroFileId: photo.id }))).status).toBe(400);
    expect((await t.app.request(`/site/media/${photo.id}`)).status).toBe(404);
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

    const put = await director.put<SiteWorkshop>(`/api/site/workshops/${upcoming.id}`, { visible: true, descriptionEn: 'Breath and voice', titleAr: 'الصوت' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ saved: true, visible: true, onSite: true, descriptionEn: 'Breath and voice', titleAr: 'الصوت', acceptingApplications: true });
    const second = await director.put<SiteWorkshop>(`/api/site/workshops/${upcoming.id}`, { acceptingApplications: false });
    expect(second.body).toMatchObject({ visible: true, descriptionEn: 'Breath and voice', acceptingApplications: false });
    // No prices anywhere (the school's decision): a price sent anyway is neither stored nor answered.
    const priced = await director.put<SiteWorkshop>(`/api/site/workshops/${upcoming.id}`, { priceEn: '3,500 EGP', priceAr: '٣٥٠٠ جنيه' });
    expect(priced.status).toBe(200);
    expect(Object.keys(priced.body).filter((k) => /price/i.test(k))).toEqual([]);
    expect(Object.keys(t.db.select().from(siteWorkshops).where(eq(siteWorkshops.courseId, upcoming.id)).get()!).filter((k) => /price/i.test(k))).toEqual([]);
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
    expect(siteUrls('http://localhost:3000/').en.home).toBe('http://localhost:3000/site/en');

    // Website-only staff don't get the admissions / casting numbers.
    const webOnly = await t.as({ permissions: ['website.manage'] });
    expect((await webOnly.get<SiteSummary>('/api/site/summary')).body).toMatchObject({ newWebsiteLeads: null, newCastingApplications: null, visibleCoaches: 1 });
  });
});

describe('/api/site/summary with the studio’s own domain (PUBLIC_SITE_HOSTS)', () => {
  it('the links to open and copy are on the first public host, without /site — whatever host the staff app is used on', async () => {
    const t = await makeTestContext({ config: { publicSiteHosts: ['turquoisestudio.app', 'www.turquoisestudio.app'] } });
    const director = await t.as('executive_director');
    const res = await t.app.request('https://staff.turquoisestudio.app/api/site/summary', { headers: { cookie: director.cookie!, 'x-requested-with': 'fetch' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as SiteSummary).urls).toEqual({
      en: { home: 'https://turquoisestudio.app/en', workshops: 'https://turquoisestudio.app/en/workshops', castingCall: 'https://turquoisestudio.app/en/casting-call', links: 'https://turquoisestudio.app/en/links' },
      ar: { home: 'https://turquoisestudio.app/ar', workshops: 'https://turquoisestudio.app/ar/workshops', castingCall: 'https://turquoisestudio.app/ar/casting-call', links: 'https://turquoisestudio.app/ar/links' },
    });
    // The staff API itself still doesn't answer on the public host.
    expect(siteUrls('http://127.0.0.1:8790', ['turquoisestudio.app']).ar.links).toBe('https://turquoisestudio.app/ar/links');
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
    // On a public host (PUBLIC_SITE_HOSTS) the same pages are bare; the per-host rules are in tests/unit/workerRouting.test.ts.
    expect(publicHostSitePaths.home('ar')).toBe('/ar');
    expect(publicHostSitePaths.media('abc')).toBe('/media/abc');
  });
});

describe('createWebsiteLead (the enquiry form’s write)', () => {
  /** The apply form's values (as the public page sends them), valid unless overridden. */
  const applyForm = (o: Record<string, unknown> = {}) =>
    siteApplyInput(todayISO()).parse({
      firstName: 'Laila',
      lastName: 'Mostafa',
      phone: '0106 555 7010',
      email: 'Laila@Example.com',
      dateOfBirth: addDays(todayISO(), -24 * 366),
      experience: 'some',
      heardFrom: 'instagram',
      message: 'Do you have evening times?',
      privacyConsent: 'on',
      locale: 'en',
      ...o,
    });

  it('a general enquiry becomes a new website lead nobody is assigned to, with a note on its timeline', async () => {
    const t = await makeTestContext();
    const result = createWebsiteLead(t.db, applyForm(), { courseId: null, today: todayISO() });
    expect(result).toEqual({ leadId: expect.any(Number), created: true });

    const director = await t.as('executive_director');
    const lead = (await director.get<LeadDetail>(`/api/leads/${result.leadId}`)).body;
    expect(lead).toMatchObject({
      firstName: 'Laila',
      lastName: 'Mostafa',
      phone: '0106 555 7010',
      email: 'laila@example.com',
      source: 'website',
      sourceDetail: WEBSITE_GENERAL_ENQUIRY,
      status: 'new',
      assignedToId: null,
      createdById: null,
      preferredCourse: null,
      experience: 'Some acting experience',
    });
    expect(lead.notes).toContain('Do you have evening times?');
    expect(lead.notes).toContain('How they heard about us: Instagram');
    expect(lead.notes).toContain('Sent from the English website');
    expect(lead.activities.map((a) => [a.type, a.body])).toEqual([['note', `Applied on the website: ${WEBSITE_GENERAL_ENQUIRY}`]]);
    expect(t.db.select().from(leads).get()!.phoneDigits).toBe('01065557010');

    // Admissions finds it with the source filter.
    const list = await director.get<{ items: LeadListItem[] }>('/api/leads?source=website');
    expect(list.body.items.map((l) => l.id)).toEqual([result.leadId]);
    expect((await director.get<{ items: LeadListItem[] }>('/api/leads?source=walk_in')).body.items).toEqual([]);
  });

  it('a workshop enquiry names the workshop; the workshop must be on the site and accepting applications', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const today = todayISO();
    const shown = course(t, { name: 'Screen Acting I' });
    const closed = course(t, { name: 'Voice' });
    const hidden = course(t, { name: 'Hidden' });
    const over = course(t, { name: 'Over', endDate: addDays(today, -1) });
    await director.put(`/api/site/workshops/${shown.id}`, { visible: true, titleEn: 'Acting for the camera' });
    await director.put(`/api/site/workshops/${closed.id}`, { visible: true, acceptingApplications: false });
    await director.put(`/api/site/workshops/${hidden.id}`, { visible: false });
    await director.put(`/api/site/workshops/${over.id}`, { visible: true });

    const { leadId } = createWebsiteLead(t.db, applyForm({ locale: 'ar' }), { courseId: shown.id, today });
    const lead = (await director.get<LeadDetail>(`/api/leads/${leadId}`)).body;
    expect(lead).toMatchObject({ sourceDetail: 'Acting for the camera', preferredCourse: { id: shown.id, name: 'Screen Acting I' } });
    expect(lead.notes).toContain('Sent from the Arabic website');

    for (const c of [closed, hidden, over]) {
      expect(() => createWebsiteLead(t.db, applyForm({ phone: `0100 000 ${1000 + c.id}` }), { courseId: c.id, today }), c.name).toThrow(
        expect.objectContaining({ status: 404 }),
      );
    }
    expect(() => createWebsiteLead(t.db, applyForm({ phone: '0100 000 9999' }), { courseId: 99999, today })).toThrow(expect.objectContaining({ status: 404 }));
    expect(t.db.select().from(leads).all()).toHaveLength(1);
  });

  it('the same phone on an open lead adds “Applied again on the website” to it instead of a duplicate; a closed lead doesn’t count', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const existing = (await director.post<LeadDetail>('/api/leads', { firstName: 'Laila', lastName: 'M', phone: '+20 106 555 7010', source: 'whatsapp' })).body;

    // Written as a local number: still the same phone.
    const again = createWebsiteLead(t.db, applyForm({ phone: '٠١٠٦ ٥٥٥ ٧٠١٠', message: 'Still interested!' }), { courseId: null, today: todayISO() });
    expect(again).toEqual({ leadId: existing.id, created: false });
    expect(t.db.select().from(leads).all()).toHaveLength(1);
    const lead = (await director.get<LeadDetail>(`/api/leads/${existing.id}`)).body;
    expect(lead).toMatchObject({ source: 'whatsapp', status: 'new', firstName: 'Laila', lastName: 'M' });
    const note = lead.activities.find((a) => a.type === 'note')!;
    expect(note.body).toMatch(/^Applied again on the website: general\nLaila Mostafa\nStill interested!/);
    expect(note.createdById).toBeNull();

    // Once that lead is closed, a new enquiry from the same phone is a new lead.
    await director.patch(`/api/leads/${existing.id}`, { status: 'lost', lostReason: 'no_response' });
    const fresh = createWebsiteLead(t.db, applyForm(), { courseId: null, today: todayISO() });
    expect(fresh.created).toBe(true);
    expect(fresh.leadId).not.toBe(existing.id);
    expect(t.db.select().from(leads).all()).toHaveLength(2);
    expect(t.db.select().from(leadActivities).where(eq(leadActivities.leadId, fresh.leadId)).all()).toHaveLength(1);
  });

  it('the same person applying again: the note carries the date of birth and email, and the lead’s follow-up becomes due today', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const today = todayISO();
    // A walk-in lead already being worked on: contacted, no follow-up set, no date of birth on file.
    const existing = (await director.post<LeadDetail>('/api/leads', { firstName: 'Laila', lastName: 'Mostafa', phone: '0106 555 7010', source: 'walk_in' })).body;
    await director.patch(`/api/leads/${existing.id}`, { status: 'contacted' });
    const before = (await director.get('/api/leads/counts')).body;

    const dob = addDays(today, -24 * 366);
    const again = createWebsiteLead(t.db, applyForm({ firstName: ' laila ', lastName: 'MOSTAFA', dateOfBirth: dob, message: 'Evening group?' }), { courseId: null, today });
    expect(again).toEqual({ leadId: existing.id, created: false });
    const lead = (await director.get<LeadDetail>(`/api/leads/${existing.id}`)).body;
    expect(lead).toMatchObject({ status: 'contacted', source: 'walk_in', nextFollowUpOn: today });
    const note = lead.activities.find((a) => a.body?.startsWith('Applied again'))!;
    expect(note.body).toContain(`Date of birth: ${dob}`);
    expect(note.body).toContain('Email: laila@example.com');
    expect(note.body).toContain('Evening group?');
    // Staff see it: it is now under "Follow-up due".
    const due = await director.get<{ items: LeadListItem[] }>('/api/leads?group=follow_up_due');
    expect(due.body.items.map((l) => l.id)).toEqual([existing.id]);
    expect((await director.get('/api/leads/counts')).body.followUpDue).toBe(before.followUpDue + 1);

    // A follow-up that was already due earlier keeps its date; a later one is pulled forward to today.
    await director.patch(`/api/leads/${existing.id}`, { nextFollowUpOn: addDays(today, -2) });
    createWebsiteLead(t.db, applyForm({ dateOfBirth: dob }), { courseId: null, today });
    expect(t.db.select().from(leads).get()!.nextFollowUpOn).toBe(addDays(today, -2));
    await director.patch(`/api/leads/${existing.id}`, { nextFollowUpOn: addDays(today, 9) });
    createWebsiteLead(t.db, applyForm({ dateOfBirth: dob }), { courseId: null, today });
    expect(t.db.select().from(leads).get()!.nextFollowUpOn).toBe(today);
    expect(t.db.select().from(leads).all()).toHaveLength(1);
  });

  it('someone else on the same phone (a parent’s second child) is a lead of their own, counted as new, naming the other enquiry', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const today = todayISO();
    const guardian = { guardianName: 'Mona Saber', guardianPhone: '0128 888 0042', guardianConsent: 'on' };
    const hana = createWebsiteLead(t.db, applyForm({ firstName: 'Hana', lastName: 'Saber', phone: '0128 888 0042', dateOfBirth: addDays(today, -10 * 366), ...guardian }), { courseId: null, today });
    const newBefore = (await director.get('/api/dashboard')).body.counts.newWebsiteLeads;
    const karim = createWebsiteLead(t.db, applyForm({ firstName: 'Karim', lastName: 'Saber', phone: '+20 128 888 0042', dateOfBirth: addDays(today, -8 * 366), ...guardian }), { courseId: null, today });
    expect(karim.created).toBe(true);
    expect(karim.leadId).not.toBe(hana.leadId);
    expect(t.db.select().from(leads).all()).toHaveLength(2);
    expect(newBefore).toBe(1);
    expect((await director.get('/api/dashboard')).body.counts.newWebsiteLeads).toBe(2);
    const lead = (await director.get<LeadDetail>(`/api/leads/${karim.leadId}`)).body;
    expect(lead).toMatchObject({ firstName: 'Karim', status: 'new', source: 'website', dateOfBirth: addDays(today, -8 * 366) });
    expect(lead.notes).toContain(`Same phone as enquiry #${hana.leadId} (Hana Saber)`);
    expect(lead.activities[0]!.body).toContain(`Same phone as enquiry #${hana.leadId} (Hana Saber)`);
    // Hana's lead is untouched.
    expect(t.db.select().from(leadActivities).where(eq(leadActivities.leadId, hana.leadId)).all()).toHaveLength(1);

    // The same first name with another date of birth is someone else too; the same child again is not.
    const twin = createWebsiteLead(t.db, applyForm({ firstName: 'Hana', lastName: 'Saber', phone: '0128 888 0042', dateOfBirth: addDays(today, -12 * 366), ...guardian }), { courseId: null, today });
    expect(twin.created).toBe(true);
    const again = createWebsiteLead(t.db, applyForm({ firstName: 'هَنا', lastName: 'x', phone: '0128 888 0042', dateOfBirth: addDays(today, -10 * 366), ...guardian }), { courseId: null, today });
    expect(again.created).toBe(true);
    const sameChild = createWebsiteLead(t.db, applyForm({ firstName: 'Karim', lastName: 'S.', phone: '0128 888 0042', dateOfBirth: addDays(today, -8 * 366), ...guardian }), { courseId: null, today });
    expect(sameChild).toEqual({ leadId: karim.leadId, created: false });
  });

  it('sameLeadPerson: first names must agree; then the date of birth when both have one, else the family names', () => {
    const lead = { firstName: 'أحمد', lastName: 'علي', dateOfBirth: null as string | null };
    expect(sameLeadPerson(lead, { firstName: 'احمد ', lastName: 'علي', dateOfBirth: '2000-01-01' })).toBe(true);
    expect(sameLeadPerson(lead, { firstName: 'أحمد', lastName: 'حسن', dateOfBirth: '2000-01-01' })).toBe(false);
    expect(sameLeadPerson(lead, { firstName: 'محمد', lastName: 'علي', dateOfBirth: '2000-01-01' })).toBe(false);
    expect(sameLeadPerson({ ...lead, dateOfBirth: '2000-01-01' }, { firstName: 'أحمد', lastName: 'حسن', dateOfBirth: '2000-01-01' })).toBe(true);
    expect(sameLeadPerson({ ...lead, dateOfBirth: '2000-01-01' }, { firstName: 'أحمد', lastName: 'علي', dateOfBirth: '2001-01-01' })).toBe(false);
    expect(sameLeadPerson({ firstName: 'Laila', lastName: 'M', dateOfBirth: null }, { firstName: 'LAILA', lastName: 'Mostafa', dateOfBirth: null })).toBe(true);
    expect(sameLeadPerson({ firstName: 'Laila', lastName: '', dateOfBirth: null }, { firstName: 'laila', lastName: 'Mostafa', dateOfBirth: null })).toBe(true);
  });

  it('under 18: guardian name, phone and consent are required, and travel with the lead', async () => {
    const t = await makeTestContext();
    const minorDob = addDays(todayISO(), -16 * 366);
    const parse = (o: Record<string, unknown>) => {
      const r = siteApplyInput(todayISO()).safeParse({
        firstName: 'Youssef',
        lastName: 'Amr',
        phone: '0111 555 7011',
        dateOfBirth: minorDob,
        experience: 'none',
        heardFrom: 'friend',
        privacyConsent: 'on',
        locale: 'ar',
        ...o,
      });
      return r.success ? r.data : [...new Set(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))];
    };
    expect(parse({})).toEqual(['guardianName: errors.required', 'guardianPhone: errors.required', 'guardianConsent: site:errors.guardianConsent']);
    expect(parse({ guardianName: 'Amr Hussein', guardianPhone: '0111 555 7012', privacyConsent: undefined, guardianConsent: 'on' })).toEqual([
      'privacyConsent: site:errors.privacyConsent',
    ]);
    expect(parse({ dateOfBirth: addDays(todayISO(), -3 * 366), guardianName: 'A', guardianPhone: '0111 555 7012', guardianConsent: 'on' })).toEqual([
      'dateOfBirth: site:errors.ageRange',
    ]);
    expect(parse({ phone: '123', guardianName: 'A', guardianPhone: '0111 555 7012', guardianConsent: 'on' })).toEqual(['phone: site:errors.invalidPhone']);
    expect(parse({ experience: 'expert', guardianName: 'A', guardianPhone: '0111 555 7012', guardianConsent: 'on' })).toHaveLength(1);

    const input = parse({ guardianName: 'Amr Hussein', guardianPhone: '0111 555 7012', guardianConsent: 'on' });
    expect(Array.isArray(input)).toBe(false);
    const { leadId } = createWebsiteLead(t.db, input as Exclude<typeof input, string[]>, { courseId: null, today: todayISO() });
    const lead = t.db.select().from(leads).where(eq(leads.id, leadId)).get()!;
    expect(lead).toMatchObject({ guardianName: 'Amr Hussein', guardianPhone: '0111 555 7012', dateOfBirth: minorDob, email: null });
    expect(lead.notes).toContain('Under 18 — guardian: Amr Hussein (0111 555 7012), consent given');
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
    const screenOnSite = findPublicWorkshop(t.db, screen.id, todayISO())!;
    expect(screenOnSite).toMatchObject({ title: { en: 'Screen Acting I', ar: 'التمثيل أمام الكاميرا 1' }, coach: { en: 'Layla Haddad', ar: 'ليلى حداد' }, acceptingApplications: true });
    // No prices in the demo either.
    expect(Object.keys(screenOnSite).filter((k) => /price/i.test(k))).toEqual([]);

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
