import { and, count, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { castingApplicationPhotos, castingApplications, courseSlots, courses, files, leadActivities, leads, rateLimits, siteCoaches, siteWorkshops } from '../../src/server/db/schema';
import { saveSiteContent } from '../../src/server/lib/siteContent';
import { FORM_TOKEN_MAX_AGE_MS, issueFormToken, SITE_RATE_LIMITS } from '../../src/server/lib/siteForms';
import { CASTING_IN_FLIGHT_MAX_BYTES, SITE_READ_DEADLINE_MS, castingBytesReserved } from '../../src/server/site/submit';
import { HONEYPOT_FIELD, TOKEN_FIELD } from '../../src/server/site/forms';
import { SITE_CSP } from '../../src/server/site/headers';
import { SITE_STRINGS } from '../../src/server/site/i18n';
import { addDays } from '../../src/shared/dates';
import * as phone from '../../src/shared/phone';
import { castingApplicationInput } from '../../src/shared/schemas/castingApplications';
import { SITE_APPLY_MAX_BYTES, SITE_CASTING_MAX_BYTES, type SiteContent } from '../../src/shared/schemas/site';
import { makeTestContext, PNG_1PX, todayISO, uploadPng } from '../helpers';

/**
 * The public website (src/server/site/): pages, the two forms and their
 * guards, /site/media. The staff API and the library functions behind it are
 * in site.test.ts; the Worker's host routing in tests/unit/workerRouting.test.ts.
 */

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const IP_HEADER = 'x-test-client-ip';
/** Each request comes from its own address unless the test names one (so the per-address limits only bite where tested). */
let requestNo = 0;
const ctx = () => makeTestContext({ clientIp: (c) => c.req.header(IP_HEADER) ?? `198.51.${Math.floor(++requestNo / 250) % 250}.${requestNo % 250}` });

/** A tiny "JPEG" (only its first bytes are checked) and a file that only claims to be one. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const NOT_AN_IMAGE = new TextEncoder().encode('<html><script>alert(1)</script></html>');

function content(o: Partial<SiteContent> = {}): SiteContent {
  return {
    ...getSiteContentDefaults(),
    tagline: { en: 'Acting workshops in Giza', ar: 'ورش تمثيل في الجيزة' },
    about: { en: 'We teach acting.\n\nCome and visit.', ar: 'نعلّم التمثيل.' },
    address: { en: 'Mohandessin, Giza', ar: 'المهندسين، الجيزة' },
    mapUrl: 'https://maps.google.com/?q=Mohandessin',
    instagram: 'turquoisecastingstudio',
    whatsappWorkshops: '01094635959',
    whatsappCasting: '01119003100',
    phone: '01094635959',
    castingCall: { open: true, intro: { en: 'We are casting a new series.', ar: 'نختار ممثلين لمسلسل جديد.' }, lookingFor: { en: 'Everyone', ar: 'الجميع' } },
    links: [
      { id: 'a1', label: { en: 'Showreel', ar: 'فيديو الأعمال' }, url: 'https://vimeo.com/x', visible: true },
      { id: 'b2', label: { en: 'Hidden link', ar: 'رابط مخفي' }, url: 'https://example.com/hidden', visible: false },
    ],
    ...o,
  };
}
function getSiteContentDefaults(): SiteContent {
  return {
    tagline: { en: '', ar: '' },
    about: { en: '', ar: '' },
    address: { en: '', ar: '' },
    mapUrl: null,
    instagram: null,
    whatsappWorkshops: null,
    whatsappCasting: null,
    phone: null,
    email: null,
    heroFileId: null,
    castingCall: { open: false, intro: { en: '', ar: '' }, lookingFor: { en: '', ar: '' } },
    links: [],
  };
}

/** A course shown on the site (Saturdays and Tuesdays 18:00–20:00), overrides for the course and its site row. */
function workshop(t: Ctx, o: Partial<typeof courses.$inferInsert> = {}, site: Partial<typeof siteWorkshops.$inferInsert> = {}) {
  const today = todayISO();
  const c = t.db
    .insert(courses)
    .values({ name: `Screen Acting ${Math.random().toString(36).slice(2, 6)}`, startDate: addDays(today, 7), endDate: addDays(today, 60), ...o })
    .returning()
    .get()!;
  t.db.insert(courseSlots).values([
    { courseId: c.id, weekday: 6, startTime: '18:00', endTime: '20:00' },
    { courseId: c.id, weekday: 2, startTime: '18:00', endTime: '20:00' },
  ]).run();
  t.db.insert(siteWorkshops).values({ courseId: c.id, visible: true, ...site }).run();
  return c;
}

const get = (t: Ctx, path: string, headers: Record<string, string> = {}) => t.app.request(path, { headers });

/** A valid token issued `ageMs` ago. */
const token = (t: Ctx, kind: 'apply' | 'casting', ageMs = 10_000) => issueFormToken(t.db, kind, Date.now() - ageMs);

/** The enquiry form's fields, valid unless overridden (null removes a field). */
function applyFields(t: Ctx, o: Record<string, string | null> = {}) {
  const fields: Record<string, string | null> = {
    [TOKEN_FIELD]: token(t, 'apply'),
    [HONEYPOT_FIELD]: '',
    firstName: 'Mona',
    lastName: 'Adel',
    phone: '0101 234 5678',
    email: '',
    dateOfBirth: addDays(todayISO(), -30 * 366),
    experience: 'some',
    heardFrom: 'instagram',
    message: 'Which days?',
    guardianName: '',
    guardianPhone: '',
    privacyConsent: 'on',
    ...o,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)) as Record<string, string>;
}

function postForm(t: Ctx, path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const body = new URLSearchParams(fields).toString();
  return t.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(body)), ...headers },
    body,
  });
}

/** The casting form as multipart (photos as files on photo1…). */
function castingForm(t: Ctx, o: Record<string, string | null> = {}, photos: { name?: string; data: Uint8Array; field?: string }[] = [{ data: JPEG }]) {
  const fields: Record<string, string | null> = {
    [TOKEN_FIELD]: token(t, 'casting'),
    [HONEYPOT_FIELD]: '',
    firstName: 'Karim',
    lastName: 'Nabil',
    gender: 'male',
    dateOfBirth: addDays(todayISO(), -24 * 366),
    phone: '+20 122 555 0101',
    email: 'karim@example.com',
    city: 'Giza',
    heightCm: '180',
    languages: 'Arabic, English',
    skills: 'Dance',
    experience: 'Two adverts',
    links: 'https://www.instagram.com/karim/',
    message: '',
    privacyConsent: 'on',
    ...o,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null) fd.append(k, v);
  photos.forEach((p, i) => fd.append(p.field ?? `photo${i + 1}`, new Blob([p.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), p.name ?? `p${i}.jpg`));
  return fd;
}

const postCasting = (t: Ctx, lang: string, fd: FormData, headers: Record<string, string> = {}) =>
  t.app.request(`/site/${lang}/casting-call`, { method: 'POST', body: fd, headers });

const websiteLeads = (t: Ctx) => t.db.select().from(leads).where(eq(leads.source, 'website')).all();
const applicationCount = (t: Ctx) => t.db.select({ n: count() }).from(castingApplications).get()!.n;

/** A rate-limit counter as it stands (0 without a row), and setting one. */
const used = (t: Ctx, key: string) => t.db.select().from(rateLimits).where(eq(rateLimits.key, key)).get()?.count ?? 0;
function seed(t: Ctx, key: string, n: number) {
  t.db.insert(rateLimits).values({ key, count: n, windowStart: Date.now() - 60_000 }).onConflictDoUpdate({ target: rateLimits.key, set: { count: n } }).run();
}

/** A form as the bytes a browser would send, with its content type (the multipart boundary). */
async function encoded(fd: FormData) {
  const r = new Response(fd);
  return { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type')! };
}

const CHUNK = 64 * 1024;
/** A form as a body without a Content-Length, handed over in 64 KB pieces — and how many bytes the server asked for. */
async function countingBody(fd: FormData) {
  const { bytes, contentType } = await encoded(fd);
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(at, at + CHUNK));
      at += CHUNK;
    },
  });
  return { stream, contentType, pulled: () => Math.min(at, bytes.byteLength) };
}

