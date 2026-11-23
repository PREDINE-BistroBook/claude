import { and, eq } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema';
import {
  castingApplicationPhotos,
  castingFiles,
  courseFiles,
  files,
  messageAttachments,
  siteCoaches,
  siteWorkshops,
  students,
  talent,
  talentPhotos,
  users,
} from '../../src/server/db/schema';
import { createCastingApplication } from '../../src/server/lib/castingApplications';
import { FILE_REFERENCES, fileInUse, releaseFile } from '../../src/server/lib/fileRefs';
import { getSiteContent, saveSiteContent } from '../../src/server/lib/siteContent';
import { addDays } from '../../src/shared/dates';
import { castingApplicationInput } from '../../src/shared/schemas/castingApplications';
import type { CourseDetail } from '../../src/shared/schemas/courses';
import { DOCX_BYTES, makeTestContext, makeZip, PDF_BYTES, PNG_1PX, todayISO, uploadBytes, uploadPng, type Client } from '../helpers';

/**
 * Part G1: uploads of images and documents (type from the bytes), how files
 * are served, freeing files nothing uses any more, profile photos, a
 * workshop's photos & files (class scope) and a casting's files.
 */

const HOUR = 60 * 60 * 1000;

async function newCourse(client: Client, teacherId: number | null, name = 'Screen Acting') {
  const today = todayISO();
  const res = await client.post<CourseDetail>('/api/courses', { name, teacherId, startDate: today, endDate: addDays(today, 30), schedule: [] });
  expect(res.status).toBe(201);
  return res.body.id;
}

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;
/** A signed-in client from t.as(): the client plus its user. */
type SignedIn = Awaited<ReturnType<Ctx['as']>>;

/** A casting application as the public form stores it (one photo, nobody's upload); its id and its photo's file id. */
async function newApplication(t: Ctx, phone: string) {
  const content = getSiteContent(t.db);
  saveSiteContent(t.db, { ...content, castingCall: { ...content.castingCall, open: true } });
  const input = castingApplicationInput(todayISO()).parse({
    firstName: 'Nadia',
    lastName: 'Fahmy',
    gender: 'female',
    dateOfBirth: addDays(todayISO(), -25 * 366),
    phone,
    city: 'Giza',
    privacyConsent: 'on',
    locale: 'en',
  });
  const { id } = await createCastingApplication(t.db, t.files, input, [{ data: PNG_1PX, name: 'me.png' }]);
  const photo = t.db.select().from(castingApplicationPhotos).where(eq(castingApplicationPhotos.applicationId, id)).get()!;
  return { id, fileId: photo.fileId };
}

interface ReferenceCase {
  /** Make this place use the file. */
  point(fileId: string): void;
  /** And stop using it. */
  clear(fileId: string): void;
}

/**
 * Every place a file can be used from: one case per FILE_REFERENCES column
 * ("table.column"), plus the website's main photo, which lives in settings.
 * The website's (site_coaches, site_workshops, casting_application_photos, the
 * hero) and the team pack's (users, course_files, casting_files,
 * message_attachments) side by side: a place missing from the "is it still
 * used?" check would let a delete elsewhere take the file away.
 */
