import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { castingFiles, castingOpportunities, castingOpportunityFiles, files } from '../../src/server/db/schema';
import { castingNotesFrom } from '../../src/server/routes/opportunities';
import { addDays } from '../../src/shared/dates';
import type { CastingDetail } from '../../src/shared/schemas/castings';
import type { DashboardData } from '../../src/shared/schemas/dashboard';
import type { Opportunity, OpportunityCounts } from '../../src/shared/schemas/opportunities';
import { makeTestContext, PDF_BYTES, todayISO, uploadBytes, uploadPng, type Client } from '../helpers';

/**
 * Part K1: casting opportunities the team adds by hand (/api/opportunities):
 * castings.read to see, castings.write for everything else; links are http(s)
 * only; up to three screenshots (the caller's fresh, unused image uploads),
 * freed when the opportunity goes unless its casting uses them; "Turn into a
 * casting"; the counts and the dashboard's newOpportunities.
 */

type Ctx = Awaited<ReturnType<typeof makeTestContext>>;

const KEYS = [
  'id',
  'title',
  'details',
  'projectType',
  'roles',
  'location',
  'deadline',
  'contact',
  'link',
  'source',
  'asksForPayment',
  'involvesMinors',
  'status',
  'castingId',
  'files',
  'createdBy',
  'reviewedBy',
  'createdAt',
  'updatedAt',
].sort();