/** A casting POST whose body has started and neither ends nor fails until told to. */
function heldCasting(t: Ctx, headers: Record<string, string> = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const response = t.app.request('/site/en/casting-call', {
    method: 'POST',
    body: stream,
    headers: { 'content-type': 'multipart/form-data; boundary=held', ...headers },
    duplex: 'half',
  } as RequestInit);
  return { response: Promise.resolve(response), end: () => controller.close(), fail: () => controller.error(new Error('connection lost')) };
}

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
/** The "Back to the form" link of an error page. */
const backHref = (html: string) => new RegExp(`<a class="btn btn-primary" href="([^"]+)">[^]*?${SITE_STRINGS.en.pages.backToForm}`).exec(html)?.[1];

afterEach(() => {
  vi.useRealTimers();
});

describe('/site pages', () => {
  it('GET /site redirects by Accept-Language (Arabic preferred → /site/ar, else /site/en)', async () => {
    const t = await ctx();
    const ar = await get(t, '/site', { 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.8' });
    expect(ar.status).toBe(302);
    expect(ar.headers.get('location')).toBe('/site/ar');
    expect(ar.headers.get('cache-control')).toBe('no-store');
    expect((await get(t, '/site', { 'accept-language': 'en-US,en;q=0.9,ar;q=0.5' })).headers.get('location')).toBe('/site/en');
    expect((await get(t, '/site', { 'accept-language': 'fr-FR' })).headers.get('location')).toBe('/site/en');
    expect((await get(t, '/site', { 'accept-language': 'fr;q=0.9, ar;q=0.8' })).headers.get('location')).toBe('/site/ar');
    expect((await get(t, '/site')).headers.get('location')).toBe('/site/en');
    // One spelling per page.
    const slash = await get(t, '/site/en/workshops/');
    expect(slash.status).toBe(301);
    expect(slash.headers.get('location')).toBe('/site/en/workshops');
    // "/site/" too (it used to be the 404 page).
    const rootSlash = await get(t, '/site/');
    expect(rootSlash.status).toBe(301);
    expect(rootSlash.headers.get('location')).toBe('/site');
  });

  it('the trailing-slash redirect keeps the path encoded: no backslash, tab or line break in Location, never a 500', async () => {
    const t = await ctx();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const sneaky of ['/site/%5Cevil.example/', '/site/%09/evil.example/', '/site/%0D%0ASet-Cookie:x=1/', '/site/en/%0A/', '/site//evil.example/']) {
      const res = await get(t, sneaky);
      expect([301, 404], sneaky).toContain(res.status);
      expect(res.headers.get('set-cookie')).toBeNull();
      const location = res.headers.get('location');
      if (location === null) continue;
      expect(location, sneaky).toMatch(/^\/site\/[\x21-\x7e]*$/);
      expect(location, sneaky).not.toContain('\\');
      expect(new URL(location, 'http://localhost/').host).toBe('localhost');
    }
    expect(quiet).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('every page renders in both languages with lang/dir, the security headers and a one-minute cache', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t);
    for (const lang of ['en', 'ar'] as const) {
      for (const path of ['', '/workshops', `/workshops/${w.id}`, '/apply', '/casting-call', '/links']) {
        const res = await get(t, `/site/${lang}${path}`);
        expect(res.status, `${lang}${path}`).toBe(200);
        const body = await res.text();
        expect(body).toContain(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`);
        expect(res.headers.get('content-security-policy')).toBe(SITE_CSP);
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
        expect(res.headers.get('cache-control')).toBe('public, max-age=60');
        // No client JavaScript, no external resources.
        expect(body).not.toMatch(/<script|javascript:|https?:\/\/[^"]*\.(css|js)\b/i);
        // The language switch points at the same page in the other language.
        const other = lang === 'ar' ? 'en' : 'ar';
        expect(body).toContain(`href="/site/${other}${path}" hreflang="${other}"`);
        expect(body).toContain(`<link rel="alternate" hreflang="ar" href="http://localhost/site/ar${path}">`);
      }
    }
    const thanks = await get(t, '/site/ar/thanks?k=casting');
    expect(thanks.status).toBe(200);
    expect(thanks.headers.get('cache-control')).toBe('no-store');
    const thanksBody = await thanks.text();
    expect(thanksBody).toContain(SITE_STRINGS.ar.thanks.castingTitle);
    // The forms redirect to …#thanks: the page has that anchor.
    expect(thanksBody).toContain('id="thanks"');
  });

  it('home: hero, about paragraphs, workshops with dates/days/coach, casting banner, coaches, contact — and no prices', async () => {
    const t = await ctx();
    const director = await t.as('executive_director');
    const hero = await uploadPng(director);
    saveSiteContent(t.db, content({ heroFileId: hero }));
    const coach = await t.createUser('acting_coach', { name: 'Layla Staff' });
    const w = workshop(t, { name: 'Screen Acting I', teacherId: coach.id, startDate: '2030-01-05', endDate: '2030-03-30' }, { titleAr: 'التمثيل أمام الكاميرا' });
    t.db.insert(siteCoaches).values({ nameEn: 'Layla Haddad', nameAr: 'ليلى حداد', titleEn: 'Screen coach', bioEn: 'Fifteen years on TV.', userId: coach.id, visible: true }).run();
    t.db.insert(siteCoaches).values({ nameEn: 'Hidden Coach', visible: false }).run();

    const en = await (await get(t, '/site/en')).text();
    expect(en).toContain('<p>We teach acting.</p><p>Come and visit.</p>');
    expect(en).toContain('Screen Acting I');
    expect(en).toContain('5 January 2030 to 30 March 2030');
    expect(en).toContain('Tuesday and Saturday, 18:00 – 20:00');
    expect(en).toContain('Layla Haddad');
    expect(en).not.toContain('Hidden Coach');
    expect(en).toContain(SITE_STRINGS.en.home.castingTitle);
    expect(en).toContain(`src="/site/media/${hero}"`);
    expect(en).toContain(`<meta property="og:image" content="http://localhost/site/media/${hero}">`);
    expect(en).toContain(`href="/site/en/workshops/${w.id}#apply"`);
    expect(en).toContain('href="tel:01094635959"');
    expect(en).toContain('https://www.instagram.com/turquoisecastingstudio/');
    // "Ask about fees on WhatsApp": the workshops line, a message naming the workshop in the page's language.
    const feesEn = `https://wa.me/201094635959?text=${encodeURIComponent(`Hello, I would like to know the fees for the “Screen Acting I” workshop.`)}`;
    expect(en).toContain(`href="${feesEn}"`);
    expect(en).toContain(SITE_STRINGS.en.workshop.askFees);
    const ar = await (await get(t, '/site/ar')).text();
    expect(ar).toContain('التمثيل أمام الكاميرا');
    expect(ar).toContain(`https://wa.me/201094635959?text=${encodeURIComponent('مرحبًا، أود معرفة رسوم ورشة «التمثيل أمام الكاميرا».')}`);
    expect(ar).toContain('ليلى حداد');
    // No price anywhere (the school's decision).
    for (const body of [en, ar]) expect(body).not.toMatch(/price|EGP|جنيه|ج\.م|\bLE\b/i);
  });

  it('stored content containing <script> comes out escaped', async () => {
    const t = await ctx();
    const evil = '<script>alert("x")</script>';
    saveSiteContent(
      t.db,
      content({
        tagline: { en: evil, ar: evil },
        about: { en: `${evil}\n\n<img src=x onerror=alert(1)>`, ar: evil },
        address: { en: '"><script>1</script>', ar: '' },
        links: [{ id: 'x1', label: { en: evil, ar: evil }, url: 'https://example.com/?q="><script>', visible: true }],
      }),
    );
    workshop(t, {}, { titleEn: evil, descriptionEn: evil });
    t.db.insert(siteCoaches).values({ nameEn: evil, bioEn: evil, visible: true }).run();
    for (const path of ['/site/en', '/site/en/workshops', '/site/en/links', '/site/en/casting-call']) {
      const body = await (await get(t, path)).text();
      expect(body, path).not.toContain('<script>');
      expect(body, path).not.toContain('<img src=x');
      expect(body, path).toContain('&lt;script&gt;');
    }
  });

  it('a workshop that is hidden, archived, over or missing is a friendly 404 in the right language', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const hidden = workshop(t, {}, { visible: false });
    const archived = workshop(t, { status: 'archived' });
    const over = workshop(t, { startDate: addDays(todayISO(), -30), endDate: addDays(todayISO(), -1) });
    for (const id of [hidden.id, archived.id, over.id, 99999, 'abc']) {
      const res = await get(t, `/site/ar/workshops/${id}`);
      expect(res.status, String(id)).toBe(404);
      const body = await res.text();
      expect(body).toContain('<html lang="ar" dir="rtl">');
      expect(body).toContain(SITE_STRINGS.ar.pages.notFoundTitle);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toBe(SITE_CSP);
    }
    // …and they are not listed or applied to.
    const list = await (await get(t, '/site/en/workshops')).text();
    for (const c of [hidden, archived, over]) expect(list).not.toContain(c.name);
    expect((await postForm(t, `/site/en/workshops/${hidden.id}/apply`, applyFields(t))).status).toBe(404);
    expect(websiteLeads(t)).toHaveLength(0);
  });

  it('unknown /site paths: a friendly 404 in the path’s language, else the browser’s', async () => {
    const t = await ctx();
    const en = await get(t, '/site/en/no-such-page');
    expect(en.status).toBe(404);
    expect(await en.text()).toContain(SITE_STRINGS.en.pages.notFoundTitle);
    const fr = await get(t, '/site/fr', { 'accept-language': 'ar' });
    expect(fr.status).toBe(404);
    expect(await fr.text()).toContain('<html lang="ar" dir="rtl">');
    expect((await get(t, '/site/media')).status).toBe(404);
  });

  it('a workshop not accepting applications shows no form and refuses a POST', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t, {}, { acceptingApplications: false });
    const body = await (await get(t, `/site/en/workshops/${w.id}`)).text();
    expect(body).toContain(SITE_STRINGS.en.workshop.notAccepting);
    expect(body).not.toContain('<form');
    expect((await postForm(t, `/site/en/workshops/${w.id}/apply`, applyFields(t))).status).toBe(404);
  });

  it('links page: open workshops accepting applications, the casting call when open, WhatsApp, Instagram, then the visible custom links', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const open = workshop(t, { name: 'Open One' });
    workshop(t, { name: 'Closed One' }, { acceptingApplications: false });
    const body = await (await get(t, '/site/en/links')).text();
    expect(body).toContain(`href="/site/en/workshops/${open.id}#apply"`);
    expect(body).not.toContain('Closed One');
    expect(body).toContain('href="/site/en/casting-call"');
    expect(body).toContain('https://wa.me/201094635959');
    expect(body).toContain('https://wa.me/201119003100');
    expect(body).toContain('href="https://vimeo.com/x"');
    expect(body).not.toContain('example.com/hidden');
    const order = ['Open One', SITE_STRINGS.en.links.castingCall, SITE_STRINGS.en.links.whatsappWorkshops, 'Showreel'].map((s) => body.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Casting call closed → no button.
    saveSiteContent(t.db, content({ castingCall: { ...content().castingCall, open: false } }));
    expect(await (await get(t, '/site/en/links')).text()).not.toContain('href="/site/en/casting-call"');
  });
});

describe('the enquiry form', () => {
  it('a valid workshop enquiry creates a website lead and redirects (303) to the thank-you page', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t, { name: 'Voice and Speech' });
    const res = await postForm(t, `/site/ar/workshops/${w.id}/apply`, applyFields(t), { origin: 'http://localhost' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/site/ar/thanks?k=apply#thanks');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe(SITE_CSP);
    const [lead] = websiteLeads(t);
    expect(lead).toMatchObject({ firstName: 'Mona', lastName: 'Adel', phone: '0101 234 5678', source: 'website', sourceDetail: 'Voice and Speech', preferredCourseId: w.id, status: 'new' });
    expect(lead!.notes).toContain('Which days?');
    expect(lead!.notes).toContain('Arabic website');
  });

  it('the general form ("Ask us") creates a general enquiry; the same phone again adds a note to that lead instead of a duplicate', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    expect((await postForm(t, '/site/en/apply', applyFields(t))).status).toBe(303);
    const [lead] = websiteLeads(t);
    expect(lead).toMatchObject({ sourceDetail: 'general', preferredCourseId: null });
    // Same person, number written differently.
    expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '+20 101 234 5678', message: 'Me again' }))).status).toBe(303);
    expect(websiteLeads(t)).toHaveLength(1);
    const notes = t.db.select().from(leadActivities).where(eq(leadActivities.leadId, lead!.id)).all().map((a) => a.body ?? '');
    expect(notes.some((b) => b.startsWith('Applied again on the website: general') && b.includes('Me again'))).toBe(true);
  });

  it('two children enquiring from one parent’s phone become two leads', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t, { name: 'Kids Drama' });
    const guardian = { phone: '0128 888 0042', guardianName: 'Mona Saber', guardianPhone: '0128 888 0042', guardianConsent: 'on' };
    const child = (firstName: string, age: number) => applyFields(t, { ...guardian, firstName, lastName: 'Saber', dateOfBirth: addDays(todayISO(), -age * 366) });
    expect((await postForm(t, `/site/en/workshops/${w.id}/apply`, child('Hana', 10))).status).toBe(303);
    expect((await postForm(t, `/site/ar/workshops/${w.id}/apply`, child('Karim', 8))).status).toBe(303);
    expect(websiteLeads(t).map((l) => l.firstName).sort()).toEqual(['Hana', 'Karim']);
    expect(websiteLeads(t).every((l) => l.status === 'new')).toBe(true);
  });

  it('a validation error re-renders the form: summary with links, messages next to fields, values kept, nothing stored', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const res = await postForm(t, '/site/en/apply', applyFields(t, { firstName: '', phone: '12', privacyConsent: null, message: 'Keep <this> text' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    const s = SITE_STRINGS.en;
    expect(body).toContain(s.errors.summaryTitle);
    expect(body).toContain(`<a href="#f-firstName">${s.form.firstName}: ${s.errors.required}</a>`);
    expect(body).toContain(`<p class="err" id="e-phone">`);
    expect(body).toContain(s.formErrors.invalidPhone);
    expect(body).toContain(s.formErrors.privacyConsent);
    expect(body).toContain('aria-invalid="true"');
    expect(body).toContain('value="Adel"');
    expect(body).toContain('Keep &lt;this&gt; text</textarea>');
    expect(body).toMatch(/<input type="radio" name="experience" value="some" checked/);
    expect(body).toContain('<meta name="robots" content="noindex">');
    expect(websiteLeads(t)).toHaveLength(0);
  });

  it('under 18: guardian name, phone and consent are required, then travel with the lead', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const minor = { dateOfBirth: addDays(todayISO(), -14 * 366) };
    const missing = await postForm(t, '/site/ar/apply', applyFields(t, minor));
    expect(missing.status).toBe(400);
    const body = await missing.text();
    expect(body).toContain('id="e-guardianName"');
    expect(body).toContain('id="e-guardianPhone"');
    expect(body).toContain(SITE_STRINGS.ar.formErrors.guardianConsent);
    expect(websiteLeads(t)).toHaveLength(0);
    const ok = await postForm(t, '/site/ar/apply', applyFields(t, { ...minor, guardianName: 'وائل', guardianPhone: '0100 555 7099', guardianConsent: 'on' }));
    expect(ok.status).toBe(303);
    expect(websiteLeads(t)[0]).toMatchObject({ guardianName: 'وائل', guardianPhone: '0100 555 7099' });
    // Too young or a date that isn't one.
    const tooYoung = await postForm(t, '/site/en/apply', applyFields(t, { dateOfBirth: addDays(todayISO(), -2 * 365) }));
    expect(await tooYoung.text()).toContain(SITE_STRINGS.en.formErrors.ageRange);
    expect(await (await postForm(t, '/site/en/apply', applyFields(t, { dateOfBirth: '2001-02-30' }))).text()).toContain(SITE_STRINGS.en.errors.invalidDate);
  });

  it('honeypot filled: pretends success (303 to thanks) and stores nothing', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const res = await postForm(t, '/site/en/apply', applyFields(t, { [HONEYPOT_FIELD]: 'https://spam.example' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/site/en/thanks?k=apply#thanks');
    expect(websiteLeads(t)).toHaveLength(0);
  });

  it('form token: too fast, too old, forged, for the other form or missing → "please try again", nothing stored', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const bad = [
      issueFormToken(t.db, 'apply', Date.now() - 500),
      issueFormToken(t.db, 'apply', Date.now() - FORM_TOKEN_MAX_AGE_MS - 60_000),
      `${Date.now() - 10_000}.${'a'.repeat(64)}`,
      issueFormToken(t.db, 'casting', Date.now() - 10_000),
      null,
    ];
    for (const tok of bad) {
      const res = await postForm(t, '/site/en/apply', applyFields(t, { [TOKEN_FIELD]: tok }));
      expect(res.status, String(tok)).toBe(400);
      const body = await res.text();
      expect(body).toContain(SITE_STRINGS.en.errors.tryAgain);
      // A fresh token comes with the form again, and the answers are kept.
      expect(body).toMatch(new RegExp(`name="${TOKEN_FIELD}" value="\\d+\\.[0-9a-f]{64}"`));
      expect(body).toContain('value="Mona"');
    }
    expect(websiteLeads(t)).toHaveLength(0);
  });

  it('a page’s own token works after 3 seconds (the real round trip)', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const page = await (await get(t, '/site/en/apply')).text();
    const tok = new RegExp(`name="${TOKEN_FIELD}" value="([^"]+)"`).exec(page)![1]!;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 4_000);
    expect((await postForm(t, '/site/en/apply', applyFields(t, { [TOKEN_FIELD]: tok }))).status).toBe(303);
  });

  it('an Origin from another site is refused (403), stores nothing; no Origin header is fine', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const res = await postForm(t, '/site/en/apply', applyFields(t), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(SITE_STRINGS.en.pages.forbiddenTitle);
    expect((await postForm(t, '/site/en/apply', applyFields(t), { origin: 'null' })).status).toBe(403);
    expect(websiteLeads(t)).toHaveLength(0);
    expect((await postForm(t, '/site/en/apply', applyFields(t))).status).toBe(303);
  });

  it('rate limits: 5 an hour per address, then a friendly 429 page; another address still gets through', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    for (let i = 0; i < SITE_RATE_LIMITS.apply.perAddress.limit; i++) {
      const res = await postForm(t, '/site/en/apply', applyFields(t, { phone: `0100 000 00${10 + i}` }), { [IP_HEADER]: '203.0.113.9' });
      expect(res.status, `try ${i + 1}`).toBe(303);
    }
    const limited = await postForm(t, '/site/ar/apply', applyFields(t, { phone: '0100 000 0099' }), { [IP_HEADER]: '203.0.113.9' });
    expect(limited.status).toBe(429);
    const body = await limited.text();
    expect(body).toContain('<html lang="ar" dir="rtl">');
    expect(body).toContain(SITE_STRINGS.ar.pages.tooManyTitle);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect(websiteLeads(t)).toHaveLength(5);
    expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '0100 000 0098' }), { [IP_HEADER]: '203.0.113.10' })).status).toBe(303);
  });

  it('the school-wide daily limit stops everyone', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    t.db.insert(rateLimits).values({ key: 'site:apply:school', count: SITE_RATE_LIMITS.apply.school.limit, windowStart: Date.now() - 60_000 }).run();
    expect((await postForm(t, '/site/en/apply', applyFields(t), { [IP_HEADER]: '192.0.2.44' })).status).toBe(429);
    expect(websiteLeads(t)).toHaveLength(0);
  });

  it('a body over 64 KB is refused (413) by its Content-Length or while reading one without', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const big = applyFields(t, { message: 'x'.repeat(SITE_APPLY_MAX_BYTES) });
    const declared = await postForm(t, '/site/en/apply', big);
    expect(declared.status).toBe(413);
    expect(await declared.text()).toContain(SITE_STRINGS.en.pages.tooLargeTitle);
    const bytes = new TextEncoder().encode(new URLSearchParams(big).toString());
    const streamed = await t.app.request('/site/en/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 8192) controller.enqueue(bytes.slice(i, i + 8192));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(websiteLeads(t)).toHaveLength(0);
    // Nothing stored was counted: only the streamed body's attempt (its size is unknown until it is read; the declared one was refused before).
    expect(t.db.select().from(rateLimits).all().map((r) => r.key.replace(/:[^:]+$/, ''))).toEqual(['site:apply:attempts']);
  });

  it('GET on …/apply after a failed POST shows the workshop again', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t);
    const res = await get(t, `/site/en/workshops/${w.id}/apply`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/site/en/workshops/${w.id}#apply`);
  });
});