async function referenceCases(t: Ctx, owner: SignedIn): Promise<Record<string, ReferenceCase>> {
  const courseId = await newCourse(owner, null, 'Reference course');
  const studentId = (await owner.post('/api/students', { firstName: 'Ref', lastName: 'Student' })).body.id as number;
  const talentId = (await owner.post('/api/talent', { firstName: 'Ref', lastName: 'Talent' })).body.id as number;
  const castingId = (await owner.post('/api/castings', { title: 'Reference casting' })).body.id as number;
  const colleague = await t.as('acting_coach');
  const conversationId = (await owner.post('/api/chat/conversations', { userId: colleague.user.id })).body.id as number;
  const messageId = (await owner.post(`/api/chat/conversations/${conversationId}/messages`, { body: 'hello' })).body.id as number;
  const coachId = t.db.insert(siteCoaches).values({ nameEn: 'Reference coach' }).returning({ id: siteCoaches.id }).get().id;
  t.db.insert(siteWorkshops).values({ courseId, visible: true }).run();
  const otherApplication = await newApplication(t, '0100 000 0001');
  const me = owner.user.id;
  for (const id of [courseId, studentId, talentId, castingId, conversationId, messageId]) expect(id).toBeGreaterThan(0);
  return {
    'users.photo_file_id': {
      point: (f) => t.db.update(users).set({ photoFileId: f }).where(eq(users.id, me)).run(),
      clear: () => t.db.update(users).set({ photoFileId: null }).where(eq(users.id, me)).run(),
    },
    'students.photo_file_id': {
      point: (f) => t.db.update(students).set({ photoFileId: f }).where(eq(students.id, studentId)).run(),
      clear: () => t.db.update(students).set({ photoFileId: null }).where(eq(students.id, studentId)).run(),
    },
    'talent.headshot_file_id': {
      point: (f) => t.db.update(talent).set({ headshotFileId: f }).where(eq(talent.id, talentId)).run(),
      clear: () => t.db.update(talent).set({ headshotFileId: null }).where(eq(talent.id, talentId)).run(),
    },
    'talent_photos.file_id': {
      point: (f) => t.db.insert(talentPhotos).values({ talentId, fileId: f }).run(),
      clear: (f) => t.db.delete(talentPhotos).where(eq(talentPhotos.fileId, f)).run(),
    },
    'site_coaches.photo_file_id': {
      point: (f) => t.db.update(siteCoaches).set({ photoFileId: f }).where(eq(siteCoaches.id, coachId)).run(),
      clear: () => t.db.update(siteCoaches).set({ photoFileId: null }).where(eq(siteCoaches.id, coachId)).run(),
    },
    'site_workshops.cover_file_id': {
      point: (f) => t.db.update(siteWorkshops).set({ coverFileId: f }).where(eq(siteWorkshops.courseId, courseId)).run(),
      clear: () => t.db.update(siteWorkshops).set({ coverFileId: null }).where(eq(siteWorkshops.courseId, courseId)).run(),
    },
    'casting_application_photos.file_id': {
      point: (f) => t.db.insert(castingApplicationPhotos).values({ applicationId: otherApplication.id, fileId: f, sortOrder: 1 }).run(),
      clear: (f) => t.db.delete(castingApplicationPhotos).where(and(eq(castingApplicationPhotos.applicationId, otherApplication.id), eq(castingApplicationPhotos.fileId, f))).run(),
    },
    'course_files.file_id': {
      point: (f) => t.db.insert(courseFiles).values({ courseId, fileId: f, kind: 'photo', uploadedById: me }).run(),
      clear: (f) => t.db.delete(courseFiles).where(eq(courseFiles.fileId, f)).run(),
    },
    'casting_files.file_id': {
      point: (f) => t.db.insert(castingFiles).values({ castingId, fileId: f, kind: 'photo', uploadedById: me }).run(),
      clear: (f) => t.db.delete(castingFiles).where(eq(castingFiles.fileId, f)).run(),
    },
    'message_attachments.file_id': {
      point: (f) => t.db.insert(messageAttachments).values({ messageId, fileId: f, kind: 'photo' }).run(),
      clear: (f) => t.db.delete(messageAttachments).where(eq(messageAttachments.fileId, f)).run(),
    },
    'settings: the website’s main photo (heroFileId)': {
      point: (f) => void saveSiteContent(t.db, { ...getSiteContent(t.db), heroFileId: f }),
      clear: () => void saveSiteContent(t.db, { ...getSiteContent(t.db), heroFileId: null }),
    },
  };
}

const HERO_CASE = 'settings: the website’s main photo (heroFileId)';
const referenceNames = () => [...FILE_REFERENCES.map((r) => `${getTableConfig(r.table).name}.${r.column.name}`), HERO_CASE].sort();
const fileRow = (t: Ctx, fileId: string) => t.db.select().from(files).where(eq(files.id, fileId)).get();

