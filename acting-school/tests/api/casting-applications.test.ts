import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { castingApplicationPhotos, castingApplications, files, talent, talentPhotos } from '../../src/server/db/schema';
import { createCastingApplication, type CastingPhotoUpload } from '../../src/server/lib/castingApplications';
import { ApiError } from '../../src/server/lib/errors';
import type { FileStore } from '../../src/server/lib/fileStore';
import { getSiteContent, isPublicFile, saveSiteContent } from '../../src/server/lib/siteContent';
import { addDays } from '../../src/shared/dates';
import {
  castingApplicationInput,
  CASTING_APPLICATION_ERROR_CODES,
  type CastingApplicationCounts,
  type CastingApplicationDetail,
  type CastingApplicationListItem,
} from '../../src/shared/schemas/castingApplications';
import { CASTING_PHOTO_MAX_BYTES } from '../../src/shared/schemas/site';
import type { TalentDetail } from '../../src/shared/schemas/talent';
import { makeTestContext, PNG_1PX, todayISO } from '../helpers';

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

/** A date of birth making someone `age` today at the school (half a year past the birthday). */
const dob = (age: number) => addDays(todayISO(), -Math.round((age + 0.5) * 365.25));

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const GIF = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

function openCastingCall(t: Ctx, open = true) {
  const c = getSiteContent(t.db);
  saveSiteContent(t.db, { ...c, castingCall: { ...c.castingCall, open } });
}

/** The form's values (as the public page would send them), valid unless overridden. */
function form(o: Record<string, unknown> = {}) {
  return {
    firstName: 'Nadia',
    lastName: 'Fahmy',
    gender: 'female',
    dateOfBirth: dob(25),
    phone: '0100 123 4567',
    email: 'Nadia@Example.com',
    city: 'Giza',
    heightCm: '168',
    languages: 'Arabic, English، arabic',
    skills: 'Dance\nSinging',
    experience: 'Theatre club, two short films.',
    links: 'https://www.instagram.com/nadia.acts/ https://vimeo.com/nadia/reel',
    message: 'Free on weekends.',
    privacyConsent: 'on',
    locale: 'en',
    ...o,
  };
}

/** A casting application through the library, as the public form will store it. */
async function apply(t: Ctx, o: Record<string, unknown> = {}, photos: CastingPhotoUpload[] = [{ data: PNG_1PX, name: 'me.png' }]) {
  openCastingCall(t);
  return createCastingApplication(t.db, t.files, castingApplicationInput(todayISO()).parse(form(o)), photos);
}

const fileCount = (t: Ctx) => t.db.select({ n: count() }).from(files).get()!.n;
const appCount = (t: Ctx) => t.db.select({ n: count() }).from(castingApplications).get()!.n;
const photoKeys = (t: Ctx, applicationId: number) =>
  t.db
    .select({ id: files.id, storageKey: files.storageKey })
    .from(castingApplicationPhotos)
    .innerJoin(files, eq(files.id, castingApplicationPhotos.fileId))
    .where(eq(castingApplicationPhotos.applicationId, applicationId))
    .orderBy(castingApplicationPhotos.sortOrder)
    .all();