describe('the casting-call form', () => {
  it('closed: the page says so with an Instagram link; a POST answers that page with 410 and stores nothing', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content({ castingCall: { open: false, intro: { en: '', ar: '' }, lookingFor: { en: '', ar: '' } } }));
    const page = await get(t, '/site/en/casting-call');
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain(SITE_STRINGS.en.casting.closedTitle);
    expect(body).toContain('https://www.instagram.com/turquoisecastingstudio/');
    expect(body).not.toContain('<form');
    const res = await postCasting(t, 'ar', castingForm(t));
    expect(res.status).toBe(410);
    expect(await res.text()).toContain(SITE_STRINGS.ar.casting.closedTitle);
    expect(applicationCount(t)).toBe(0);
    expect(t.db.select().from(files).all()).toHaveLength(0);
  });

  it('open: intro, who we look for and a multipart form; a valid application is stored with its photos and redirects to thanks', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const page = await (await get(t, '/site/en/casting-call')).text();
    expect(page).toContain('We are casting a new series.');
    expect(page).toContain('enctype="multipart/form-data"');
    expect(page).toContain('name="photo1" type="file" accept="image/jpeg,image/png,image/webp" required');
    for (const part of ['bday-day', 'bday-month', 'bday-year']) expect(page).toContain(`autocomplete="${part}"`);
    expect(page).toContain(SITE_STRINGS.en.form.privacyCasting);

    const res = await postCasting(t, 'en', castingForm(t, {}, [{ data: JPEG }, { data: PNG_1PX, name: 'second.png' }]), { origin: 'http://localhost' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/site/en/thanks?k=casting#thanks');
    const [app] = t.db.select().from(castingApplications).all();
    expect(app).toMatchObject({ firstName: 'Karim', lastName: 'Nabil', gender: 'male', heightCm: 180, languages: ['Arabic', 'English'], links: ['https://www.instagram.com/karim/'], locale: 'en', status: 'new' });
    const photos = t.db.select().from(castingApplicationPhotos).where(eq(castingApplicationPhotos.applicationId, app!.id)).all();
    expect(photos).toHaveLength(2);
    const stored = t.db.select().from(files).all();
    expect(stored.map((f) => f.mime).sort()).toEqual(['image/jpeg', 'image/png']);
    expect(stored.every((f) => f.uploadedBy === null)).toBe(true);
    // Application photos are never public.
    for (const f of stored) expect((await get(t, `/site/media/${f.id}`)).status).toBe(404);
  });

  it('photos: required, at most 3, real JPEG/PNG/WebP by their first bytes, each at most 6 MB — and must be chosen again after an error', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const s = SITE_STRINGS.en;
    const none = await postCasting(t, 'en', castingForm(t, {}, []));
    expect(none.status).toBe(400);
    const noneBody = await none.text();
    expect(noneBody).toContain(s.formErrors.photoRequired);
    expect(noneBody).toContain(s.form.photosAgain);
    expect(noneBody).toContain('value="Karim"');

    const four = await postCasting(t, 'en', castingForm(t, {}, [1, 2, 3, 4].map(() => ({ data: JPEG, field: 'photos' }))));
    expect(await four.text()).toContain(s.formErrors.tooManyPhotos);

    const fake = await postCasting(t, 'en', castingForm(t, {}, [{ data: JPEG }, { data: NOT_AN_IMAGE, name: 'evil.jpg' }]));
    expect(fake.status).toBe(400);
    const fakeBody = await fake.text();
    expect(fakeBody).toContain(`<a href="#f-photo2">${s.form.photo2}: ${s.formErrors.photoType}</a>`);

    const huge = new Uint8Array(6 * 1024 * 1024 + 1);
    huge.set(JPEG.slice(0, 4));
    const tooBig = await postCasting(t, 'en', castingForm(t, {}, [{ data: huge }]));
    expect(await tooBig.text()).toContain(s.formErrors.photoTooLarge);

    expect(applicationCount(t)).toBe(0);
    // Stored photos are removed again when a later one fails.
    expect(t.db.select().from(files).all()).toHaveLength(0);
  });

  it('under 18 needs the guardian and consent; https links only, at most 3', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const minor = await postCasting(t, 'ar', castingForm(t, { dateOfBirth: addDays(todayISO(), -12 * 366) }));
    expect(minor.status).toBe(400);
    expect(await minor.text()).toContain(SITE_STRINGS.ar.formErrors.guardianConsent);
    const links = await postCasting(t, 'en', castingForm(t, { links: 'http://insecure.example/me' }));
    expect(await links.text()).toContain(SITE_STRINGS.en.errors.invalidUrl);
    const many = await postCasting(t, 'en', castingForm(t, { links: 'https://a.example https://b.example https://c.example https://d.example' }));
    expect(await many.text()).toContain(SITE_STRINGS.en.formErrors.tooManyLinks);
    expect(applicationCount(t)).toBe(0);
    const ok = await postCasting(t, 'ar', castingForm(t, { dateOfBirth: addDays(todayISO(), -12 * 366), guardianName: 'أب', guardianPhone: '0100 555 0000', guardianConsent: 'on' }));
    expect(ok.status).toBe(303);
    expect(t.db.select().from(castingApplications).get()).toMatchObject({ guardianName: 'أب', guardianConsent: true, locale: 'ar' });
  });

  it('honeypot, token and Origin guards; 3 an hour per address (checked before the photos are read)', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    expect((await postCasting(t, 'en', castingForm(t, { [HONEYPOT_FIELD]: 'x' }))).status).toBe(303);
    expect((await postCasting(t, 'en', castingForm(t, { [TOKEN_FIELD]: issueFormToken(t.db, 'casting', Date.now()) }))).status).toBe(400);
    expect((await postCasting(t, 'en', castingForm(t), { origin: 'https://evil.example' })).status).toBe(403);
    expect(applicationCount(t)).toBe(0);

    const ip = { [IP_HEADER]: '203.0.113.50' };
    for (let i = 0; i < SITE_RATE_LIMITS.casting.perAddress.limit; i++) expect((await postCasting(t, 'en', castingForm(t, { phone: `0122 555 01${10 + i}` }), ip)).status).toBe(303);
    const limited = await postCasting(t, 'en', castingForm(t), ip);
    expect(limited.status).toBe(429);
    expect(applicationCount(t)).toBe(3);
    // Only the photos kept count against the daily photo allowance — not the bodies, the honeypot's or the refused ones.
    expect(used(t, 'site:casting:photo-bytes')).toBe(3 * JPEG.byteLength);
    expect(used(t, 'site:casting:school')).toBe(3);
  });

  it('the daily photo allowance (300 MB kept, school-wide): photos that no longer fit are refused and nothing is stored; a spent allowance refuses before the body is read', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const limit = SITE_RATE_LIMITS.casting.photoBytes.limit;
    seed(t, 'site:casting:photo-bytes', limit - 10);
    const res = await postCasting(t, 'en', castingForm(t));
    expect(res.status).toBe(429);
    expect(await res.text()).toContain(SITE_STRINGS.en.pages.tooManyTitle);
    expect(applicationCount(t)).toBe(0);
    expect(t.db.select().from(files).all()).toHaveLength(0);
    expect(used(t, 'site:casting:photo-bytes')).toBe(limit - 10);
    expect(used(t, 'site:casting:school')).toBe(0);

    seed(t, 'site:casting:photo-bytes', limit);
    const body = await countingBody(castingForm(t));
    const spent = await t.app.request('/site/en/casting-call', { method: 'POST', body: body.stream, headers: { 'content-type': body.contentType }, duplex: 'half' } as RequestInit);
    expect(spent.status).toBe(429);
    expect(body.pulled()).toBeLessThanOrEqual(CHUNK);
  });

  it('accept → talent through the staff API, after a public application', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    expect((await postCasting(t, 'en', castingForm(t))).status).toBe(303);
    const head = await t.as('head_of_casting');
    const list = await head.get('/api/casting-applications');
    expect(list.body.items).toHaveLength(1);
    const accepted = await head.post(`/api/casting-applications/${list.body.items[0].id}/accept`);
    expect(accepted.status).toBe(201);
    expect((await head.get(`/api/talent/${accepted.body.talentId}`)).body).toMatchObject({ firstName: 'Karim', lastName: 'Nabil' });
  });
});