describe('POST /api/files: images and documents, checked by their bytes', () => {
  it('takes JPEG/PNG/WebP, PDF, Word, Excel and PowerPoint; answers kind and name', async () => {
    const t = await makeTestContext();
    const me = await t.as('acting_coach');
    const png = await uploadBytes(me, PNG_1PX, 'face.png', 'image/png');
    expect(png.status).toBe(201);
    expect(png.body).toMatchObject({ mime: 'image/png', kind: 'photo', name: 'face.png', size: PNG_1PX.length });
    const pdf = await uploadBytes(me, PDF_BYTES, 'جدول الورشة.pdf', 'application/pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.body).toMatchObject({ mime: 'application/pdf', kind: 'document', name: 'جدول الورشة.pdf' });
    const docx = await uploadBytes(me, DOCX_BYTES, 'script', 'application/msword');
    expect(docx.body).toMatchObject({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', name: 'script.docx' });
    const xlsx = await uploadBytes(me, makeZip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' }), 'budget.xlsx');
    expect(xlsx.body.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const pptx = await uploadBytes(me, makeZip({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p/>' }), 'pitch.pptx');
    expect(pptx.body.mime).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const jpeg = await uploadBytes(me, Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'x.jpg');
    expect(jpeg.body).toMatchObject({ mime: 'image/jpeg', kind: 'photo' });
  });

  it('refuses SVG, HTML, plain ZIPs, macro files and old Office files whatever their name or declared type (415)', async () => {
    const t = await makeTestContext();
    const me = await t.as('acting_coach');
    const cases: [Uint8Array | string, string, string][] = [
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'logo.svg', 'image/svg+xml'],
      ['<!doctype html><script>alert(1)</script>', 'page.pdf', 'application/pdf'],
      [makeZip({ 'notes.txt': 'hello' }), 'archive.docx', 'application/zip'],
      [makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>', 'word/vbaProject.bin': 'x' }), 'macro.docm', 'application/vnd.ms-word'],
      [Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'old.doc', 'application/msword'],
      [Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'broken.xlsx', 'application/zip'],
    ];
    for (const [bytes, name, type] of cases) {
      const res = await uploadBytes(me, bytes, name, type);
      expect(res.status, name).toBe(415);
      expect(res.body.error.code).toBe('unsupported_type');
    }
  });

  it('refuses files over 8 MB (413)', async () => {
    const t = await makeTestContext();
    const me = await t.as('acting_coach');
    const big = new Uint8Array(8 * 1024 * 1024 + 10);
    big.set(PDF_BYTES.subarray(0, 8));
    const res = await uploadBytes(me, big, 'huge.pdf', 'application/pdf');
    expect(res.status).toBe(413);
  });
});

describe('GET /api/files/:id', () => {
  it('serves images inline and documents as a download under their name, always nosniff', async () => {
    const t = await makeTestContext();
    const me = await t.as('acting_coach');
    const png = await uploadPng(me);
    const pdf = (await uploadBytes(me, PDF_BYTES, 'جدول "الورشة".pdf', 'application/pdf')).body.id;
    const docx = (await uploadBytes(me, DOCX_BYTES, '../../etc/passwd', 'text/plain')).body.id;

    const img = await me.raw(`/api/files/${png}`, { headers: { cookie: me.cookie! } });
    expect(img.headers.get('content-disposition')).toMatch(/^inline; /);
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');

    const doc = await me.raw(`/api/files/${pdf}`, { headers: { cookie: me.cookie! } });
    expect(doc.status).toBe(200);
    expect(doc.headers.get('content-type')).toBe('application/pdf');
    expect(doc.headers.get('x-content-type-options')).toBe('nosniff');
    const disposition = doc.headers.get('content-disposition')!;
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(disposition).not.toMatch(/filename="[^"]*"[^;]*"/);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toBe('جدول "الورشة".pdf');
    expect(new Uint8Array(await doc.arrayBuffer())).toEqual(PDF_BYTES);

    const word = await me.raw(`/api/files/${docx}`, { headers: { cookie: me.cookie! } });
    expect(word.headers.get('content-disposition')).toContain(`filename*=UTF-8''passwd.docx`);
    expect((await t.anon.get(`/api/files/${pdf}`)).status).toBe(401);
  });

  it('a document can’t become a student photo or a talent photo', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const pdf = (await uploadBytes(owner, PDF_BYTES, 'cv.pdf')).body.id;
    const student = await owner.post('/api/students', { firstName: 'A', lastName: 'B', photoFileId: pdf });
    expect(student.status).toBe(400);
    expect(student.body.error.issues[0].path).toEqual(['photoFileId']);
    const tal = await owner.post('/api/talent', { firstName: 'C', lastName: 'D' });
    const photo = await owner.post(`/api/talent/${tal.body.id}/photos`, { fileId: pdf });
    expect(photo.status).toBe(400);
  });
});

describe('releaseFile: a file goes only when nothing uses it', () => {
  it('FILE_REFERENCES names every column with a foreign key to files', () => {
    const listed = new Set(FILE_REFERENCES.map((r) => `${getTableConfig(r.table).name}.${r.column.name}`));
    const inSchema = new Set<string>();
    for (const value of Object.values(schema)) {
      if (!value || typeof value !== 'object' || !(Symbol.for('drizzle:IsDrizzleTable') in value)) continue;
      const config = getTableConfig(value as SQLiteTable);
      for (const fk of config.foreignKeys) {
        const ref = fk.reference();
        if (getTableConfig(ref.foreignTable).name === 'files') for (const col of ref.columns) inSchema.add(`${config.name}.${col.name}`);
      }
    }
    expect(inSchema.size).toBeGreaterThanOrEqual(10);
    expect([...listed].sort()).toEqual([...inSchema].sort());
  });

  it('keeps a file another record still uses, deletes it once the last user goes', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const fileId = await uploadPng(owner);
    const courseId = await newCourse(owner, null);
    const tal = await owner.post('/api/talent', { firstName: 'Shared', lastName: 'Photo' });
    t.db.insert(talentPhotos).values({ talentId: tal.body.id, fileId }).run();
    t.db.insert(courseFiles).values({ courseId, fileId, kind: 'photo', uploadedById: owner.user.id }).run();
    const record = t.db.select().from(courseFiles).where(eq(courseFiles.fileId, fileId)).get()!;

    expect(fileInUse(t.db, fileId)).toBe(true);
    expect((await owner.delete(`/api/courses/${courseId}/files/${record.id}`)).status).toBe(204);
    // Still the talent's photo: kept, bytes included.
    expect(t.db.select().from(files).where(eq(files.id, fileId)).get()).toBeTruthy();
    expect((await owner.raw(`/api/files/${fileId}`, { headers: { cookie: owner.cookie! } })).status).toBe(200);
    expect(await releaseFile(t.db, t.files, fileId)).toBe(false);

    t.db.delete(talentPhotos).where(eq(talentPhotos.fileId, fileId)).run();
    const storageKey = t.db.select().from(files).where(eq(files.id, fileId)).get()!.storageKey;
    expect(await releaseFile(t.db, t.files, fileId)).toBe(true);
    expect(t.db.select().from(files).where(eq(files.id, fileId)).get()).toBeUndefined();
    expect(await t.files.get(storageKey)).toBeNull();
  });

  it('a file stays while any one place uses it — every FILE_REFERENCES column and the website’s main photo, each on its own', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const cases = await referenceCases(t, owner);
    expect(Object.keys(cases).sort()).toEqual(referenceNames());

    for (const [name, place] of Object.entries(cases)) {
      const fileId = await uploadPng(owner);
      const storageKey = fileRow(t, fileId)!.storageKey;
      place.point(fileId);
      expect(fileInUse(t.db, fileId), name).toBe(true);
      expect(await releaseFile(t.db, t.files, fileId), name).toBe(false);
      // Its uploader can't take it back either (DELETE /api/files/:id), and it is still served.
      expect((await owner.delete(`/api/files/${fileId}`)).status, name).toBe(409);
      expect(fileRow(t, fileId), name).toBeTruthy();
      expect(await t.files.get(storageKey), name).not.toBeNull();
      expect((await owner.raw(`/api/files/${fileId}`, { headers: { cookie: owner.cookie! } })).status, name).toBe(200);

      place.clear(fileId);
      expect(fileInUse(t.db, fileId), name).toBe(false);
      expect(await releaseFile(t.db, t.files, fileId), name).toBe(true);
      expect(fileRow(t, fileId), name).toBeUndefined();
      expect(await t.files.get(storageKey), name).toBeNull();
    }
  });

  it('deleting a casting application keeps a photo that anything else still uses — the same list of places', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const cases = await referenceCases(t, owner);

    let n = 0;
    for (const [name, place] of Object.entries(cases)) {
      const application = await newApplication(t, `0100 555 ${String(1000 + n++)}`);
      const storageKey = fileRow(t, application.fileId)!.storageKey;
      place.point(application.fileId);

      expect((await owner.delete(`/api/casting-applications/${application.id}`)).status, name).toBe(204);
      expect((await owner.get(`/api/casting-applications/${application.id}`)).status, name).toBe(404);
      // The other place still has its file: row, bytes, and its own pointer to it.
      expect(fileRow(t, application.fileId), name).toBeTruthy();
      expect(await t.files.get(storageKey), name).not.toBeNull();
      expect(fileInUse(t.db, application.fileId), name).toBe(true);

      place.clear(application.fileId);
      expect(await releaseFile(t.db, t.files, application.fileId), name).toBe(true);
      expect(await t.files.get(storageKey), name).toBeNull();
    }
  });

  it('the site’s hero photo counts as used', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const fileId = await uploadPng(owner);
    const content = (await owner.get('/api/site/content')).body;
    expect((await owner.put('/api/site/content', { ...content, heroFileId: fileId })).status).toBe(200);
    expect(await releaseFile(t.db, t.files, fileId)).toBe(false);
  });
});

describe('profile photos', () => {
  it('anyone sets and removes their own (an image they just uploaded); the old file is freed', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    const first = await uploadPng(coach);
    const res = await coach.put('/api/auth/photo', { fileId: first });
    expect(res.status).toBe(200);
    expect(res.body.user.photoFileId).toBe(first);
    expect((await coach.get('/api/auth/me')).body.user.photoFileId).toBe(first);
    // The same photo again changes nothing.
    expect((await coach.put('/api/auth/photo', { fileId: first })).status).toBe(200);

    const second = await uploadPng(coach);
    expect((await coach.put('/api/auth/photo', { fileId: second })).body.user.photoFileId).toBe(second);
    expect(t.db.select().from(files).where(eq(files.id, first)).get()).toBeUndefined();

    expect((await coach.put('/api/auth/photo', { fileId: null })).body.user.photoFileId).toBeNull();
    expect(t.db.select().from(files).where(eq(files.id, second)).get()).toBeUndefined();
    expect((await t.anon.put('/api/auth/photo', { fileId: null })).status).toBe(401);
  });

  it('refuses documents, someone else’s upload, an old upload, a file already used elsewhere', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    const other = await t.as('casting_team');
    const pdf = (await uploadBytes(coach, PDF_BYTES, 'cv.pdf')).body.id;
    const theirs = await uploadPng(other);
    const old = await uploadPng(coach);
    t.db.update(files).set({ createdAt: Date.now() - 2 * HOUR }).where(eq(files.id, old)).run();
    const used = await uploadPng(coach);
    await coach.post('/api/chat/conversations', { userId: other.user.id }).then((r) => coach.post(`/api/chat/conversations/${r.body.id}/messages`, { fileIds: [used] }));
    for (const fileId of [pdf, theirs, old, used, '00000000-0000-4000-8000-000000000000']) {
      const res = await coach.put('/api/auth/photo', { fileId });
      expect(res.status, fileId).toBe(400);
      expect(res.body.error.issues[0]).toMatchObject({ path: ['fileId'], message: 'team:errors.photoInvalid' });
    }
    expect((await coach.put('/api/auth/photo', { fileId: 'nope' })).status).toBe(400);
  });

  it('staff.manage sets someone’s photo, within reach: owners are a 404 to non-owners, someone who can do more is a 403', async () => {
    const t = await makeTestContext();
    const director = await t.as('executive_director');
    const coach = await t.createUser('acting_coach');
    const ceo = await t.createUser('ceo');
    const custom = await t.createUser({ permissions: ['payments.manage'] });

    const photo = await uploadPng(director);
    const res = await director.put(`/api/staff/${coach.id}/photo`, { fileId: photo });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: coach.id, photoFileId: photo });
    expect(t.db.select({ p: users.photoFileId }).from(users).where(eq(users.id, coach.id)).get()!.p).toBe(photo);
    expect((await director.get('/api/staff/directory')).body.items.find((s: any) => s.id === coach.id).photoFileId).toBe(photo);

    expect((await director.put(`/api/staff/${ceo.id}/photo`, { fileId: await uploadPng(director) })).status).toBe(404);
    expect((await director.put(`/api/staff/${custom.id}/photo`, { fileId: await uploadPng(director) })).status).toBe(403);
    expect((await director.put('/api/staff/9999/photo', { fileId: null })).status).toBe(404);

    const plain = await t.as('acting_coach');
    expect((await plain.put(`/api/staff/${coach.id}/photo`, { fileId: null })).status).toBe(403);

    const owner = await t.as('owner');
    expect((await owner.put(`/api/staff/${ceo.id}/photo`, { fileId: await uploadPng(owner) })).status).toBe(200);
  });
});