/** The validation issue paths + messages of a failed parse. */
function issues(o: Record<string, unknown>) {
  const r = castingApplicationInput(todayISO()).safeParse(form(o));
  expect(r.success).toBe(false);
  return [...new Set(r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`))];
}

describe('/api/casting-applications — access', () => {
  it('401 signed out; reading needs talent.read, changing needs talent.write', async () => {
    const t = await makeTestContext();
    const { id } = await apply(t);
    for (const [method, url] of [
      ['GET', '/api/casting-applications'],
      ['GET', `/api/casting-applications/${id}`],
      ['GET', '/api/casting-applications/counts'],
      ['PATCH', `/api/casting-applications/${id}`],
      ['POST', `/api/casting-applications/${id}/accept`],
      ['DELETE', `/api/casting-applications/${id}`],
    ] as const) {
      const res = await t.anon.raw(url, { method, headers: { 'x-requested-with': 'fetch', 'content-type': 'application/json' }, body: method === 'PATCH' ? '{"status":"reviewing"}' : undefined });
      expect(res.status, `${method} ${url}`).toBe(401);
    }

    // No talent.read: the coach, finance, website-only staff.
    for (const spec of ['acting_coach', 'finance', { permissions: ['website.manage'] }] as const) {
      const client = await t.as(spec);
      expect((await client.get('/api/casting-applications')).status).toBe(403);
      expect((await client.get(`/api/casting-applications/${id}`)).status).toBe(403);
      expect((await client.get('/api/casting-applications/counts')).status).toBe(403);
    }

    // talent.read without talent.write (the video editor): reads, can't change anything.
    const editor = await t.as('video_editor');
    expect((await editor.get('/api/casting-applications')).status).toBe(200);
    expect((await editor.get(`/api/casting-applications/${id}`)).status).toBe(200);
    expect((await editor.patch(`/api/casting-applications/${id}`, { status: 'reviewing' })).status).toBe(403);
    expect((await editor.post(`/api/casting-applications/${id}/accept`)).status).toBe(403);
    expect((await editor.delete(`/api/casting-applications/${id}`)).status).toBe(403);
    expect(t.db.select().from(castingApplications).get()!.status).toBe('new');

    // The casting team and the director may do everything.
    for (const spec of ['casting_team', 'head_of_casting', 'executive_director', 'ceo'] as const) {
      expect((await (await t.as(spec)).get(`/api/casting-applications/${id}`)).status, spec).toBe(200);
    }
  });
});

describe('GET /api/casting-applications', () => {
  it('lists newest first with age, minor flag and the first photo; filters by status and searches names, city and phone', async () => {
    const t = await makeTestContext();
    const team = await t.as('casting_team');
    const a = await apply(t, { firstName: 'Nadia', lastName: 'Fahmy', city: 'Giza', phone: '0100 123 4567' }, [{ data: JPEG }, { data: PNG_1PX }]);
    const b = await apply(t, {
      firstName: 'جنى',
      lastName: 'وائل',
      city: 'القاهرة',
      phone: '0111 222 3333',
      dateOfBirth: dob(14),
      guardianName: 'وائل محمود',
      guardianPhone: '0100 555 7099',
      guardianConsent: 'on',
      locale: 'ar',
    });
    const c = await apply(t, { firstName: 'Omar', lastName: 'Khalil', city: 'Alexandria', phone: '+20 122 555 7004', gender: 'male', dateOfBirth: dob(34) });
    // Created at different moments, oldest first.
    for (const [i, id] of [a.id, b.id, c.id].entries()) {
      t.db.update(castingApplications).set({ createdAt: 1_000_000 + i }).where(eq(castingApplications.id, id)).run();
    }

    const res = await team.get<{ items: CastingApplicationListItem[] }>('/api/casting-applications');
    expect(res.status).toBe(200);
    expect(res.body.items.map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    const nadia = res.body.items.find((x) => x.id === a.id)!;
    expect(nadia).toEqual({
      id: a.id,
      firstName: 'Nadia',
      lastName: 'Fahmy',
      gender: 'female',
      age: 25,
      city: 'Giza',
      status: 'new',
      createdAt: 1_000_000,
      photoFileId: photoKeys(t, a.id)[0]!.id,
      minor: false,
    });
    expect(res.body.items.find((x) => x.id === b.id)).toMatchObject({ age: 14, minor: true });

    t.db.update(castingApplications).set({ status: 'reviewing' }).where(eq(castingApplications.id, c.id)).run();
    const ids = async (qs: string) => (await team.get<{ items: CastingApplicationListItem[] }>(`/api/casting-applications?${qs}`)).body.items.map((x) => x.id);
    expect(await ids('status=new')).toEqual([b.id, a.id]);
    expect(await ids('status=reviewing')).toEqual([c.id]);
    expect(await ids('status=declined')).toEqual([]);
    expect(await ids('q=fahmy')).toEqual([a.id]);
    expect(await ids('q=nadia%20fahmy')).toEqual([a.id]);
    expect(await ids(`q=${encodeURIComponent('وائل')}`)).toEqual([b.id]);
    expect(await ids('q=alex')).toEqual([c.id]);
    // Phone digits in any format: a local number finds the international one and back.
    expect(await ids(`q=${encodeURIComponent('0122 555')}`)).toEqual([c.id]);
    expect(await ids(`q=${encodeURIComponent('+20 100 123')}`)).toEqual([a.id]);
    expect(await ids('q=1112223333')).toEqual([b.id]);
    expect(await ids('q=example.com')).toEqual([c.id, b.id, a.id]);
    // Without talent.contact the search leaves phone and email out (it would reveal them).
    const editor = await t.as('video_editor');
    const editorIds = async (qs: string) => (await editor.get<{ items: CastingApplicationListItem[] }>(`/api/casting-applications?${qs}`)).body.items.map((x) => x.id);
    expect(await editorIds('q=1112223333')).toEqual([]);
    expect(await editorIds(`q=${encodeURIComponent('0122 555')}`)).toEqual([]);
    expect(await editorIds('q=example.com')).toEqual([]);
    expect(await editorIds('q=fahmy')).toEqual([a.id]);
    // A long Arabic term is fine (instr, not LIKE: the Durable Object's pattern limit doesn't apply).
    expect(await ids(`q=${encodeURIComponent('وائل'.repeat(20))}`)).toEqual([]);

    expect((await team.get('/api/casting-applications?status=accepted_maybe')).status).toBe(400);
    expect((await team.get(`/api/casting-applications?q=${'x'.repeat(101)}`)).status).toBe(400);
  });

  it('counts per status for the tabs', async () => {
    const t = await makeTestContext();
    const team = await t.as('casting_team');
    expect((await team.get<CastingApplicationCounts>('/api/casting-applications/counts')).body).toEqual({ new: 0, reviewing: 0, accepted: 0, declined: 0 });
    const a = await apply(t);
    await apply(t, { phone: '0100 000 0002' });
    const c = await apply(t, { phone: '0100 000 0003' });
    await team.patch(`/api/casting-applications/${a.id}`, { status: 'declined' });
    await team.post(`/api/casting-applications/${c.id}/accept`);
    expect((await team.get<CastingApplicationCounts>('/api/casting-applications/counts')).body).toEqual({ new: 1, reviewing: 0, accepted: 1, declined: 1 });
  });
});

describe('GET /api/casting-applications/:id', () => {
  it('everything, photos in order; contact fields only with talent.contact', async () => {
    const t = await makeTestContext();
    const { id } = await apply(
      t,
      { dateOfBirth: dob(15), guardianName: 'Mona Fahmy', guardianPhone: '٠١٠٠ ٥٥٥ ٧٠٩٩', guardianConsent: 'on' },
      [{ data: PNG_1PX }, { data: JPEG }, { data: WEBP }],
    );
    const photos = photoKeys(t, id);
    expect(photos).toHaveLength(3);

    const team = await t.as('casting_team');
    const res = await team.get<CastingApplicationDetail>(`/api/casting-applications/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      firstName: 'Nadia',
      lastName: 'Fahmy',
      gender: 'female',
      dateOfBirth: dob(15),
      age: 15,
      minor: true,
      phone: '0100 123 4567',
      email: 'nadia@example.com',
      city: 'Giza',
      heightCm: 168,
      languages: ['Arabic', 'English'],
      skills: ['Dance', 'Singing'],
      experience: 'Theatre club, two short films.',
      links: ['https://www.instagram.com/nadia.acts/', 'https://vimeo.com/nadia/reel'],
      message: 'Free on weekends.',
      guardianName: 'Mona Fahmy',
      guardianPhone: '0100 555 7099',
      guardianConsent: true,
      locale: 'en',
      status: 'new',
      reviewedById: null,
      reviewedByName: null,
      reviewedAt: null,
      talentId: null,
      photos: photos.map((p) => ({ fileId: p.id })),
      contactHidden: false,
    });
    // The stored phone digits (search) are in step with the phone.
    expect(t.db.select().from(castingApplications).get()!.phoneDigits).toBe('01001234567');
    expect(photos.map((p) => p.storageKey.split('.')[1])).toEqual(['png', 'jpg', 'webp']);

    // talent.read without talent.contact: phone, email, guardian phone and links come back null.
    const editor = await t.as('video_editor');
    const hidden = (await editor.get<CastingApplicationDetail>(`/api/casting-applications/${id}`)).body;
    expect(hidden).toMatchObject({ phone: null, email: null, guardianPhone: null, links: null, contactHidden: true, guardianName: 'Mona Fahmy', city: 'Giza' });

    expect((await team.get('/api/casting-applications/99999')).status).toBe(404);
    expect((await team.get('/api/casting-applications/abc')).status).toBe(404);
  });
});