describe('abuse limits: what junk can and cannot do', () => {
  it('junk POSTs (no token, a filled honeypot, invalid fields) never use up the school-wide allowance: the next real visitor gets through', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const n = SITE_RATE_LIMITS.apply.school.limit;
    for (let i = 0; i < n; i++) {
      const junk =
        i % 3 === 0
          ? postForm(t, '/site/en/apply', { x: '1' })
          : i % 3 === 1
            ? postForm(t, '/site/en/apply', applyFields(t, { [HONEYPOT_FIELD]: 'spam' }))
            : postForm(t, '/site/en/apply', applyFields(t, { phone: '12' }));
      const res = await junk;
      expect([400, 303]).toContain(res.status);
    }
    expect(websiteLeads(t)).toHaveLength(0);
    expect(used(t, 'site:apply:school')).toBe(0);
    for (const path of ['/site/en/apply', '/site/ar/apply']) expect((await postForm(t, path, applyFields(t, { phone: `0100 77${path.length} 0000` }))).status, path).toBe(303);
    expect(used(t, 'site:apply:school')).toBe(2);
  });

  it('the casting form: a token-less POST, a refused form and a declared length without a body use up nothing of the day’s allowances', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    // 15 requests that only announce 20 MB, from five addresses (3 each).
    for (let i = 0; i < 15; i++) {
      const res = await t.app.request('/site/en/casting-call', {
        method: 'POST',
        body: '',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(SITE_CASTING_MAX_BYTES), [IP_HEADER]: `203.0.113.${100 + (i % 5)}` },
      });
      expect(res.status, `announce ${i}`).toBe(400);
    }
    // A sent body with no token, a too-fast token, a missing privacy tick — each with a real photo attached.
    const noToken = await encoded(castingForm(t, { [TOKEN_FIELD]: null }));
    expect((await t.app.request('/site/en/casting-call', { method: 'POST', body: noToken.bytes, headers: { 'content-type': noToken.contentType, 'content-length': String(noToken.bytes.byteLength) } })).status).toBe(400);
    expect((await postCasting(t, 'en', castingForm(t, { [TOKEN_FIELD]: issueFormToken(t.db, 'casting', Date.now()) }))).status).toBe(400);
    expect((await postCasting(t, 'en', castingForm(t, { privacyConsent: null }))).status).toBe(400);
    expect(used(t, 'site:casting:photo-bytes')).toBe(0);
    expect(used(t, 'site:casting:school')).toBe(0);
    expect(applicationCount(t)).toBe(0);
    // …so a real applicant still gets through, and is charged for exactly the photo kept.
    expect((await postCasting(t, 'en', castingForm(t))).status).toBe(303);
    expect(used(t, 'site:casting:photo-bytes')).toBe(JPEG.byteLength);
    expect(used(t, 'site:casting:school')).toBe(1);
  });

  it('the addresses of one IPv6 /64 share the per-address limit; another /64 and an IPv4 address do not', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    for (let i = 1; i <= SITE_RATE_LIMITS.apply.perAddress.limit; i++) {
      expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: `0100 000 01${10 + i}` }), { [IP_HEADER]: `2001:db8:1:2::${i}` })).status, `address ${i}`).toBe(303);
    }
    expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '0100 000 0199' }), { [IP_HEADER]: '2001:db8:1:2:ffff::9' })).status).toBe(429);
    expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '0100 000 0198' }), { [IP_HEADER]: '2001:db8:1:3::1' })).status).toBe(303);
    expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '0100 000 0197' }), { [IP_HEADER]: '192.0.2.1' })).status).toBe(303);
  });

  it('mistakes in the form do not lock an honest applicant out: three forms that come back, then a correct one is stored', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const ip = { [IP_HEADER]: '203.0.113.61' };
    const child = { dateOfBirth: addDays(todayISO(), -10 * 366) };
    expect((await postCasting(t, 'ar', castingForm(t, child), ip)).status).toBe(400);
    expect((await postCasting(t, 'ar', castingForm(t, { ...child, guardianName: 'وائل', guardianPhone: '0100 555 7099' }), ip)).status).toBe(400);
    expect((await postCasting(t, 'ar', castingForm(t, { ...child, guardianName: 'وائل', guardianPhone: '12', guardianConsent: 'on' }), ip)).status).toBe(400);
    const ok = await postCasting(t, 'ar', castingForm(t, { ...child, guardianName: 'وائل', guardianPhone: '0100 555 7099', guardianConsent: 'on' }), ip);
    expect(ok.status).toBe(303);
    expect(applicationCount(t)).toBe(1);
    expect(used(t, 'site:casting:photo-bytes')).toBe(JPEG.byteLength);

    const ip2 = { [IP_HEADER]: '203.0.113.62' };
    for (let i = 0; i < 5; i++) expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '12' }), ip2)).status).toBe(400);
    expect((await postForm(t, '/site/en/apply', applyFields(t), ip2)).status).toBe(303);
    expect(websiteLeads(t)).toHaveLength(1);
  });

  it('…but attempts are limited too: after 12 casting tries (20 enquiries) an hour from one address, the 429 page — and nothing of the school’s day is used', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const ip = { [IP_HEADER]: '203.0.113.63' };
    for (let i = 0; i < SITE_RATE_LIMITS.casting.attempts.limit; i++) expect((await postCasting(t, 'en', castingForm(t, { privacyConsent: null }), ip)).status, `try ${i + 1}`).toBe(400);
    const limited = await postCasting(t, 'en', castingForm(t), ip);
    expect(limited.status).toBe(429);
    expect(used(t, 'site:casting:photo-bytes')).toBe(0);
    expect(used(t, 'site:casting:school')).toBe(0);
    for (let i = 0; i < SITE_RATE_LIMITS.apply.attempts.limit; i++) expect((await postForm(t, '/site/en/apply', applyFields(t, { phone: '12' }), ip)).status).toBe(400);
    expect((await postForm(t, '/site/en/apply', applyFields(t), ip)).status).toBe(429);
    expect(websiteLeads(t)).toHaveLength(0);
  });

  it('a limit that is already reached refuses a body without a Content-Length before reading it', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const ip = '203.0.113.64';
    const refusedUnread = async (why: string) => {
      const body = await countingBody(castingForm(t, {}, [{ data: new Uint8Array(3 * 1024 * 1024).fill(1) }]));
      const res = await t.app.request('/site/en/casting-call', { method: 'POST', body: body.stream, headers: { 'content-type': body.contentType, [IP_HEADER]: ip }, duplex: 'half' } as RequestInit);
      expect(res.status, why).toBe(429);
      // At most the one piece a stream prepares by itself — not the 3 MB.
      expect(body.pulled(), why).toBeLessThanOrEqual(CHUNK);
    };
    seed(t, `site:casting:address:${ip}`, SITE_RATE_LIMITS.casting.perAddress.limit);
    await refusedUnread('the address has stored its three');
    t.db.delete(rateLimits).run();
    seed(t, `site:casting:attempts:${ip}`, SITE_RATE_LIMITS.casting.attempts.limit);
    await refusedUnread('the address has used its attempts');
    t.db.delete(rateLimits).run();
    seed(t, 'site:casting:school', SITE_RATE_LIMITS.casting.school.limit);
    await refusedUnread('the school’s day is full');
    expect(applicationCount(t)).toBe(0);
    // The same for the enquiry form.
    seed(t, 'site:apply:school', SITE_RATE_LIMITS.apply.school.limit);
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const res = await t.app.request('/site/en/apply', { method: 'POST', body: big, headers: { 'content-type': 'application/x-www-form-urlencoded' }, duplex: 'half' } as RequestInit);
    expect(res.status).toBe(429);
  });

  it('casting uploads in flight are capped: beyond two full-size bodies the next visitor is asked to wait, unread and uncounted; places free up when a body ends or fails', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    expect(castingBytesReserved()).toBe(0);
    const first = heldCasting(t);
    const second = heldCasting(t);
    await tick();
    expect(castingBytesReserved()).toBe(CASTING_IN_FLIGHT_MAX_BYTES);
    const before = t.db.select().from(rateLimits).all().length;

    const body = await countingBody(castingForm(t));
    const busy = await t.app.request('/site/ar/casting-call', { method: 'POST', body: body.stream, headers: { 'content-type': body.contentType }, duplex: 'half' } as RequestInit);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('30');
    const page = await busy.text();
    expect(page).toContain(SITE_STRINGS.ar.pages.busyTitle);
    expect(page).toContain('https://wa.me/');
    expect(body.pulled()).toBeLessThanOrEqual(CHUNK);
    // With a Content-Length too.
    expect((await postCasting(t, 'en', castingForm(t), { 'content-length': '1000' })).status).toBe(429);
    expect(t.db.select().from(rateLimits).all()).toHaveLength(before);
    expect(applicationCount(t)).toBe(0);
    // The enquiry form is not held up by them.
    expect((await postForm(t, '/site/en/apply', applyFields(t))).status).toBe(303);

    // One body fails (the connection dropped), the other ends: both places are free again.
    first.fail();
    second.end();
    expect((await first.response).status).toBe(400);
    expect((await second.response).status).toBe(400);
    expect(castingBytesReserved()).toBe(0);
    expect((await postCasting(t, 'en', castingForm(t))).status).toBe(303);
    expect(castingBytesReserved()).toBe(0);
  });

  it('a body that stalls is given up after the deadline and its place freed', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    vi.useFakeTimers();
    const stalled = heldCasting(t);
    await vi.advanceTimersByTimeAsync(50);
    expect(castingBytesReserved()).toBe(SITE_CASTING_MAX_BYTES);
    await vi.advanceTimersByTimeAsync(SITE_READ_DEADLINE_MS.casting);
    const res = await stalled.response;
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(SITE_STRINGS.en.errors.tryAgain);
    expect(castingBytesReserved()).toBe(0);
  });

  it('a form with far more parts than ours is refused without being parsed', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const fd = castingForm(t);
    for (let i = 0; i < 1000; i++) fd.append(`x${i}`, new Blob([new Uint8Array(1)]), 'a');
    const res = await postCasting(t, 'en', fd);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(SITE_STRINGS.en.errors.tryAgain);
    expect(applicationCount(t)).toBe(0);
  });

  it('megabytes in a text field are refused small and cheap: never validated, never echoed', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const normalize = vi.spyOn(phone, 'normalizePhone');
    for (const [field, value] of [
      ['phone', '0 '.repeat(500_000)],
      ['guardianPhone', '0 '.repeat(500_000)],
      ['links', 'a '.repeat(500_000)],
      ['languages', 'a,'.repeat(500_000)],
      ['message', 'm'.repeat(1_000_000)],
    ] as const) {
      const res = await postCasting(t, 'en', castingForm(t, { [field]: value }));
      expect(res.status, field).toBe(413);
      const body = await res.text();
      expect(body.length, field).toBeLessThan(100_000);
      expect(body, field).not.toContain(value.slice(0, 200));
    }
    // A refused token echoes the answers — but never a huge one.
    const badToken = await postCasting(t, 'en', castingForm(t, { [TOKEN_FIELD]: 'x', message: 'm'.repeat(1_000_000) }));
    expect((await badToken.text()).length).toBeLessThan(100_000);
    // Many fields that are each short enough, far too much together.
    const many = castingForm(t);
    for (let i = 0; i < 40; i++) many.append(`extra${i}`, 'y'.repeat(3000));
    expect((await postCasting(t, 'en', many)).status).toBe(413);
    expect(normalize.mock.calls.every(([v]) => v.length <= 200)).toBe(true);
    expect(applicationCount(t)).toBe(0);

    // The schema itself leaves over-long input alone (other callers are protected too).
    normalize.mockClear();
    const valid = { firstName: 'A', lastName: 'B', gender: 'male', dateOfBirth: addDays(todayISO(), -30 * 366), phone: '0100 123 4567', privacyConsent: 'on', locale: 'en' };
    const long = castingApplicationInput(todayISO()).safeParse({ ...valid, phone: '0 '.repeat(1_000_000), guardianPhone: '0 '.repeat(1_000_000), links: 'a '.repeat(1_000_000), skills: 'a,'.repeat(1_000_000) });
    expect(long.success).toBe(false);
    expect([...new Set(long.error!.issues.map((i) => String(i.path[0])))].sort()).toEqual(['guardianPhone', 'links', 'phone', 'skills']);
    expect(long.error!.issues.length).toBeLessThan(10);
    expect(normalize).not.toHaveBeenCalled();
    // (The spy does see the schema's calls: an ordinary phone is cleaned up.)
    expect(castingApplicationInput(todayISO()).safeParse(valid).success).toBe(true);
    expect(normalize).toHaveBeenCalledWith('0100 123 4567');
    normalize.mockRestore();
  });
});