describe('workshop photos & files', () => {
  it('a coach sees and adds files only on their own workshops; others’ are a 404', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const layla = await t.as('acting_coach', { name: 'Layla' });
    const daniel = await t.as('acting_coach', { name: 'Daniel' });
    const hers = await newCourse(owner, layla.user.id, 'Hers');
    const his = await newCourse(owner, daniel.user.id, 'His');

    const photo = await uploadPng(layla);
    const added = await layla.post(`/api/courses/${hers}/files`, { fileId: photo, caption: '  Rehearsal, week 3  ' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ fileId: photo, kind: 'photo', caption: 'Rehearsal, week 3', uploadedBy: { id: layla.user.id, name: 'Layla' }, canDelete: true });
    const pdf = (await uploadBytes(owner, PDF_BYTES, 'script.pdf')).body.id;
    const doc = await owner.post(`/api/courses/${hers}/files`, { fileId: pdf });
    expect(doc.body).toMatchObject({ kind: 'document', name: 'script.pdf', mime: 'application/pdf' });

    const list = await layla.get(`/api/courses/${hers}/files`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((f: any) => f.kind)).toEqual(['document', 'photo']);
    // Layla can't delete the director's document (not hers, no courses.write); she can delete her photo.
    expect(list.body.items.find((f: any) => f.kind === 'document').canDelete).toBe(false);

    // Daniel's workshop doesn't exist for Layla.
    expect((await layla.get(`/api/courses/${his}/files`)).status).toBe(404);
    expect((await layla.post(`/api/courses/${his}/files`, { fileId: await uploadPng(layla) })).status).toBe(404);
    expect((await daniel.get(`/api/courses/${hers}/files`)).status).toBe(404);
    expect((await layla.get('/api/courses/9999/files')).status).toBe(404);

    expect((await layla.delete(`/api/courses/${hers}/files/${doc.body.id}`)).status).toBe(403);
    expect((await layla.delete(`/api/courses/${hers}/files/${added.body.id}`)).status).toBe(204);
    expect((await owner.delete(`/api/courses/${hers}/files/${doc.body.id}`)).status).toBe(204);
    expect((await owner.delete(`/api/courses/${hers}/files/${doc.body.id}`)).status).toBe(404);
    // Both files were freed.
    expect(t.db.select().from(files).where(eq(files.id, photo)).get()).toBeUndefined();
    expect(t.db.select().from(files).where(eq(files.id, pdf)).get()).toBeUndefined();
  });

  it('seeing all workshops isn’t enough to add files: courses.write or being the coach; no courses.read is a 403', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const courseId = await newCourse(owner, null);
    const editor = await t.as('video_editor');
    expect((await editor.get(`/api/courses/${courseId}/files`)).status).toBe(200);
    const res = await editor.post(`/api/courses/${courseId}/files`, { fileId: await uploadPng(editor) });
    expect(res.status).toBe(403);
    const casting = await t.as('casting_team');
    expect((await casting.get(`/api/courses/${courseId}/files`)).status).toBe(403);
    expect((await t.anon.get(`/api/courses/${courseId}/files`)).status).toBe(401);
  });

  it('a substitute on one of its sessions counts as the workshop’s coach', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const sub = await t.as('acting_coach');
    const today = todayISO();
    const created = await owner.post<CourseDetail>('/api/courses', {
      name: 'Voice',
      startDate: today,
      endDate: addDays(today, 14),
      schedule: [{ weekday: 0, startTime: '10:00', endTime: '11:00' }],
    });
    await owner.patch(`/api/sessions/${created.body.sessions[0]!.id}`, { teacherId: sub.user.id });
    expect((await sub.post(`/api/courses/${created.body.id}/files`, { fileId: await uploadPng(sub) })).status).toBe(201);
  });

  it('validates: a fresh upload of yours, caption ≤ 200; deleting the workshop frees its files', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const other = await t.as('executive_director');
    const courseId = await newCourse(owner, null);
    expect((await owner.post(`/api/courses/${courseId}/files`, { fileId: await uploadPng(other) })).status).toBe(400);
    expect((await owner.post(`/api/courses/${courseId}/files`, { fileId: await uploadPng(owner), caption: 'x'.repeat(201) })).status).toBe(400);
    expect((await owner.post(`/api/courses/${courseId}/files`, {})).status).toBe(400);
    const fileId = await uploadPng(owner);
    await owner.post(`/api/courses/${courseId}/files`, { fileId });
    // Already used: can't be attached a second time.
    expect((await owner.post(`/api/courses/${courseId}/files`, { fileId })).status).toBe(400);
    expect((await owner.delete(`/api/courses/${courseId}`)).status).toBe(204);
    expect(t.db.select().from(files).where(eq(files.id, fileId)).get()).toBeUndefined();
  });
});