async function add(client: Client, body: Record<string, unknown> = {}): Promise<Opportunity> {
  const res = await client.post<Opportunity>('/api/opportunities', { title: 'Feature film — lead actress', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

const fileRow = (t: Ctx, id: string) => t.db.select().from(files).where(eq(files.id, id)).get();

describe('/api/opportunities: who may do what', () => {
  it('401 signed out; 403 without castings.read (a coach, the video editor, reception)', async () => {
    const t = await makeTestContext();
    expect((await t.anon.get('/api/opportunities')).status).toBe(401);
    expect((await t.anon.post('/api/opportunities', { title: 'x' })).status).toBe(401);
    for (const spec of ['acting_coach', 'video_editor', 'reception', 'office_helper', 'finance'] as const) {
      const c = await t.as(spec);
      expect((await c.get('/api/opportunities')).status, spec).toBe(403);
      expect((await c.get('/api/opportunities/counts')).status, spec).toBe(403);
      expect((await c.post('/api/opportunities', { title: 'x' })).status, spec).toBe(403);
    }
  });

  it('castings.read sees the list, one opportunity and the counts, but changes nothing', async () => {
    const t = await makeTestContext();
    const team = await t.as('casting_team');
    const o = await add(team);
    const reader = await t.as({ permissions: ['castings.read'] });
    expect((await reader.get('/api/opportunities')).body.items.map((x: Opportunity) => x.id)).toEqual([o.id]);
    expect((await reader.get(`/api/opportunities/${o.id}`)).status).toBe(200);
    expect((await reader.get('/api/opportunities/counts')).body).toEqual({ new: 1, interested: 0, applied: 0, dismissed: 0 });
    expect((await reader.post('/api/opportunities', { title: 'x' })).status).toBe(403);
    expect((await reader.patch(`/api/opportunities/${o.id}`, { status: 'applied' })).status).toBe(403);
    expect((await reader.post(`/api/opportunities/${o.id}/to-casting`)).status).toBe(403);
    expect((await reader.delete(`/api/opportunities/${o.id}`)).status).toBe(403);
  });

  it('the casting team, the Head of Casting, the director and the owners write (castings.write)', async () => {
    const t = await makeTestContext();
    for (const spec of ['casting_team', 'head_of_casting', 'executive_director', 'ceo'] as const) {
      const c = await t.as(spec);
      const o = await add(c, { title: `By ${spec}` });
      expect((await c.patch(`/api/opportunities/${o.id}`, { status: 'interested' })).status, spec).toBe(200);
      expect((await c.delete(`/api/opportunities/${o.id}`)).status, spec).toBe(204);
    }
  });

  it('404 for an unknown id, everywhere', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    expect((await c.get('/api/opportunities/999')).status).toBe(404);
    expect((await c.patch('/api/opportunities/999', { status: 'applied' })).status).toBe(404);
    expect((await c.delete('/api/opportunities/999')).status).toBe(404);
    expect((await c.post('/api/opportunities/999/to-casting')).status).toBe(404);
    expect((await c.get('/api/opportunities/abc')).status).toBe(404);
  });
});

describe('adding and editing', () => {
  it('only the title is required; the rest is stored as sent, with who added it', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const bare = await add(c, { title: '  Music video  ' });
    expect(Object.keys(bare).sort()).toEqual(KEYS);
    expect(bare).toMatchObject({
      title: 'Music video',
      details: null,
      projectType: null,
      deadline: null,
      link: null,
      asksForPayment: false,
      involvesMinors: false,
      status: 'new',
      castingId: null,
      files: [],
      reviewedBy: null,
    });
    expect(bare.createdBy).toMatchObject({ id: c.user.id, name: c.user.name });

    const deadline = addDays(todayISO(), 5);
    const full = await add(c, {
      title: 'إعلان تلفزيوني',
      details: 'تصوير يوم واحد',
      projectType: 'ad',
      roles: 'أب وأم وطفلان',
      location: 'الشيخ زايد',
      deadline,
      contact: 'casting@ad.example',
      link: 'https://www.instagram.com/p/abc/',
      source: 'Instagram — Frame Casting',
      asksForPayment: true,
      involvesMinors: true,
      status: 'interested',
    });
    expect(full).toMatchObject({ projectType: 'ad', deadline, asksForPayment: true, involvesMinors: true, status: 'interested', link: 'https://www.instagram.com/p/abc/' });
    // Added straight as "interested": the person who added it has looked at it.
    expect(full.reviewedBy?.id).toBe(c.user.id);
  });

  it('400 for a missing title, a bad date, an unknown type or status, a long source', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const bad = async (body: Record<string, unknown>) => (await c.post('/api/opportunities', body)).status;
    expect(await bad({})).toBe(400);
    expect(await bad({ title: '   ' })).toBe(400);
    expect(await bad({ title: 'x', deadline: '2026-02-30' })).toBe(400);
    expect(await bad({ title: 'x', projectType: 'tv' })).toBe(400);
    expect(await bad({ title: 'x', status: 'booked' })).toBe(400);
    expect(await bad({ title: 'x', source: 'x'.repeat(121) })).toBe(400);
    expect(await bad({ title: 'x', roles: 'x'.repeat(1001) })).toBe(400);
  });

  it('the link must be http or https — never javascript:, data:, ftp: or a bare word', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    for (const link of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.com/x', 'instagram.com/p/x', 'not a link', `https://example.com/${'a'.repeat(1000)}`]) {
      const res = await c.post('/api/opportunities', { title: 'x', link });
      expect(res.status, link).toBe(400);
      expect(res.body.error.issues[0].path, link).toEqual(['link']);
    }
    expect((await add(c, { link: 'http://example.com/post' })).link).toBe('http://example.com/post');
    expect((await add(c, { link: '' })).link).toBeNull();
    const o = await add(c, { link: 'https://example.com/a' });
    expect((await c.patch(`/api/opportunities/${o.id}`, { link: 'javascript:alert(1)' })).status).toBe(400);
    expect((await c.patch(`/api/opportunities/${o.id}`, { link: null })).body.link).toBeNull();
  });

  it('PATCH changes only what it names; a move records who moved it, back to new clears that', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const other = await t.as('head_of_casting');
    const o = await add(c, { roles: 'Dancers', source: 'Instagram' });
    const moved = (await other.patch<Opportunity>(`/api/opportunities/${o.id}`, { status: 'applied' })).body;
    expect(moved).toMatchObject({ status: 'applied', roles: 'Dancers', source: 'Instagram' });
    expect(moved.reviewedBy?.id).toBe(other.user.id);
    // Saving other fields with the same status keeps who moved it.
    expect((await c.patch<Opportunity>(`/api/opportunities/${o.id}`, { status: 'applied', roles: 'Dancers and extras' })).body.reviewedBy?.id).toBe(other.user.id);
    const back = (await c.patch<Opportunity>(`/api/opportunities/${o.id}`, { status: 'new' })).body;
    expect(back).toMatchObject({ status: 'new', reviewedBy: null, roles: 'Dancers and extras' });
    expect((await c.patch(`/api/opportunities/${o.id}`, { title: '' })).status).toBe(400);
  });
});