describe('PATCH /api/casting-applications/:id', () => {
  it('marks reviewing / declined (recording who and when) or back to new; accepted only through accept', async () => {
    const t = await makeTestContext();
    const { id } = await apply(t);
    const team = await t.as('casting_team');

    const reviewing = await team.patch<CastingApplicationDetail>(`/api/casting-applications/${id}`, { status: 'reviewing' });
    expect(reviewing.status).toBe(200);
    expect(reviewing.body).toMatchObject({ status: 'reviewing', reviewedById: team.user.id, reviewedByName: team.user.name });
    expect(reviewing.body.reviewedAt).toBeGreaterThan(0);

    const declined = await team.patch<CastingApplicationDetail>(`/api/casting-applications/${id}`, { status: 'declined' });
    expect(declined.body).toMatchObject({ status: 'declined', reviewedById: team.user.id });

    const back = await team.patch<CastingApplicationDetail>(`/api/casting-applications/${id}`, { status: 'new' });
    expect(back.body).toMatchObject({ status: 'new', reviewedById: null, reviewedAt: null });

    expect((await team.patch(`/api/casting-applications/${id}`, { status: 'accepted' })).status).toBe(400);
    expect((await team.patch(`/api/casting-applications/${id}`, {})).status).toBe(400);
    expect((await team.patch('/api/casting-applications/99999', { status: 'reviewing' })).status).toBe(404);
  });
});