describe('forms made for people, not for machines', () => {
  it('one answer names every problem: a wrong height, the missing guardian block and a photo that is too big, together', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const huge = new Uint8Array(7 * 1024 * 1024);
    huge.set(JPEG.slice(0, 4));
    const res = await postCasting(t, 'en', castingForm(t, { dateOfBirth: addDays(todayISO(), -10 * 366), heightCm: 'tall', links: 'not a link' }, [{ data: huge }, { data: NOT_AN_IMAGE }]));
    expect(res.status).toBe(400);
    const body = await res.text();
    const s = SITE_STRINGS.en;
    for (const id of ['e-heightCm', 'e-links', 'e-guardianName', 'e-guardianPhone', 'e-guardianConsent', 'e-photo1', 'e-photo2']) expect(body, id).toContain(`id="${id}"`);
    expect(body).toContain(s.formErrors.photoTooLarge);
    expect(body).toContain(s.formErrors.photoType);
    expect(body).toContain(s.formErrors.guardianConsent);
    // The enquiry form too: a bad phone and the guardian block in one go.
    const apply = await (await postForm(t, '/site/en/apply', applyFields(t, { phone: '12', dateOfBirth: addDays(todayISO(), -10 * 366) }))).text();
    for (const id of ['e-phone', 'e-guardianName', 'e-guardianPhone', 'e-guardianConsent']) expect(apply, id).toContain(`id="${id}"`);
  });

  it('a height typed with an Arabic keyboard (١٧٠) is 170', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    expect((await postCasting(t, 'ar', castingForm(t, { heightCm: '١٧٠', phone: '٠١٠١٢٣٤٥٦٧٩' }))).status).toBe(303);
    expect(t.db.select().from(castingApplications).get()).toMatchObject({ heightCm: 170, phone: '01012345679' });
    const parse = (heightCm: string) => castingApplicationInput(todayISO()).safeParse({ firstName: 'A', lastName: 'B', gender: 'male', dateOfBirth: addDays(todayISO(), -30 * 366), phone: '0100 123 4567', privacyConsent: 'on', locale: 'ar', heightCm });
    expect(parse('۱۷۰').data?.heightCm).toBe(170);
    expect(parse(' ‏170 ').data?.heightCm).toBe(170);
    expect(parse('   ').data?.heightCm).toBeNull();
    expect(parse('٢٠').error?.issues).toHaveLength(1);
    expect(parse('abc').success).toBe(false);
  });

  it('links as people write them: an Instagram name with @, or a link without https://', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    expect((await postCasting(t, 'en', castingForm(t, { links: '@karim' }))).status).toBe(303);
    expect(t.db.select().from(castingApplications).get()!.links).toEqual(['https://www.instagram.com/karim/']);
    const links = (v: string) => {
      const r = castingApplicationInput(todayISO()).safeParse({ firstName: 'A', lastName: 'B', gender: 'male', dateOfBirth: addDays(todayISO(), -30 * 366), phone: '0100 123 4567', privacyConsent: 'on', locale: 'en', links: v });
      return r.success ? r.data.links : r.error.issues.map((i) => i.message);
    };
    expect(links('@nour.acts\ninstagram.com/nour.acts,\nwww.youtube.com/watch?v=abc')).toEqual(['https://www.instagram.com/nour.acts/', 'https://instagram.com/nour.acts', 'https://www.youtube.com/watch?v=abc']);
    // Still refused: anything that isn't plainly an https link.
    for (const bad of ['http://insecure.com/x', 'javascript:alert(1)', 'data:text/html,x', '//evil.example/x', 'nour.acts', '@bad handle!']) expect(links(bad), bad).toContain('errors.invalidUrl');
    // The hint and the message say so, in plain words.
    const page = await (await get(t, '/site/ar/casting-call')).text();
    expect(page).toContain(SITE_STRINGS.ar.form.linksHint);
    expect(SITE_STRINGS.en.form.linksHint).toContain('@yourname');
  });

  it('date of birth is three plain lists (day, month by name, year) joined on the server', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t);
    for (const lang of ['en', 'ar'] as const) {
      for (const path of [`/site/${lang}/apply`, `/site/${lang}/casting-call`, `/site/${lang}/workshops/${w.id}`]) {
        const page = await (await get(t, path)).text();
        expect(page, path).not.toContain('type="date"');
        const field = /<fieldset class="field"[^>]*>\s*<legend class="legend">([^<]+)<span class="req">[^]*?<\/fieldset>/.exec(page.slice(page.indexOf('name="dobDay"') - 400))?.[0] ?? '';
        expect(field, path).toContain(SITE_STRINGS[lang].form.dateOfBirth);
        expect(field).toMatch(/<select id="f-dateOfBirth" name="dobDay" aria-label="[^"]+" autocomplete="bday-day" required>/);
        expect(field).toMatch(/name="dobMonth" aria-label="[^"]+" autocomplete="bday-month" required>/);
        expect(field).toMatch(/name="dobYear" aria-label="[^"]+" autocomplete="bday-year" required>/);
        expect(field).toContain(lang === 'ar' ? '<option value="3">مارس</option>' : '<option value="3">March</option>');
        expect(field).toContain(`<option value="${todayISO().slice(0, 4)}">`);
      }
    }
    const parts = (day: string, month: string, year: string) => ({ dateOfBirth: null, dobDay: day, dobMonth: month, dobYear: year });
    expect((await postCasting(t, 'en', castingForm(t, parts('15', '3', '1994')))).status).toBe(303);
    expect(t.db.select().from(castingApplications).get()!.dateOfBirth).toBe('1994-03-15');
    expect((await postForm(t, '/site/en/apply', applyFields(t, parts('5', '11', '1988')))).status).toBe(303);
    expect(websiteLeads(t)[0]!.dateOfBirth).toBe('1988-11-05');

    // 30 February: the date message, the three choices kept, and the summary's link lands on a control.
    const feb = await postForm(t, '/site/en/apply', applyFields(t, parts('30', '2', '1994')));
    expect(feb.status).toBe(400);
    const body = await feb.text();
    expect(body).toContain(`<a href="#f-dateOfBirth">${SITE_STRINGS.en.form.dateOfBirth}: ${SITE_STRINGS.en.errors.invalidDate}</a>`);
    expect(body).toContain('<option value="30" selected>30</option>');
    expect(body).toContain('<option value="2" selected>February</option>');
    expect(body).toContain('<option value="1994" selected>1994</option>');
    // Nothing chosen, or only part of it.
    expect(await (await postForm(t, '/site/en/apply', applyFields(t, parts('', '', '')))).text()).toContain(`${SITE_STRINGS.en.form.dateOfBirth}: ${SITE_STRINGS.en.errors.required}`);
    expect(await (await postForm(t, '/site/en/apply', applyFields(t, parts('12', '', '1990')))).text()).toContain(SITE_STRINGS.en.errors.invalidDate);
    // A child's year still asks for the guardian; a plain dateOfBirth field fills the lists when the form comes back.
    const year = String(Number(todayISO().slice(0, 4)) - 10);
    const child = await (await postForm(t, '/site/en/apply', applyFields(t, parts('1', '1', year)))).text();
    expect(child).toContain('id="e-guardianName"');
    const plain = await (await postForm(t, '/site/en/apply', applyFields(t, { dateOfBirth: '1990-07-09', phone: '12' }))).text();
    expect(plain).toContain('<option value="9" selected>9</option>');
    expect(plain).toContain('<option value="7" selected>July</option>');
    expect(plain).toContain('<option value="1990" selected>1990</option>');
  });

  it('"Back to the form" on an error page is a real link: never the address the form was posted to plus a fragment', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const w = workshop(t);
    const strip = (href: string) => href.split('#')[0];
    // 413 (too large) and 429 (limit reached) of the two forms that post to their own address…
    const castingBig = await t.app.request('/site/en/casting-call', { method: 'POST', headers: { 'content-length': String(SITE_CASTING_MAX_BYTES + 1), 'content-type': 'multipart/form-data; boundary=x' }, body: '' });
    expect(castingBig.status).toBe(413);
    seed(t, 'site:casting:school', SITE_RATE_LIMITS.casting.school.limit);
    seed(t, 'site:apply:school', SITE_RATE_LIMITS.apply.school.limit);
    const castingLimited = await postCasting(t, 'en', castingForm(t));
    const applyLimited = await postForm(t, '/site/en/apply', applyFields(t));
    const applyBig = await postForm(t, '/site/en/apply', applyFields(t, { message: 'x'.repeat(SITE_APPLY_MAX_BYTES) }));
    for (const [res, posted] of [
      [castingBig, '/site/en/casting-call'],
      [castingLimited, '/site/en/casting-call'],
      [applyLimited, '/site/en/apply'],
      [applyBig, '/site/en/apply'],
    ] as const) {
      const href = backHref(await res.text());
      expect(href, posted).toBe(`${posted}?again=1#apply`);
      expect(strip(href!)).not.toBe(posted);
      // …and that address is the form.
      const form = await get(t, href!);
      expect(form.status).toBe(200);
      expect(await form.text()).toContain('<form method="post"');
    }
    // A workshop's form posts to …/apply: its page is another address already.
    const workshopLimited = await postForm(t, `/site/en/workshops/${w.id}/apply`, applyFields(t));
    expect(workshopLimited.status).toBe(429);
    expect(backHref(await workshopLimited.text())).toBe(`/site/en/workshops/${w.id}#apply`);
  });

  it('error pages keep a language switch (to the other language’s home); a question label gets no colon in the summary; no heading level is skipped on "Ask us"', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    const notFound = await (await get(t, '/site/en/nope')).text();
    expect(notFound).toContain('<a class="lang" href="/site/ar" hreflang="ar"');
    expect(notFound).not.toContain('rel="canonical"');
    const summary = await (await postForm(t, '/site/en/apply', applyFields(t, { heardFrom: null }))).text();
    expect(summary).toContain(`<a href="#f-heardFrom">${SITE_STRINGS.en.form.heardFrom} ${SITE_STRINGS.en.errors.choose}</a>`);
    const page = await (await get(t, '/site/en/apply')).text();
    expect(page).toContain(`<h2>${SITE_STRINGS.en.form.guardianTitle}</h2>`);
    expect(page).not.toContain('<h3>');
  });
});