describe('screenshots', () => {
  it('up to three of your own fresh image uploads, in the order sent; never someone else’s, a document, or one used elsewhere', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const shots = [await uploadPng(c), await uploadPng(c), await uploadPng(c)];
    const o = await add(c, { fileIds: shots });
    expect(o.files.map((f) => f.fileId)).toEqual(shots);
    expect(o.files[0]).toMatchObject({ mime: 'image/png', name: 'pic.png' });

    const four = [await uploadPng(c), await uploadPng(c), await uploadPng(c), await uploadPng(c)];
    const tooMany = await c.post('/api/opportunities', { title: 'x', fileIds: four });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.issues[0]).toMatchObject({ path: ['fileIds'], message: 'opportunities:errors.tooManyFiles' });

    const colleague = await t.as('casting_team');
    const theirs = await uploadPng(colleague);
    expect((await c.post('/api/opportunities', { title: 'x', fileIds: [theirs] })).status).toBe(400);
    const pdf = (await uploadBytes(c, PDF_BYTES, 'post.pdf', 'application/pdf')).body.id as string;
    expect((await c.post('/api/opportunities', { title: 'x', fileIds: [pdf] })).status).toBe(400);
    // Already on the first opportunity: not again (a file id seen elsewhere can't be copied in).
    expect((await c.post('/api/opportunities', { title: 'x', fileIds: [shots[0]] })).status).toBe(400);
    const fresh = await uploadPng(c);
    expect((await c.post('/api/opportunities', { title: 'x', fileIds: [fresh, fresh] })).status).toBe(400);
    // None of the refused requests stored an opportunity.
    expect(t.db.select().from(castingOpportunities).all()).toHaveLength(1);
  });

  it('PATCH sets the whole list: kept ones stay, new ones are claimed, removed ones are deleted for good', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const [a, b] = [await uploadPng(c), await uploadPng(c)];
    const o = await add(c, { fileIds: [a, b] });
    const n = await uploadPng(c);
    const res = await c.patch<Opportunity>(`/api/opportunities/${o.id}`, { fileIds: [n, a] });
    expect(res.status).toBe(200);
    expect(res.body.files.map((f) => f.fileId)).toEqual([n, a]);
    expect(fileRow(t, b)).toBeUndefined();
    expect(fileRow(t, a)).toBeTruthy();
    // Someone else editing may keep the existing screenshots, but not add another person's upload.
    const head = await t.as('head_of_casting');
    const theirs = await uploadPng(c);
    expect((await head.patch(`/api/opportunities/${o.id}`, { fileIds: [n, a, theirs] })).status).toBe(400);
    expect((await head.patch<Opportunity>(`/api/opportunities/${o.id}`, { fileIds: [a] })).body.files.map((f) => f.fileId)).toEqual([a]);
    expect(fileRow(t, n)).toBeUndefined();
    expect((await c.patch(`/api/opportunities/${o.id}`, { fileIds: [a, a] })).status).toBe(400);
    // Without fileIds the screenshots are left alone.
    expect((await c.patch<Opportunity>(`/api/opportunities/${o.id}`, { title: 'Renamed' })).body.files).toHaveLength(1);
  });

  it('deleting an opportunity frees its screenshots (rows and bytes)', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const shot = await uploadPng(c);
    const key = fileRow(t, shot)!.storageKey;
    const o = await add(c, { fileIds: [shot] });
    expect((await c.delete(`/api/opportunities/${o.id}`)).status).toBe(204);
    expect((await c.get(`/api/opportunities/${o.id}`)).status).toBe(404);
    expect(t.db.select().from(castingOpportunityFiles).all()).toEqual([]);
    expect(fileRow(t, shot)).toBeUndefined();
    expect(await t.files.get(key)).toBeNull();
  });

  it('screenshots are served to whoever may see castings, like a casting’s files', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const o = await add(c, { fileIds: [await uploadPng(c)] });
    const reader = await t.as({ permissions: ['castings.read'] });
    const listed = (await reader.get<{ items: Opportunity[] }>('/api/opportunities')).body.items[0]!;
    expect(listed.files[0]!.fileId).toBe(o.files[0]!.fileId);
    expect((await reader.raw(`/api/files/${listed.files[0]!.fileId}`, { headers: { cookie: reader.cookie! } })).status).toBe(200);
  });
});