describe('casting files', () => {
  it('castings.read sees them, castings.write adds and deletes; deleting the casting frees them', async () => {
    const t = await makeTestContext();
    const head = await t.as('head_of_casting');
    const editor = await t.as('video_editor');
    const coach = await t.as('acting_coach');
    const casting = (await head.post('/api/castings', { title: 'Ramadan series' })).body.id;

    const pdf = (await uploadBytes(head, PDF_BYTES, 'breakdown.pdf')).body.id;
    const added = await head.post(`/api/castings/${casting}/files`, { fileId: pdf, caption: 'Breakdown' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ kind: 'document', caption: 'Breakdown', canDelete: true });

    const castingTeam = await t.as('casting_team');
    expect((await castingTeam.get(`/api/castings/${casting}/files`)).body.items).toHaveLength(1);
    expect((await editor.get(`/api/castings/${casting}/files`)).status).toBe(403);
    expect((await coach.get(`/api/castings/${casting}/files`)).status).toBe(403);
    expect((await head.get('/api/castings/9999/files')).status).toBe(404);

    const readOnly = await t.as({ permissions: ['castings.read'] });
    const seen = await readOnly.get(`/api/castings/${casting}/files`);
    expect(seen.body.items[0].canDelete).toBe(false);
    expect((await readOnly.post(`/api/castings/${casting}/files`, { fileId: await uploadPng(readOnly) })).status).toBe(403);
    expect((await readOnly.delete(`/api/castings/${casting}/files/${added.body.id}`)).status).toBe(403);

    const photo = await uploadPng(castingTeam);
    const second = await castingTeam.post(`/api/castings/${casting}/files`, { fileId: photo });
    expect(second.body.kind).toBe('photo');
    expect((await castingTeam.delete(`/api/castings/${casting}/files/${added.body.id}`)).status).toBe(204);
    expect(t.db.select().from(files).where(eq(files.id, pdf)).get()).toBeUndefined();

    expect((await head.delete(`/api/castings/${casting}`)).status).toBe(204);
    expect(t.db.select().from(files).where(eq(files.id, photo)).get()).toBeUndefined();
  });
});