describe('POST /api/casting-applications/:id/accept', () => {
  it('makes a talent profile with the same photos (headshot first) in one go, once', async () => {
    const t = await makeTestContext();
    const { id } = await apply(
      t,
      { dateOfBirth: dob(16), guardianName: 'Mona Fahmy', guardianPhone: '0100 555 7099', guardianConsent: 'on' },
      [{ data: JPEG }, { data: PNG_1PX }],
    );
    const photos = photoKeys(t, id);
    const team = await t.as('casting_team');

    const res = await team.post<{ talentId: number }>(`/api/casting-applications/${id}/accept`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ talentId: expect.any(Number) });
    const talentId = res.body.talentId;

    const profile = (await team.get<TalentDetail>(`/api/talent/${talentId}`)).body;
    expect(profile).toMatchObject({
      firstName: 'Nadia',
      lastName: 'Fahmy',
      gender: 'female',
      dateOfBirth: dob(16),
      phone: '0100 123 4567',
      email: 'nadia@example.com',
      city: 'Giza',
      heightCm: 168,
      languages: ['Arabic', 'English'],
      skills: ['Dance', 'Singing'],
      instagram: 'nadia.acts',
      showreelUrl: 'https://vimeo.com/nadia/reel',
      headshotFileId: photos[0]!.id,
      status: 'active',
    });
    expect(profile.photos.map((p) => p.fileId)).toEqual(photos.map((p) => p.id));
    // What talent has no field for travels in the notes.
    expect(profile.notes).toContain('Experience: Theatre club, two short films.');
    expect(profile.notes).toContain('Message: Free on weekends.');
    expect(profile.notes).toContain('https://www.instagram.com/nadia.acts/');
    expect(profile.notes).toContain('Guardian: Mona Fahmy, 0100 555 7099 (consent given)');

    const detail = (await team.get<CastingApplicationDetail>(`/api/casting-applications/${id}`)).body;
    expect(detail).toMatchObject({ status: 'accepted', talentId, reviewedById: team.user.id });

    // Once only: accepting again, or changing its status, is refused.
    const again = await team.post(`/api/casting-applications/${id}/accept`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe(CASTING_APPLICATION_ERROR_CODES.alreadyAccepted);
    expect((await team.patch(`/api/casting-applications/${id}`, { status: 'declined' })).status).toBe(409);
    expect(t.db.select({ n: count() }).from(talent).get()!.n).toBe(1);
    expect(t.db.select({ n: count() }).from(talentPhotos).get()!.n).toBe(2);

    expect((await team.post('/api/casting-applications/99999/accept')).status).toBe(404);
  });

  it('a declined application can still be added; one without links gets no Instagram or showreel', async () => {
    const t = await makeTestContext();
    const { id } = await apply(t, { links: '', experience: '', message: '' });
    const team = await t.as('casting_team');
    await team.patch(`/api/casting-applications/${id}`, { status: 'declined' });
    const res = await team.post<{ talentId: number }>(`/api/casting-applications/${id}/accept`);
    expect(res.status).toBe(201);
    const profile = t.db.select().from(talent).where(eq(talent.id, res.body.talentId)).get()!;
    expect(profile).toMatchObject({ instagram: null, showreelUrl: null });
    expect(profile.notes).toMatch(/^From a website casting application/);
  });
});