describe('the list', () => {
  it('filters by status, searches title / source / roles / location / notes, and counts per status', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    await add(c, { title: 'Feature film', source: 'Instagram — Frame Casting' });
    await add(c, { title: 'إعلان عصائر', roles: 'أطفال', status: 'interested' });
    await add(c, { title: 'Theatre', location: 'Downtown', status: 'applied' });
    await add(c, { title: 'Web series', details: 'registration fee', status: 'dismissed' });
    const titles = async (qs: string) => (await c.get<{ items: Opportunity[] }>(`/api/opportunities${qs}`)).body.items.map((o) => o.title).sort();
    expect(await titles('')).toHaveLength(4);
    expect(await titles('?status=interested')).toEqual(['إعلان عصائر']);
    expect(await titles('?q=frame')).toEqual(['Feature film']);
    expect(await titles('?q=أطفال')).toEqual(['إعلان عصائر']);
    expect(await titles('?q=downtown')).toEqual(['Theatre']);
    expect(await titles('?q=FEE&status=dismissed')).toEqual(['Web series']);
    expect(await titles('?q=fee&status=new')).toEqual([]);
    expect((await c.get('/api/opportunities?status=booked')).status).toBe(400);
    expect((await c.get<OpportunityCounts>('/api/opportunities/counts')).body).toEqual({ new: 1, interested: 1, applied: 1, dismissed: 1 });
  });

  it('nearest open deadline first, then no deadline, then the closed ones (newest first among equals)', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const today = todayISO();
    await add(c, { title: 'closed', deadline: addDays(today, -2) });
    await add(c, { title: 'none-old' });
    await add(c, { title: 'in five', deadline: addDays(today, 5) });
    await add(c, { title: 'today', deadline: today });
    await add(c, { title: 'none-new' });
    const ids = t.db.select({ id: castingOpportunities.id, title: castingOpportunities.title }).from(castingOpportunities).all();
    // Make "none-old" older than "none-new" for sure.
    t.db.update(castingOpportunities).set({ createdAt: 1 }).where(eq(castingOpportunities.id, ids.find((x) => x.title === 'none-old')!.id)).run();
    const order = (await c.get<{ items: Opportunity[] }>('/api/opportunities')).body.items.map((o) => o.title);
    expect(order).toEqual(['today', 'in five', 'none-new', 'none-old', 'closed']);
  });

  it('the dashboard counts the new ones for castings.read, and leaves the count out for everyone else', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    await add(c);
    await add(c);
    await add(c, { status: 'dismissed' });
    expect((await c.get<DashboardData>('/api/dashboard')).body.counts.newOpportunities).toBe(2);
    expect((await (await t.as('ceo')).get<DashboardData>('/api/dashboard')).body.counts.newOpportunities).toBe(2);
    const coach = await t.as('acting_coach');
    expect('newOpportunities' in (await coach.get<DashboardData>('/api/dashboard')).body.counts).toBe(false);
  });
});