/**
 * Uploads that are never attached (G-SEC-2): the uploader can take one back
 * (DELETE /api/files/:id), old ones are swept as new uploads come in, and
 * uploads are limited per person.
 */
describe('unused uploads', () => {
  const ageFile = (t: Awaited<ReturnType<typeof makeTestContext>>, id: string, ms: number) =>
    t.db.update(files).set({ createdAt: Date.now() - ms }).where(eq(files.id, id)).run();

  it('the uploader deletes an upload that isn’t attached yet (204); bytes go too', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    const pdf = (await uploadBytes(coach, PDF_BYTES, 'salary-sheet.pdf')).body.id as string;
    const key = t.db.select().from(files).where(eq(files.id, pdf)).get()!.storageKey;
    expect((await coach.delete(`/api/files/${pdf}`)).status).toBe(204);
    expect(t.db.select().from(files).where(eq(files.id, pdf)).get()).toBeUndefined();
    expect(await t.files.get(key)).toBeNull();
    expect((await coach.get(`/api/files/${pdf}`)).status).toBe(404);
    expect((await coach.delete(`/api/files/${pdf}`)).status).toBe(404);
    // Even an hour-old one that can't be attached any more.
    const old = await uploadPng(coach);
    ageFile(t, old, 2 * HOUR);
    expect((await coach.delete(`/api/files/${old}`)).status).toBe(204);
  });

  it('someone else’s upload is a 404; an attached file is a 409 and stays; signed out is a 401', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const coach = await t.as('acting_coach');
    const mine = await uploadPng(owner);
    expect((await coach.delete(`/api/files/${mine}`)).status).toBe(404);
    expect((await t.anon.delete(`/api/files/${mine}`)).status).toBe(401);
    expect((await coach.delete('/api/files/not-a-file')).status).toBe(404);

    const courseId = await newCourse(owner, null);
    expect((await owner.post(`/api/courses/${courseId}/files`, { fileId: mine })).status).toBe(201);
    const res = await owner.delete(`/api/files/${mine}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('file_in_use');
    expect(t.db.select().from(files).where(eq(files.id, mine)).get()).toBeTruthy();

    // A chat attachment, too.
    const photo = await uploadPng(owner);
    const conv = (await owner.post('/api/chat/conversations', { userId: coach.user.id })).body.id;
    expect((await owner.post(`/api/chat/conversations/${conv}/messages`, { fileIds: [photo] })).status).toBe(201);
    expect((await owner.delete(`/api/files/${photo}`)).status).toBe(409);
  });

  it('uploads nobody attached are swept a day later; files in use, recent ones and website ones stay', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const orphanPdf = (await uploadBytes(owner, PDF_BYTES, 'wrong-file.pdf')).body.id as string;
    const orphanKey = t.db.select().from(files).where(eq(files.id, orphanPdf)).get()!.storageKey;
    const orphanPhoto = await uploadPng(owner);
    const recent = await uploadPng(owner);
    const courseId = await newCourse(owner, null);
    const attached = await uploadPng(owner);
    await owner.post(`/api/courses/${courseId}/files`, { fileId: attached });
    const hero = await uploadPng(owner);
    const content = (await owner.get('/api/site/content')).body;
    expect((await owner.put('/api/site/content', { ...content, heroFileId: hero })).status).toBe(200);
    const profile = await uploadPng(owner);
    expect((await owner.put('/api/auth/photo', { fileId: profile })).status).toBe(200);
    for (const id of [orphanPdf, orphanPhoto, attached, hero, profile]) ageFile(t, id, 25 * HOUR);
    ageFile(t, recent, 23 * HOUR);
    // A website upload (no uploader) is left to the casting applications' own clean-up.
    t.db.update(files).set({ uploadedBy: null }).where(eq(files.id, orphanPhoto)).run();

    expect((await uploadBytes(owner, PNG_1PX, 'new.png', 'image/png')).status).toBe(201);
    const left = new Set(t.db.select({ id: files.id }).from(files).all().map((r) => r.id));
    expect(left.has(orphanPdf)).toBe(false);
    expect(await t.files.get(orphanKey)).toBeNull();
    for (const id of [orphanPhoto, recent, attached, hero, profile]) expect(left.has(id), id).toBe(true);
  });

  it('the sweep works through many orphans a batch at a time, within the Durable Object limits', async () => {
    const t = await makeTestContext();
    const owner = await t.as('owner');
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await uploadPng(owner));
    t.db.update(files).set({ createdAt: Date.now() - 30 * HOUR }).run();
    await uploadPng(owner);
    expect(t.db.select({ id: files.id }).from(files).all()).toHaveLength(6);
    await uploadPng(owner);
    expect(t.db.select({ id: files.id }).from(files).all()).toHaveLength(2);
  });

  it('a person uploads at most 100 files an hour (429)', async () => {
    const t = await makeTestContext();
    const coach = await t.as('acting_coach');
    const other = await t.as('acting_coach');
    t.db.insert(schema.rateLimits).values({ key: `upload:user:${coach.user.id}`, count: 100, windowStart: Date.now() }).run();
    const res = await uploadBytes(coach, PNG_1PX, 'one-more.png', 'image/png');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('too_many_uploads');
    expect((await uploadBytes(other, PNG_1PX, 'mine.png', 'image/png')).status).toBe(201);
  });
});