describe('DELETE /api/casting-applications/:id', () => {
  it('deletes the application and its photo files (rows and bytes)', async () => {
    const t = await makeTestContext();
    const { id } = await apply(t, {}, [{ data: PNG_1PX }, { data: JPEG }]);
    const other = await apply(t, { phone: '0100 000 0009' });
    const photos = photoKeys(t, id);
    for (const p of photos) expect(await t.files.get(p.storageKey)).not.toBeNull();
    const team = await t.as('casting_team');

    expect((await team.delete(`/api/casting-applications/${id}`)).status).toBe(204);
    expect((await team.get(`/api/casting-applications/${id}`)).status).toBe(404);
    expect(t.db.select().from(castingApplicationPhotos).where(eq(castingApplicationPhotos.applicationId, id)).all()).toEqual([]);
    for (const p of photos) {
      expect(t.db.select().from(files).where(eq(files.id, p.id)).get()).toBeUndefined();
      expect(await t.files.get(p.storageKey)).toBeNull();
    }
    // The other application is untouched.
    expect(photoKeys(t, other.id)).toHaveLength(1);
    expect((await team.delete(`/api/casting-applications/${id}`)).status).toBe(404);
  });

  it('keeps files a talent profile uses (an accepted application)', async () => {
    const t = await makeTestContext();
    const { id } = await apply(t, {}, [{ data: PNG_1PX }, { data: JPEG }]);
    const photos = photoKeys(t, id);
    const team = await t.as('casting_team');
    const { talentId } = (await team.post<{ talentId: number }>(`/api/casting-applications/${id}/accept`)).body;

    expect((await team.delete(`/api/casting-applications/${id}`)).status).toBe(204);
    expect(appCount(t)).toBe(0);
    for (const p of photos) {
      expect(t.db.select().from(files).where(eq(files.id, p.id)).get()).toBeTruthy();
      expect(await t.files.get(p.storageKey)).not.toBeNull();
    }
    const profile = (await team.get<TalentDetail>(`/api/talent/${talentId}`)).body;
    expect(profile.photos.map((p) => p.fileId)).toEqual(photos.map((p) => p.id));
    expect(profile.headshotFileId).toBe(photos[0]!.id);
  });
});

describe('createCastingApplication (the public form’s write)', () => {
  it('stores the application and its photos (uploadedBy null, never public)', async () => {
    const t = await makeTestContext();
    const { id } = await apply(t, {}, [{ data: WEBP, name: 'x'.repeat(300) }]);
    const [photo] = photoKeys(t, id);
    const row = t.db.select().from(files).where(eq(files.id, photo!.id)).get()!;
    expect(row).toMatchObject({ mime: 'image/webp', size: WEBP.byteLength, uploadedBy: null });
    expect(row.originalName).toHaveLength(200);
    expect(t.db.select().from(castingApplications).get()).toMatchObject({ status: 'new', locale: 'en', guardianConsent: false });
    expect(isPublicFile(t.db, photo!.id, todayISO())).toBe(false);
  });

  it('refuses when the casting call is closed, storing nothing', async () => {
    const t = await makeTestContext();
    const input = castingApplicationInput(todayISO()).parse(form());
    // No site content yet: the casting call is closed.
    await expect(createCastingApplication(t.db, t.files, input, [{ data: PNG_1PX }])).rejects.toMatchObject({
      status: 409,
      code: CASTING_APPLICATION_ERROR_CODES.castingCallClosed,
    });
    openCastingCall(t, false);
    await expect(createCastingApplication(t.db, t.files, input, [{ data: PNG_1PX }])).rejects.toBeInstanceOf(ApiError);
    expect([appCount(t), fileCount(t)]).toEqual([0, 0]);
  });

  it('photos: 1–3, each a real JPEG/PNG/WebP (by its bytes) of at most 6 MB; nothing stored otherwise', async () => {
    const t = await makeTestContext();
    openCastingCall(t);
    const input = castingApplicationInput(todayISO()).parse(form());
    const refused = async (photos: CastingPhotoUpload[]) => {
      const err = await createCastingApplication(t.db, t.files, input, photos).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(400);
      return e.issues?.map((i) => `${i.path.join('.')}: ${i.message}`);
    };
    expect(await refused([])).toEqual(['photos: site:errors.photoRequired']);
    expect(await refused([PNG_1PX, JPEG, WEBP, PNG_1PX].map((data) => ({ data })))).toEqual(['photos: site:errors.tooManyPhotos']);
    expect(await refused([{ data: PNG_1PX }, { data: GIF }])).toEqual(['photos.1: site:errors.photoType']);
    expect(await refused([{ data: HTML }])).toEqual(['photos.0: site:errors.photoType']);
    expect(await refused([{ data: new Uint8Array(0) }])).toEqual(['photos.0: site:errors.photoType']);
    const big = new Uint8Array(CASTING_PHOTO_MAX_BYTES + 1);
    big.set(PNG_1PX);
    expect(await refused([{ data: big }])).toEqual(['photos.0: site:errors.photoTooLarge']);
    expect([appCount(t), fileCount(t)]).toEqual([0, 0]);

    // Exactly 6 MB and three photos are fine.
    const max = new Uint8Array(CASTING_PHOTO_MAX_BYTES);
    max.set(JPEG);
    const ok = await createCastingApplication(t.db, t.files, input, [{ data: max }, { data: PNG_1PX }, { data: WEBP }]);
    expect(photoKeys(t, ok.id)).toHaveLength(3);
  });

  it('a failure after some photos were stored deletes them again', async () => {
    const t = await makeTestContext();
    openCastingCall(t);
    const stored = new Map<string, Uint8Array>();
    let puts = 0;
    const flaky: FileStore = {
      async put(key, data) {
        if (++puts === 2) throw new Error('disk full');
        stored.set(key, data);
      },
      async get(key) {
        return (stored.get(key) as Uint8Array<ArrayBuffer>) ?? null;
      },
      async delete(key) {
        stored.delete(key);
      },
    };
    const input = castingApplicationInput(todayISO()).parse(form());
    await expect(createCastingApplication(t.db, flaky, input, [{ data: PNG_1PX }, { data: JPEG }])).rejects.toThrow('disk full');
    expect(stored.size).toBe(0);
    expect([appCount(t), fileCount(t)]).toEqual([0, 0]);

    // A database failure after every photo was stored: the bytes go too.
    puts = 10;
    const bad = { ...input, firstName: null as never };
    await expect(createCastingApplication(t.db, flaky, bad, [{ data: PNG_1PX }])).rejects.toThrow();
    expect(stored.size).toBe(0);
    expect([appCount(t), fileCount(t)]).toEqual([0, 0]);
  });
});