describe('/site/media/:id', () => {
  it('serves only public images (hero, shown coaches, covers of workshops on the site), with cache and safety headers', async () => {
    const t = await ctx();
    const director = await t.as('executive_director');
    const [hero, coachPhoto, hiddenCoach, cover, hiddenCover, plain] = await Promise.all(Array.from({ length: 6 }, () => uploadPng(director)));
    saveSiteContent(t.db, content({ heroFileId: hero! }));
    t.db.insert(siteCoaches).values([{ nameEn: 'A', photoFileId: coachPhoto, visible: true }, { nameEn: 'B', photoFileId: hiddenCoach, visible: false }]).run();
    workshop(t, {}, { coverFileId: cover });
    workshop(t, {}, { coverFileId: hiddenCover, visible: false });

    for (const id of [hero, coachPhoto, cover]) {
      const res = await get(t, `/site/media/${id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-disposition')).toBe('inline');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_1PX);
    }
    for (const id of [hiddenCoach, hiddenCover, plain, '00000000-0000-4000-8000-000000000000', '..%2F..%2Fapi']) {
      expect((await get(t, `/site/media/${id}`)).status, String(id)).toBe(404);
    }
    // Staff files stay staff-only.
    expect((await t.anon.get(`/api/files/${hero}`)).status).toBe(401);
  });
});

describe('when something breaks', () => {
  it('an unexpected error is a friendly 500 page in the right language, with the site headers', async () => {
    const t = await ctx();
    (t.db as unknown as { $client: { close(): void } }).$client.close();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(t, '/site/ar/workshops');
    quiet.mockRestore();
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toBe(SITE_CSP);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('<html lang="ar" dir="rtl">');
    expect(body).toContain(SITE_STRINGS.ar.pages.errorTitle);
  });
});

describe('the staff app and the site stay apart', () => {
  it('/site needs no session and no X-Requested-With; the API still does', async () => {
    const t = await ctx();
    expect((await t.app.request('/site/en')).status).toBe(200);
    expect((await t.app.request('/api/students')).status).toBe(401);
    expect((await t.app.request('/api/auth/logout', { method: 'POST' })).status).toBe(403);
  });

  it('a lead from the website shows in Admissions with source=website', async () => {
    const t = await ctx();
    saveSiteContent(t.db, content());
    await postForm(t, '/site/en/apply', applyFields(t));
    const director = await t.as('executive_director');
    const res = await director.get('/api/leads?source=website');
    expect(res.body.items.map((l: { firstName: string }) => l.firstName)).toEqual(['Mona']);
    expect(t.db.select().from(leadActivities).where(and(eq(leadActivities.type, 'note'))).all().length).toBeGreaterThan(0);
  });
});