describe('Turn into a casting', () => {
  it('makes an open casting with the title, notes, deadline, type and location, the link and contact in its notes; links it; moves a new one to Interested', async () => {
    const t = await makeTestContext();
    const c = await t.as('casting_team');
    const deadline = addDays(todayISO(), 4);
    const shot = await uploadPng(c);
    const o = await add(c, {
      title: 'Series — the grandmother',
      details: 'Thirty episodes, Ramadan.',
      projectType: 'series',
      roles: 'Grandmother (55–70)',
      location: 'Media Production City',
      deadline,
      contact: 'WhatsApp +20 100 000 0000',
      link: 'https://example.com/post',
      source: 'Facebook',
      fileIds: [shot],
    });
    const res = await c.post<{ castingId: number }>(`/api/opportunities/${o.id}/to-casting`);
    expect(res.status).toBe(201);
    const casting = (await c.get<CastingDetail>(`/api/castings/${res.body.castingId}`)).body;
    expect(casting).toMatchObject({ title: 'Series — the grandmother', type: 'tv', status: 'open', location: 'Media Production City', submissionDeadline: deadline });
    expect(casting.description).toBe(
      'Thirty episodes, Ramadan.\n\nRoles: Grandmother (55–70)\nLink: https://example.com/post\nContact: WhatsApp +20 100 000 0000\nSeen on: Facebook',
    );
    // The screenshot is one of the casting's files too.
    expect(t.db.select().from(castingFiles).where(eq(castingFiles.castingId, casting.id)).all().map((f) => f.fileId)).toEqual([shot]);

    const after = (await c.get<Opportunity>(`/api/opportunities/${o.id}`)).body;
    expect(after).toMatchObject({ castingId: casting.id, status: 'interested' });
    expect(after.reviewedBy?.id).toBe(c.user.id);

    // Once only, while that casting exists — the answer says which casting it is.
    const again = await c.post(`/api/opportunities/${o.id}/to-casting`);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'already_casting', details: { castingId: casting.id } });

    // Deleting the opportunity keeps the screenshot: the casting still uses it.
    expect((await c.delete(`/api/opportunities/${o.id}`)).status).toBe(204);
    expect(fileRow(t, shot)).toBeTruthy();
    expect((await c.delete(`/api/castings/${casting.id}`)).status).toBe(204);
    expect(fileRow(t, shot)).toBeUndefined();
  });

  it('a deleted casting unlinks it, and it can be turned again; an applied one keeps its status', async () => {
    const t = await makeTestContext();
    const c = await t.as('head_of_casting');
    const o = await add(c, { status: 'applied', projectType: 'online' });
    const first = (await c.post<{ castingId: number }>(`/api/opportunities/${o.id}/to-casting`)).body.castingId;
    expect((await c.get<CastingDetail>(`/api/castings/${first}`)).body).toMatchObject({ type: 'other', description: null });
    expect((await c.get<Opportunity>(`/api/opportunities/${o.id}`)).body.status).toBe('applied');
    expect((await c.delete(`/api/castings/${first}`)).status).toBe(204);
    expect((await c.get<Opportunity>(`/api/opportunities/${o.id}`)).body.castingId).toBeNull();
    const second = await c.post<{ castingId: number }>(`/api/opportunities/${o.id}/to-casting`);
    expect(second.status).toBe(201);
    expect(second.body.castingId).not.toBe(first);
  });

  it('writes the notes in the language of the person turning it, with the warnings first', () => {
    const o = { details: null, roles: 'أب وأم', link: 'https://example.com', contact: null, source: null, involvesMinors: true, asksForPayment: true };
    expect(castingNotesFrom(o, 'ar')).toBe('انتبه: الإعلان يطلب من الممثلين مالًا.\nيشارك فيها أطفال أو مراهقون.\nالأدوار: أب وأم\nالرابط: https://example.com');
    expect(castingNotesFrom({ ...o, roles: null, link: null, involvesMinors: false, asksForPayment: false }, 'en')).toBeNull();
  });
});