describe('castingApplicationInput (the public form’s rules)', () => {
  it('cleans lists and links; https links only, at most 3', () => {
    const v = castingApplicationInput(todayISO()).parse(form({ links: ['https://a.com/x', '', 'https://b.com'], heightCm: '' }));
    expect(v).toMatchObject({ languages: ['Arabic', 'English'], skills: ['Dance', 'Singing'], links: ['https://a.com/x', 'https://b.com/'], heightCm: null, minor: false });
    expect(issues({ links: 'http://insecure.com' })).toEqual(['links.0: errors.invalidUrl']);
    expect(issues({ links: 'javascript:alert(1)' })).toEqual(['links.0: errors.invalidUrl']);
    expect(issues({ links: 'https://a.com https://b.com https://c.com https://d.com' })).toEqual(['links: site:errors.tooManyLinks']);
  });

  it('needs privacy consent, a real phone and an age of 5–100', () => {
    expect(issues({ privacyConsent: undefined })).toEqual(['privacyConsent: site:errors.privacyConsent']);
    expect(issues({ phone: '12' })).toEqual(['phone: site:errors.invalidPhone']);
    expect(issues({ dateOfBirth: dob(4) })).toEqual(['dateOfBirth: site:errors.ageRange']);
    expect(issues({ dateOfBirth: dob(101) })).toEqual(['dateOfBirth: site:errors.ageRange']);
    expect(issues({ dateOfBirth: '2010-02-30' })).toEqual(['dateOfBirth: errors.invalidDate']);
    expect(issues({ gender: 'robot' })).toHaveLength(1);
    expect(issues({ heightCm: '20' })).toHaveLength(1);
  });

  it('under 18: the guardian’s name, phone and consent are required', () => {
    expect(issues({ dateOfBirth: dob(14) })).toEqual([
      'guardianName: errors.required',
      'guardianPhone: errors.required',
      'guardianConsent: site:errors.guardianConsent',
    ]);
    expect(issues({ dateOfBirth: dob(14), guardianName: 'Mona', guardianPhone: '0100 555 7099' })).toEqual(['guardianConsent: site:errors.guardianConsent']);
    const ok = castingApplicationInput(todayISO()).parse(form({ dateOfBirth: dob(14), guardianName: 'Mona', guardianPhone: '0100 555 7099', guardianConsent: 'on' }));
    expect(ok).toMatchObject({ minor: true, guardianConsent: true });
    // 18 and over: no guardian needed.
    expect(castingApplicationInput(todayISO()).parse(form({ dateOfBirth: dob(18) })).minor).toBe(false);
  });
});
